import { Router } from 'express';
import { ROLES, assertStudentCanEdit } from '../domain/project-state-machine.js';
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

export function createStudentRouter({
  db,
  verifyRole,
  upload,
  dataDir,
  documentsDir,
}) {
  const router = Router();
  router.use(verifyRole(ROLES.STUDENT));

  router.get('/tutors', (_request, response) => {
    const tutors = db.prepare(`
      SELECT id, nombre, email FROM users
      WHERE rol = 'tutor' AND activo = 1 ORDER BY nombre COLLATE NOCASE
    `).all();
    response.json({ tutors });
  });

  router.get('/projects', (request, response) => {
    const projects = db.prepare(`
      SELECT p.*, t.nombre AS assigned_tutor_name,
        (SELECT comentario FROM tutor_notes n WHERE n.project_id=p.id ORDER BY n.id DESC LIMIT 1) AS latest_note
      FROM projects p LEFT JOIN users t ON t.id=p.tutor_id
      WHERE p.estudiante_id = ?
      ORDER BY p.updated_at DESC
    `).all(request.user.id).map(row => ({
      ...serializeProject(row), tutorAsignado: row.assigned_tutor_name,
      ultimaObservacion: row.latest_note,
    }));
    response.json({ projects });
  });

  router.post('/projects', (request, response) => {
    const title = String(request.body.titulo || '').trim();
    if (!title) {
      response.status(422).json({ message: 'El título es obligatorio.' });
      return;
    }

    const tutorId = Number(request.body.tutorId);
    const tutor = db.prepare(`
      SELECT id, nombre FROM users WHERE id = ? AND rol = 'tutor' AND activo = 1
    `).get(tutorId);
    if (!tutor) {
      response.status(422).json({ message: 'Selecciona un tutor registrado para enviar el proyecto.' });
      return;
    }

    // El trayecto del proyecto se toma del formulario o del perfil del estudiante.
    const trayecto = ['I', 'II', 'III', 'IV'].includes(request.body.trayecto)
      ? request.body.trayecto
      : request.user.trayecto;
    if (!trayecto) {
      response.status(422).json({ message: 'El trayecto del proyecto es obligatorio.' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO projects (
        estudiante_id, tutor_id, titulo, slug, codigo_proyecto, tipo_recurso,
        pnf, linea_investigacion, autores_json, tutor_nombre,
        anio_publicacion, trayecto, resumen, estado
      ) VALUES (?, ?, ?, ?, ?, ?, 'Informática', ?, ?, ?, ?, ?, ?, 'pendiente')
    `).run(
      request.user.id,
      tutor.id,
      title,
      request.body.slug || null,
      request.body.codigoProyecto || null,
      request.body.tipoRecurso || null,
      request.body.lineaInvestigacion || null,
      JSON.stringify(parseAuthors(request.body.autores)),
      tutor.nombre,
      request.body.anioPublicacion || null,
      trayecto,
      request.body.resumen || null,
    );

    const project = projectById(db, result.lastInsertRowid);
    auditProject(db, request, {
      projectId: project.id,
      action: 'student.project.created',
      before: null,
      after: project,
      description: `El estudiante envió el proyecto al tutor ${tutor.nombre}.`,
    });
    response.status(201).json({ project: serializeProject(project) });
  });

  router.get('/projects/:id', (request, response) => {
    const project = projectById(db, request.params.id);
    if (!project || project.estudiante_id !== request.user.id) {
      response.status(404).json({ message: 'Proyecto no encontrado.' });
      return;
    }
    const notes = db.prepare(`
      SELECT n.id, n.tipo, n.comentario, n.created_at, u.nombre AS tutor_nombre
      FROM tutor_notes n
      JOIN users u ON u.id = n.tutor_id
      WHERE n.project_id = ?
      ORDER BY n.created_at ASC
    `).all(project.id);
    response.json({ project: serializeProject(project), notes });
  });

  router.put('/projects/:id/metadata', (request, response) => {
    try {
      const before = projectById(db, request.params.id);
      if (!before) {
        response.status(404).json({ message: 'Proyecto no encontrado.' });
        return;
      }
      assertStudentCanEdit(before, request.user.id);

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
        action: 'student.metadata.updated',
        before,
        after,
        description: 'El estudiante actualizó los metadatos.',
      });
      response.json({ project: serializeProject(after) });
    } catch (error) {
      sendRouteError(response, error);
    }
  });

  router.post('/projects/:id/resubmit', (request, response) => {
    try {
      const before = projectById(db, request.params.id);
      if (!before) return response.status(404).json({ message: 'Proyecto no encontrado.' });
      assertStudentCanEdit(before, request.user.id);
      if (before.estado !== 'en_correccion') {
        return response.status(409).json({ message: 'Solo se puede reenviar un proyecto en corrección.' });
      }
      if (!before.tutor_id || !before.resource_path) {
        return response.status(422).json({ message: 'Falta el tutor asignado o el PDF del recurso.' });
      }
      db.prepare(`UPDATE projects SET estado='pendiente',updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(before.id);
      const after = projectById(db, before.id);
      auditProject(db, request, {
        projectId: before.id, action: 'student.project.resubmitted', before, after,
        description: 'El estudiante completó las correcciones y reenvió al tutor.',
      });
      response.json({ project: serializeProject(after), message: 'Proyecto reenviado al tutor.' });
    } catch (error) {
      sendRouteError(response, error);
    }
  });

  router.post(
    '/projects/:id/documents/:type',
    upload.single('pdf'),
    async (request, response) => {
      try {
        const project = projectById(db, request.params.id);
        if (!project || !['recurso', 'planilla'].includes(request.params.type)) {
          await removeTemporaryFile(request.file);
          response.status(422).json({ message: 'Proyecto o tipo documental no válido.' });
          return;
        }
        assertStudentCanEdit(project, request.user.id);
        if (!request.file) {
          response.status(422).json({ message: 'Debes adjuntar un PDF.' });
          return;
        }

        const document = await storeProjectDocument({
          db,
          dataDir,
          documentsDir,
          project,
          type: request.params.type,
          file: request.file,
          userId: request.user.id,
        });
        const after = projectById(db, project.id);
        auditProject(db, request, {
          projectId: project.id,
          action: `student.document.${request.params.type}.uploaded`,
          before: project,
          after,
          description: `El estudiante cargó ${request.params.type}, versión ${document.version}.`,
        });
        response.status(201).json({ project: serializeProject(after), document });
      } catch (error) {
        await removeTemporaryFile(request.file);
        sendRouteError(response, error);
      }
    },
  );

  router.get('/projects/:id/documents/:type', (request, response) => {
    const project = projectById(db, request.params.id);
    if (!project || project.estudiante_id !== request.user.id) {
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

  return router;
}