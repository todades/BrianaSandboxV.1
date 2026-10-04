export function projectById(db, id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
}

export function parseAuthors(value) {
  return Array.isArray(value)
    ? value.map(String).map(item => item.trim()).filter(Boolean)
    : String(value || '').split(';').map(item => item.trim()).filter(Boolean);
}

export function safeJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function serializeProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    estudianteId: row.estudiante_id,
    tutorId: row.tutor_id,
    titulo: row.titulo,
    slug: row.slug,
    codigoProyecto: row.codigo_proyecto,
    tipoRecurso: row.tipo_recurso,
    pnf: row.pnf,
    lineaInvestigacion: row.linea_investigacion,
    autores: safeJson(row.autores_json, []),
    tutorNombre: row.tutor_nombre,
    anioPublicacion: row.anio_publicacion,
    trayecto: row.trayecto,
    enviadoPorTutor: row.enviado_por_tutor,
    enviadoEn: row.enviado_en,
    resumen: row.resumen,
    resourcePath: row.resource_path,
    planillaPath: row.planilla_path,
    estado: row.estado,
    tutorApprovedAt: row.tutor_approved_at,
    publishedAt: row.published_at,
    rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function auditProject(db, request, {
  projectId,
  action,
  before,
  after,
  description,
}) {
  db.prepare(`
    INSERT INTO project_audits (
      project_id, actor_id, accion, estado_anterior, estado_nuevo,
      valores_anteriores_json, valores_nuevos_json, descripcion,
      ip_address, user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    projectId,
    request.user.id,
    action,
    before?.estado || null,
    after?.estado || null,
    before ? JSON.stringify(serializeProject(before)) : null,
    after ? JSON.stringify(serializeProject(after)) : null,
    description || null,
    request.ip,
    String(request.headers['user-agent'] || '').slice(0, 500),
  );
}

export function sendRouteError(response, error) {
  response.status(error.status || 500).json({
    message: error.status ? error.message : 'Ocurrió un error interno.',
  });
}