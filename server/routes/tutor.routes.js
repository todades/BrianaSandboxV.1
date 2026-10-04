import { Router } from 'express';
import {
  PROJECT_STATES,
  ROLES,
  assertTransition,
  assertTutorAssignment,
} from '../domain/project-state-machine.js';
import {
  auditProject,
  parseAuthors,
  projectById,
  sendRouteError,
  serializeProject,
} from '../lib/project-helpers.js';
import { currentDocument, sendPrivateDocument } from '../lib/documents.js';

export function createTutorRouter({ db, verifyRole, dataDir }) {
  const router = Router();
  router.use(verifyRole(ROLES.TUTOR));

  router.get('/projects', (request, response) => {
    const projects = db.prepare(`
      SELECT p.*, s.nombre AS estudiante_nombre FROM projects p
      JOIN users s ON s.id = p.estudiante_id
      WHERE p.tutor_id = ?
      ORDER BY
        CASE estado
          WHEN 'en_correccion' THEN 1
          WHEN 'pendiente' THEN 2
          WHEN 'en_validacion' THEN 3
          ELSE 4
        END,
        p.updated_at DESC
    `).all(request.user.id).map(row => ({
      ...serializeProject(row), estudianteNombre: row.estudiante_nombre,
    }));
    response.json({ projects });
  });

  router.get('/projects/:id', (request, response) => {
    try {
      const project = projectById(db, request.params.id);
      if (!project) {
        response.status(404).json({ message: 'Proyecto no encontrado.' });
        return;
      }
      assertTutorAssignment(project, request.user.id);
      const notes = db.prepare(`
        SELECT id, tipo, comentario, created_at
        FROM tutor_notes
        WHERE project_id = ? AND tutor_id = ?
        ORDER BY created_at ASC
      `).all(project.id, request.user.id);
      response.json({ project: serializeProject(project), notes });
    } catch (error) {
      sendRouteError(response, error);
    }
  });

  router.post('/projects/:id/notes', (request, response) => {
    try {
      const before = projectById(db, request.params.id);
      if (!before) {
        response.status(404).json({ message: 'Proyecto no encontrado.' });
        return;
      }
      assertTutorAssignment(before, request.user.id);
      assertTransition({
        project: before,
        to: PROJECT_STATES.CORRECTION,
        actorRole: request.user.rol,
      });

      const comment = String(request.body.comentario || '').trim();
      if (comment.length < 3) {
        response.status(422).json({ message: 'La observación es obligatoria.' });
        return;
      }
      const type = ['metodologica', 'tecnica', 'general'].includes(request.body.tipo)
        ? request.body.tipo
        : 'general';

      db.transaction(() => {
        db.prepare(`
          INSERT INTO tutor_notes (project_id, tutor_id, tipo, comentario)
          VALUES (?, ?, ?, ?)
        `).run(before.id, request.user.id, type, comment);
        db.prepare(`
          UPDATE projects
          SET estado = 'en_correccion', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(before.id);
      })();

      const after = projectById(db, before.id);
      auditProject(db, request, {
        projectId: before.id,
        action: 'tutor.correction.requested',
        before,
        after,
        description: comment,
      });
      response.json({ project: serializeProject(after) });
    } catch (error) {
      sendRouteError(response, error);
    }
  });

  // El tutor corrige metadatos detectados con error antes de enviar al administrador.
  router.put('/projects/:id/metadata', (request, response) => {
    try {
      const before = projectById(db, request.params.id);
      if (!before) {
        response.status(404).json({ message: 'Proyecto no encontrado.' });
        return;
      }
      assertTutorAssignment(before, request.user.id);
      if ([PROJECT_STATES.PUBLISHED, PROJECT_STATES.REJECTED].includes(before.estado)) {
        response.status(409).json({ message: 'El proyecto está cerrado y no admite cambios.' });
        return;
      }

      db.prepare(`
        UPDATE projects SET
          titulo = ?, slug = ?, codigo_proyecto = ?, tipo_recurso = ?,
          linea_investigacion = ?, autores_json = ?, tutor_nombre = ?,
          anio_publicacion = ?, resumen = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        String(request.body.titulo || before.titulo).trim(),
        request.body.slug ?? before.slug,
        request.body.codigoProyecto ?? before.codigo_proyecto,
        request.body.tipoRecurso ?? before.tipo_recurso,
        request.body.lineaInvestigacion ?? before.linea_investigacion,
        JSON.stringify(request.body.autores
          ? parseAuthors(request.body.autores)
          : JSON.parse(before.autores_json || '[]')),
        request.body.tutorNombre ?? before.tutor_nombre,
        request.body.anioPublicacion ?? before.anio_publicacion,
        request.body.resumen ?? before.resumen,
        before.id,
      );

      const after = projectById(db, before.id);
      auditProject(db, request, {
        projectId: before.id,
        action: 'tutor.metadata.corrected',
        before,
        after,
        description: 'El tutor corrigió metadatos durante la revisión académica.',
      });
      response.json({ project: serializeProject(after) });
    } catch (error) {
      sendRouteError(response, error);
    }
  });

  // Envío formal del tutor al administrador para la validación final.
  router.post('/projects/:id/send-to-admin', (request, response) => {
    try {
      const before = projectById(db, request.params.id);
      if (!before) {
        response.status(404).json({ message: 'Proyecto no encontrado.' });
        return;
      }
      assertTutorAssignment(before, request.user.id);
      assertTransition({
        project: before,
        to: PROJECT_STATES.TUTOR_APPROVED,
        actorRole: request.user.rol,
        requireDocuments: true,
      });

      db.prepare(`
        UPDATE projects
        SET estado = 'en_validacion', tutor_approved_at = CURRENT_TIMESTAMP,
            enviado_por_tutor = ?, enviado_en = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(request.user.nombre, before.id);

      const after = projectById(db, before.id);
      auditProject(db, request, {
        projectId: before.id,
        action: 'tutor.sent_to_admin',
        before,
        after,
        description: 'El tutor revisó el proyecto y lo envió a validación del administrador.',
      });
      response.json({
        project: serializeProject(after),
        message: 'Proyecto enviado a validación del administrador.',
      });
    } catch (error) {
      sendRouteError(response, error);
    }
  });

  router.post('/projects/:id/approve', (request, response) => {
    try {
      const before = projectById(db, request.params.id);
      if (!before) {
        response.status(404).json({ message: 'Proyecto no encontrado.' });
        return;
      }
      assertTutorAssignment(before, request.user.id);
      assertTransition({
        project: before,
        to: PROJECT_STATES.TUTOR_APPROVED,
        actorRole: request.user.rol,
        requireDocuments: true,
      });

      db.prepare(`
        UPDATE projects
        SET estado = 'en_validacion', tutor_approved_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(before.id);

      const after = projectById(db, before.id);
      auditProject(db, request, {
        projectId: before.id,
        action: 'tutor.approved',
        before,
        after,
        description: 'El tutor otorgó el visto bueno académico.',
      });
      response.json({ project: serializeProject(after) });
    } catch (error) {
      sendRouteError(response, error);
    }
  });

  router.get('/projects/:id/documents/:type', (request, response) => {
    try {
      const project = projectById(db, request.params.id);
      if (!project) {
        response.status(404).json({ message: 'Proyecto no encontrado.' });
        return;
      }
      assertTutorAssignment(project, request.user.id);
      const document = currentDocument(db, project.id, request.params.type);
      if (!document) {
        response.status(404).json({ message: 'Documento no encontrado.' });
        return;
      }
      sendPrivateDocument({
        response,
        document,
        dataDir,
        download: request.query.download === '1',
      });
    } catch (error) {
      sendRouteError(response, error);
    }
  });

  return router;
}