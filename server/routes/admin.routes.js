import { Router } from 'express';
import {
  FINAL_STATES,
  PROJECT_STATES,
  ROLES,
  assertTransition,
} from '../domain/project-state-machine.js';
import {
  auditProject,
  parseAuthors,
  projectById,
  sendRouteError,
  serializeProject,
} from '../lib/project-helpers.js';
import {
  currentDocument,
  removeTemporaryFile,
  sendPrivateDocument,
  storeProjectDocument,
} from '../lib/documents.js';

export function createAdminRouter({
  db,
  verifyRole,
  upload,
  dataDir,
  documentsDir,
}) {
  const router = Router();
  router.use(verifyRole(ROLES.ADMIN));

  router.get('/projects', (_request, response) => {
    const projects = db.prepare(`
      SELECT p.*, s.nombre AS estudiante_nombre, t.nombre AS tutor_asignado_nombre
      FROM projects p
      JOIN users s ON s.id = p.estudiante_id
      LEFT JOIN users t ON t.id = p.tutor_id
      ORDER BY p.updated_at DESC
    `).all().map(row => ({
      ...serializeProject(row),
      estudianteNombre: row.estudiante_nombre,
      tutorAsignadoNombre: row.tutor_asignado_nombre,
    }));
    response.json({ projects });
  });

  router.get('/users', (_request, response) => {
    const users = db.prepare(`
      SELECT id, nombre, cedula, email, telefono, trayecto, rol, activo, created_at
      FROM users ORDER BY created_at DESC
    `).all();
    response.json({ users });
  });

  router.patch('/users/:id/role', (request, response) => {
    const role = String(request.body.rol || '');
    if (!Object.values(ROLES).includes(role)) {
      response.status(422).json({ message: 'Rol no válido.' });
      return;
    }
    db.prepare(`
      UPDATE users SET rol = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(role, Number(request.params.id));
    const user = db.prepare(`
      SELECT id, nombre, cedula, email, telefono, trayecto, rol, activo, created_at
      FROM users WHERE id = ?
    `).get(Number(request.params.id));
    if (!user) {
      response.status(404).json({ message: 'Usuario no encontrado.' });
      return;
    }
    response.json({ user });
  });

  router.patch('/projects/:id/assign-tutor', (request, response) => {
    const before = projectById(db, request.params.id);
    const tutor = db.prepare(`
      SELECT id, nombre FROM users
      WHERE id = ? AND rol = 'tutor' AND activo = 1
    `).get(Number(request.body.tutorId));
    if (!before || !tutor) {
      response.status(422).json({ message: 'Proyecto o tutor no válido.' });
      return;
    }

    db.prepare(`
      UPDATE projects
      SET tutor_id = ?, tutor_nombre = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(tutor.id, tutor.nombre, before.id);
    const after = projectById(db, before.id);
    auditProject(db, request, {
      projectId: before.id,
      action: 'admin.tutor.assigned',
      before,
      after,
      description: `Tutor asignado: ${tutor.nombre}.`,
    });
    response.json({ project: serializeProject(after) });
  });

  router.put('/projects/:id/metadata', (request, response) => {
    const before = projectById(db, request.params.id);
    if (!before) {
      response.status(404).json({ message: 'Proyecto no encontrado.' });
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
      action: 'admin.metadata.updated',
      before,
      after,
      description: 'El administrador realizó una edición avanzada.',
    });
    response.json({ project: serializeProject(after) });
  });

  router.post(
    '/projects/:id/documents/:type',
    upload.single('pdf'),
    async (request, response) => {
      try {
        const before = projectById(db, request.params.id);
        if (!before || !['recurso', 'planilla'].includes(request.params.type)) {
          await removeTemporaryFile(request.file);
          response.status(422).json({ message: 'Proyecto o tipo documental no válido.' });
          return;
        }
        if (FINAL_STATES.has(before.estado)) {
          await removeTemporaryFile(request.file);
          response.status(409).json({ message: 'No se pueden reemplazar documentos de un proyecto cerrado.' });
          return;
        }
        if (!request.file) {
          response.status(422).json({ message: 'Debes adjuntar un PDF.' });
          return;
        }

        const document = await storeProjectDocument({
          db,
          dataDir,
          documentsDir,
          project: before,
          type: request.params.type,
          file: request.file,
          userId: request.user.id,
        });
        const after = projectById(db, before.id);
        auditProject(db, request, {
          projectId: before.id,
          action: `admin.document.${request.params.type}.uploaded`,
          before,
          after,
          description: `El administrador cargó ${request.params.type}, versión ${document.version}.`,
        });
        response.status(201).json({ project: serializeProject(after), document });
      } catch (error) {
        await removeTemporaryFile(request.file);
        sendRouteError(response, error);
      }
    },
  );

  router.post('/projects/:id/publish', (request, response) => {
    try {
      const before = projectById(db, request.params.id);
      if (!before) {
        response.status(404).json({ message: 'Proyecto no encontrado.' });
        return;
      }
      assertTransition({
        project: before,
        to: PROJECT_STATES.PUBLISHED,
        actorRole: request.user.rol,
        requireDocuments: true,
      });
      db.prepare(`
        UPDATE projects SET
          estado = 'publicado', published_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(before.id);
      const after = projectById(db, before.id);
      auditProject(db, request, {
        projectId: before.id,
        action: 'admin.project.published',
        before,
        after,
        description: 'El administrador validó, cerró y publicó el proyecto.',
      });
      response.json({ project: serializeProject(after) });
    } catch (error) {
      sendRouteError(response, error);
    }
  });

  // Devuelve el proyecto al ciclo cuando el administrador detecta ajustes pendientes.
  router.post('/projects/:id/request-changes', (request, response) => {
    try {
      const before = projectById(db, request.params.id);
      if (!before) {
        response.status(404).json({ message: 'Proyecto no encontrado.' });
        return;
      }
      assertTransition({
        project: before,
        to: PROJECT_STATES.CORRECTION,
        actorRole: request.user.rol,
      });

      const observacion = String(request.body.observacion || '').trim();
      if (observacion.length < 5) {
        response.status(422).json({ message: 'Indica qué debe corregirse.' });
        return;
      }

      db.transaction(() => {
        if (before.tutor_id) {
          db.prepare(`
            INSERT INTO tutor_notes (project_id, tutor_id, tipo, comentario)
            VALUES (?, ?, 'general', ?)
          `).run(before.id, before.tutor_id, `[Administración] ${observacion}`);
        }
        db.prepare(`
          UPDATE projects
          SET estado = 'en_correccion', tutor_approved_at = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(before.id);
      })();

      const after = projectById(db, before.id);
      auditProject(db, request, {
        projectId: before.id,
        action: 'admin.changes_requested',
        before,
        after,
        description: observacion,
      });
      response.json({
        project: serializeProject(after),
        message: 'Proyecto devuelto al ciclo de corrección.',
      });
    } catch (error) {
      sendRouteError(response, error);
    }
  });

  router.post('/projects/:id/reject', (request, response) => {
    try {
      const before = projectById(db, request.params.id);
      if (!before) {
        response.status(404).json({ message: 'Proyecto no encontrado.' });
        return;
      }
      assertTransition({
        project: before,
        to: PROJECT_STATES.REJECTED,
        actorRole: request.user.rol,
      });
      const reason = String(request.body.motivo || '').trim();
      if (reason.length < 5) {
        response.status(422).json({ message: 'Indica un motivo de rechazo.' });
        return;
      }
      db.prepare(`
        UPDATE projects SET
          estado = 'rechazado', rejected_at = CURRENT_TIMESTAMP,
          rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(reason, before.id);
      const after = projectById(db, before.id);
      auditProject(db, request, {
        projectId: before.id,
        action: 'admin.project.rejected',
        before,
        after,
        description: reason,
      });
      response.json({ project: serializeProject(after) });
    } catch (error) {
      sendRouteError(response, error);
    }
  });

  router.get('/projects/:id/documents/:type', (request, response) => {
    const project = projectById(db, request.params.id);
    if (!project) {
      response.status(404).json({ message: 'Proyecto no encontrado.' });
      return;
    }
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
  });

  router.get('/audit', (_request, response) => {
    const audits = db.prepare(`
      SELECT a.*, u.nombre AS actor_nombre, u.rol AS actor_rol,
             p.titulo AS project_title
      FROM project_audits a
      JOIN users u ON u.id = a.actor_id
      LEFT JOIN projects p ON p.id = a.project_id
      ORDER BY a.created_at ASC, a.id ASC
    `).all();
    response.json({ audits });
  });

  return router;
}