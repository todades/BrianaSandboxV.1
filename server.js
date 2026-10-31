import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);

for (const key of ['DATABASE_URL', 'JWT_SECRET', 'RECOVERY_CODE_PEPPER']) {
  if (!process.env[key]) throw new Error(`Falta la variable de entorno ${key}.`);
}

const ROLES = { STUDENT: 'estudiante', TUTOR: 'tutor', ADMIN: 'administrador' };
const STATES = { PENDING: 'pendiente', CORRECTION: 'en_correccion', VALIDATION: 'en_validacion', PUBLISHED: 'publicado', REJECTED: 'rechazado' };
const EDITABLE = new Set([STATES.PENDING, STATES.CORRECTION]);
const KINDS = new Set(['recurso', 'planilla']);

const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
});

const query = (text, params = []) => pool.query(text, params);
const one = async (text, params) => (await query(text, params)).rows[0] || null;
const many = async (text, params) => (await query(text, params)).rows;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const digits = v => String(v || '').replace(/\D/g, '');
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const parseAuthors = v => (Array.isArray(v) ? v.map(String) : String(v || '').split(';'))
  .map(a => a.trim()).filter(Boolean);
const publicUser = u => ({
  id: u.id, nombre: u.nombre, cedula: u.cedula, email: u.correo,
  telefono: u.telefono, rol: u.role, activo: u.activo,
  ...(u.role === ROLES.STUDENT ? { trayecto: u.trayecto } : {}),
});
const serializeProject = r => r && ({
  id: r.id, estudianteId: r.student_id, tutorId: r.tutor_id,
  titulo: r.title, codigoProyecto: r.code, slug: r.slug,
  tipoRecurso: r.resource_type, pnf: r.pnf, lineaInvestigacion: r.research_line,
  autores: r.authors || [], tutorNombre: r.tutor_name,
  anioPublicacion: r.year, trayecto: r.trayecto, resumen: r.summary,
  estado: r.status, resourcePath: r.file_url, planillaPath: r.signed_form_url,
  enviadoPorTutor: r.sent_by_tutor, enviadoEn: r.sent_at,
  tutorApprovedAt: r.tutor_approved_at, publishedAt: r.published_at,
  rejectedAt: r.rejected_at, rejectionReason: r.rejection_reason,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

// ---------- Esquema ----------
await query(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  cedula CHAR(8) NOT NULL UNIQUE,
  correo VARCHAR(255) NOT NULL UNIQUE,
  telefono CHAR(11) NOT NULL,
  trayecto VARCHAR(3) CHECK (trayecto IN ('I','II','III','IV')),
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'estudiante'
    CHECK (role IN ('estudiante','tutor','administrador')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  code VARCHAR(60), slug VARCHAR(200), resource_type VARCHAR(120),
  pnf VARCHAR(120) NOT NULL DEFAULT 'Informática',
  research_line TEXT, authors JSONB NOT NULL DEFAULT '[]'::jsonb,
  tutor_name VARCHAR(150), year VARCHAR(4),
  trayecto VARCHAR(3) CHECK (trayecto IN ('I','II','III','IV')),
  summary TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente','en_correccion','en_validacion','publicado','rechazado')),
  file_url TEXT, signed_form_url TEXT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tutor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sent_by_tutor VARCHAR(150), sent_at TIMESTAMPTZ,
  tutor_approved_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ, rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_documents (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('recurso','planilla')),
  version INTEGER NOT NULL DEFAULT 1,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(60) NOT NULL DEFAULT 'application/pdf',
  size INTEGER NOT NULL, content BYTEA NOT NULL,
  uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, kind, version)
);
CREATE TABLE IF NOT EXISTS tutor_notes (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind VARCHAR(20) NOT NULL DEFAULT 'general',
  comment TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_audits (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action VARCHAR(80) NOT NULL, status_before VARCHAR(20), status_after VARCHAR(20),
  description TEXT, ip_address VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_projects_student ON projects(student_id);
CREATE INDEX IF NOT EXISTS idx_projects_tutor ON projects(tutor_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
`);

const projectById = id => one('SELECT * FROM projects WHERE id = $1', [Number(id)]);
async function audit(req, projectId, action, before, after, description) {
  await query(
    `INSERT INTO project_audits (project_id,actor_id,action,status_before,status_after,description,ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [projectId, req.user.id, action, before?.status || null, after?.status || null, description || null, req.ip],
  );
}

// ---------- Administrador inicial ----------
async function seedAdmin() {
  const correo = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_LOGIN_PASSWORD || '');
  if (!correo || !password) return;
  if (await one('SELECT id FROM users WHERE correo = $1', [correo])) return;
  await query(
    `INSERT INTO users (nombre,cedula,correo,telefono,password,role) VALUES ($1,$2,$3,$4,$5,'administrador')`,
    [
      process.env.ADMIN_NAME || 'Administrador BRIANA',
      digits(process.env.ADMIN_CEDULA || '00000000').padStart(8, '0').slice(0, 8),
      correo,
      digits(process.env.ADMIN_PHONE || '04120000000').padStart(11, '0').slice(0, 11),
      await bcrypt.hash(password, 12),
    ],
  );
}
await seedAdmin();

// ---------- Middlewares ----------
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
<<<<<<< HEAD
app.use(cors({ origin: true, methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
=======

// ---------- Solución CORS actualizada ----------
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://brianacdb.netlify.app',
  ],
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
// ----------------------------------------------

>>>>>>> f30e0f4d90259bfb99a0416d387aaef4f02e2286
app.use(express.json({ limit: '256kb' }));

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, message: { message: 'Demasiados intentos.' } });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

const tokenFor = u => jwt.sign({ sub: String(u.id), role: u.role }, process.env.JWT_SECRET,
  { expiresIn: process.env.JWT_EXPIRES_IN || '8h', issuer: 'briana-api', audience: 'briana-panel' });

async function requireAuth(req, res, next) {
  try {
    const h = String(req.headers.authorization || '');
    const p = jwt.verify(h.startsWith('Bearer ') ? h.slice(7) : '', process.env.JWT_SECRET,
      { issuer: 'briana-api', audience: 'briana-panel' });
    req.user = await one('SELECT * FROM users WHERE id = $1 AND activo = TRUE', [Number(p.sub)]);
    if (!req.user) throw new Error();
    next();
  } catch { res.status(401).json({ message: 'La sesión expiró o no es válida. Inicia sesión de nuevo.' }); }
}
const allow = (...roles) => (req, res, next) => roles.includes(req.user.role)
  ? next() : res.status(403).json({ message: 'No tienes permiso para esta acción.' });

// ---------- Salud y autenticación ----------
app.get('/api/health', async (_req, res) => {
  await query('SELECT 1');
  res.json({ ok: true, database: 'postgresql' });
});

app.post(['/api/register','/api/auth/register'], authLimiter, async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const cedula = digits(req.body.cedula);
  const correo = String(req.body.email || req.body.correo || '').trim().toLowerCase();
  const telefono = digits(req.body.telefono);
  const password = String(req.body.password || '');
  const trayecto = ['I','II','III','IV'].includes(req.body.trayecto) ? req.body.trayecto : null;
  const role = req.body.rolSolicitado === ROLES.TUTOR ? ROLES.TUTOR : ROLES.STUDENT;

  if (nombre.length < 2) fail(422, 'Escribe tu nombre completo.');
  if (!validEmail(correo)) fail(422, 'El correo no es válido.');
  if (password.length < 8) fail(422, 'La contraseña debe tener al menos 8 caracteres.');
  if (!/^\d{8}$/.test(cedula)) fail(422, 'La cédula debe tener exactamente 8 dígitos.');
  if (!/^\d{11}$/.test(telefono)) fail(422, 'El teléfono debe tener exactamente 11 dígitos.');
  if (role === ROLES.STUDENT && !trayecto) fail(422, 'Selecciona el trayecto del estudiante.');
  if (await one('SELECT id FROM users WHERE correo = $1', [correo])) fail(409, 'El correo ya está registrado.');
  if (await one('SELECT id FROM users WHERE cedula = $1', [cedula])) fail(409, 'La cédula ya está registrada.');

  const user = await one(
    `INSERT INTO users (nombre,cedula,correo,telefono,trayecto,password,role)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [nombre, cedula, correo, telefono, role === ROLES.STUDENT ? trayecto : null,
      await bcrypt.hash(password, 12), role],
  );
  res.status(201).json({ message: `Cuenta de ${role} creada.`, token: tokenFor(user), role: user.role, user: publicUser(user) });
});

app.post(['/api/login','/api/auth/login'], authLimiter, async (req, res) => {
  const correo = String(req.body.email || req.body.correo || '').trim().toLowerCase();
  const user = await one('SELECT * FROM users WHERE correo = $1 AND activo = TRUE', [correo]);
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password))) {
    fail(401, 'Correo o contraseña incorrectos.');
  }
  res.json({ token: tokenFor(user), role: user.role, user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/admin-action/verify', authLimiter, requireAuth, allow(ROLES.ADMIN), async (req, res) => {
  if (!(await bcrypt.compare(String(req.body.password || ''), req.user.password))) fail(401, 'Contraseña incorrecta.');
  res.json({ ok: true });
});
app.post('/api/auth/admin-action/change', authLimiter, requireAuth, allow(ROLES.ADMIN), async (req, res) => {
  if (!(await bcrypt.compare(String(req.body.currentPassword || ''), req.user.password))) fail(401, 'La contraseña actual no es correcta.');
  const next = String(req.body.newPassword || '');
  if (next.length < 8) fail(422, 'La contraseña debe tener al menos 8 caracteres.');
  await query('UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2', [await bcrypt.hash(next, 12), req.user.id]);
  res.json({ message: 'Contraseña actualizada.' });
});
app.get('/api/admin/users', requireAuth, allow(ROLES.ADMIN), async (_req, res) => {
  res.json({ users: (await many('SELECT * FROM users ORDER BY created_at DESC')).map(publicUser) });
});

// ---------- Documentos ----------
async function storeDocument(req, project, kind) {
  if (!KINDS.has(kind)) fail(422, 'Tipo no válido.');
  if (!req.file) fail(422, 'Debes adjuntar un PDF.');
  const column = kind === 'recurso' ? 'file_url' : 'signed_form_url';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const next = (await client.query(
      'SELECT COALESCE(MAX(version),0)+1 AS v FROM project_documents WHERE project_id=$1 AND kind=$2',
      [project.id, kind])).rows[0].v;
    await client.query('UPDATE project_documents SET is_current=FALSE WHERE project_id=$1 AND kind=$2', [project.id, kind]);
    await client.query(
      `INSERT INTO project_documents (project_id,kind,version,original_name,mime_type,size,content,uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [project.id, kind, next, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, req.user.id]);
    await client.query(`UPDATE projects SET ${column}=$1, updated_at=NOW() WHERE id=$2`,
      [`/api/projects/${project.id}/documents/${kind}`, project.id]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  const after = await projectById(project.id);
  await audit(req, project.id, `document.${kind}.uploaded`, project, after, `Documento ${kind} cargado.`);
  return after;
}
async function sendDocument(req, res, project) {
  const doc = await one(
    `SELECT original_name, mime_type, content FROM project_documents
     WHERE project_id=$1 AND kind=$2 AND is_current=TRUE ORDER BY version DESC LIMIT 1`,
    [project.id, req.params.kind]);
  if (!doc) fail(404, 'Documento no encontrado.');
  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.original_name)}"`);
  res.send(doc.content);
}

// ---------- Estudiante ----------
const student = express.Router();
student.use(requireAuth, allow(ROLES.STUDENT));

student.get('/tutors', async (_req, res) => {
  res.json({ tutors: await many(`SELECT id, nombre, correo AS email FROM users WHERE role='tutor' AND activo=TRUE ORDER BY nombre`) });
});

student.get('/projects', async (req, res) => {
  const rows = await many(
    `SELECT p.*, t.nombre AS tutor_account_name,
      (SELECT comment FROM tutor_notes n WHERE n.project_id=p.id ORDER BY n.id DESC LIMIT 1) AS latest_note
     FROM projects p LEFT JOIN users t ON t.id=p.tutor_id
     WHERE p.student_id=$1 ORDER BY p.updated_at DESC`, [req.user.id]);
  res.json({ projects: rows.map(r => ({ ...serializeProject(r), ultimaObservacion: r.latest_note })) });
});

student.post('/projects', async (req, res) => {
  const title = String(req.body.titulo || '').trim();
  if (!title) fail(422, 'El título es obligatorio.');
  const tutor = await one(`SELECT id,nombre FROM users WHERE id=$1 AND role='tutor' AND activo=TRUE`, [Number(req.body.tutorId)]);
  if (!tutor) fail(422, 'Selecciona un tutor registrado.');
  const trayecto = ['I','II','III','IV'].includes(req.body.trayecto) ? req.body.trayecto : req.user.trayecto;
  if (!trayecto) fail(422, 'El trayecto es obligatorio.');
  const project = await one(
    `INSERT INTO projects (title,code,slug,resource_type,research_line,authors,tutor_name,year,trayecto,summary,student_id,tutor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [title, req.body.codigoProyecto || null, req.body.slug || null, req.body.tipoRecurso || null,
      req.body.lineaInvestigacion || null, JSON.stringify(parseAuthors(req.body.autores)), tutor.nombre,
      req.body.anioPublicacion || null, trayecto, req.body.resumen || null, req.user.id, tutor.id]);
  await audit(req, project.id, 'student.project.created', null, project, `Enviado al tutor ${tutor.nombre}.`);
  res.status(201).json({ project: serializeProject(project) });
});

async function ownEditable(req) {
  const project = await projectById(req.params.id);
  if (!project || project.student_id !== req.user.id) fail(404, 'Proyecto no encontrado.');
  if (!EDITABLE.has(project.status)) fail(409, 'El proyecto no admite cambios en su estado actual.');
  return project;
}
student.put('/projects/:id/metadata', async (req, res) => {
  const before = await ownEditable(req);
  const after = await one(
    `UPDATE projects SET title=$1,slug=$2,code=$3,resource_type=$4,research_line=$5,authors=$6,
      year=$7,summary=$8,updated_at=NOW() WHERE id=$9 RETURNING *`,
    [String(req.body.titulo || before.title).trim(), req.body.slug ?? before.slug,
      req.body.codigoProyecto ?? before.code, req.body.tipoRecurso ?? before.resource_type,
      req.body.lineaInvestigacion ?? before.research_line,
      JSON.stringify(req.body.autores ? parseAuthors(req.body.autores) : before.authors),
      req.body.anioPublicacion ?? before.year, req.body.resumen ?? before.summary, before.id]);
  await audit(req, before.id, 'student.metadata.updated', before, after, 'Metadatos actualizados.');
  res.json({ project: serializeProject(after) });
});
student.post('/projects/:id/documents/:kind', upload.single('pdf'), async (req, res) => {
  const project = await ownEditable(req);
  res.status(201).json({ project: serializeProject(await storeDocument(req, project, req.params.kind)) });
});
student.get('/projects/:id/documents/:kind', async (req, res) => {
  const project = await projectById(req.params.id);
  if (!project || project.student_id !== req.user.id) fail(404, 'Proyecto no encontrado.');
  await sendDocument(req, res, project);
});
student.post('/projects/:id/resubmit', async (req, res) => {
  const before = await ownEditable(req);
  if (before.status !== STATES.CORRECTION) fail(409, 'Solo se reenvía un proyecto en corrección.');
  if (!before.tutor_id || !before.file_url) fail(422, 'Falta el tutor o el PDF del recurso.');
  const after = await one(`UPDATE projects SET status='pendiente', updated_at=NOW() WHERE id=$1 RETURNING *`, [before.id]);
  await audit(req, before.id, 'student.project.resubmitted', before, after, 'Correcciones reenviadas.');
  res.json({ project: serializeProject(after) });
});
app.use('/api/student', student);

// ---------- Tutor ----------
const tutor = express.Router();
tutor.use(requireAuth, allow(ROLES.TUTOR));
async function assigned(req) {
  const p = await projectById(req.params.id);
  if (!p || p.tutor_id !== req.user.id) fail(403, 'El proyecto no está asignado a este tutor.');
  return p;
}
tutor.get('/projects', async (req, res) => {
  const rows = await many(
    `SELECT p.*, s.nombre AS student_name FROM projects p JOIN users s ON s.id=p.student_id
     WHERE p.tutor_id=$1 ORDER BY p.updated_at DESC`, [req.user.id]);
  res.json({ projects: rows.map(r => ({ ...serializeProject(r), estudianteNombre: r.student_name })) });
});
tutor.get('/projects/:id/documents/:kind', async (req, res) => sendDocument(req, res, await assigned(req)));
tutor.post('/projects/:id/notes', async (req, res) => {
  const before = await assigned(req);
  if (before.status !== STATES.PENDING) fail(409, 'Solo puedes devolver proyectos pendientes.');
  const comment = String(req.body.comentario || '').trim();
  if (comment.length < 3) fail(422, 'La observación es obligatoria.');
  await query('INSERT INTO tutor_notes (project_id,author_id,kind,comment) VALUES ($1,$2,$3,$4)',
    [before.id, req.user.id, req.body.tipo || 'general', comment]);
  const after = await one(`UPDATE projects SET status='en_correccion', updated_at=NOW() WHERE id=$1 RETURNING *`, [before.id]);
  await audit(req, before.id, 'tutor.correction.requested', before, after, comment);
  res.json({ project: serializeProject(after) });
});
tutor.post('/projects/:id/send-to-admin', async (req, res) => {
  const before = await assigned(req);
  if (before.status !== STATES.PENDING) fail(409, 'El estado actual no permite el visto bueno.');
  if (!before.file_url || !before.signed_form_url) fail(422, 'Faltan el recurso o la planilla firmada.');
  const after = await one(
    `UPDATE projects SET status='en_validacion', tutor_approved_at=NOW(), sent_by_tutor=$1,
      sent_at=NOW(), updated_at=NOW() WHERE id=$2 RETURNING *`, [req.user.nombre, before.id]);
  await audit(req, before.id, 'tutor.sent_to_admin', before, after, 'Aprobado y enviado al administrador.');
  res.json({ project: serializeProject(after) });
});
tutor.post('/projects/:id/approve', (req, res, next) => {
  req.url = `/projects/${req.params.id}/send-to-admin`;
  tutor.handle(req, res, next);
});
app.use('/api/tutor', tutor);

// ---------- Administrador ----------
const admin = express.Router();
admin.use(requireAuth, allow(ROLES.ADMIN));
admin.get('/projects', async (_req, res) => {
  const rows = await many(
    `SELECT p.*, s.nombre AS student_name, t.nombre AS tutor_account_name
     FROM projects p JOIN users s ON s.id=p.student_id LEFT JOIN users t ON t.id=p.tutor_id
     ORDER BY p.updated_at DESC`);
  res.json({ projects: rows.map(r => ({ ...serializeProject(r), estudianteNombre: r.student_name, tutorAsignado: r.tutor_account_name })) });
});
admin.get('/projects/:id/documents/:kind', async (req, res) => {
  const p = await projectById(req.params.id);
  if (!p) fail(404, 'Proyecto no encontrado.');
  await sendDocument(req, res, p);
});
admin.post('/projects/:id/publish', async (req, res) => {
  const before = await projectById(req.params.id);
  if (!before) fail(404, 'Proyecto no encontrado.');
  if (before.status !== STATES.VALIDATION) fail(409, 'El proyecto debe estar aprobado por el tutor.');
  if (!before.file_url || !before.signed_form_url) fail(422, 'Faltan documentos obligatorios.');
  const after = await one(`UPDATE projects SET status='publicado', published_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *`, [before.id]);
  await audit(req, before.id, 'admin.published', before, after, 'Proyecto publicado.');
  res.json({ project: serializeProject(after) });
});
admin.post('/projects/:id/request-changes', async (req, res) => {
  const before = await projectById(req.params.id);
  if (!before) fail(404, 'Proyecto no encontrado.');
  if (before.status !== STATES.VALIDATION) fail(409, 'Solo se devuelven proyectos en validación.');
  const comment = String(req.body.observacion || '').trim();
  if (comment.length < 5) fail(422, 'Indica qué debe corregirse.');
  await query('INSERT INTO tutor_notes (project_id,author_id,kind,comment) VALUES ($1,$2,$3,$4)',
    [before.id, req.user.id, 'general', `[Administración] ${comment}`]);
  const after = await one(
    `UPDATE projects SET status='en_correccion', tutor_approved_at=NULL, updated_at=NOW() WHERE id=$1 RETURNING *`, [before.id]);
  await audit(req, before.id, 'admin.changes_requested', before, after, comment);
  res.json({ project: serializeProject(after) });
});
admin.post('/projects/:id/reject', async (req, res) => {
  const before = await projectById(req.params.id);
  if (!before) fail(404, 'Proyecto no encontrado.');
  if (before.status === STATES.PUBLISHED) fail(409, 'Un proyecto publicado no puede rechazarse.');
  const reason = String(req.body.motivo || '').trim();
  if (reason.length < 5) fail(422, 'Indica el motivo del rechazo.');
  const after = await one(
    `UPDATE projects SET status='rechazado', rejected_at=NOW(), rejection_reason=$1, updated_at=NOW()
     WHERE id=$2 RETURNING *`, [reason, before.id]);
  await audit(req, before.id, 'admin.rejected', before, after, reason);
  res.json({ project: serializeProject(after) });
});
admin.get('/audit', async (_req, res) => {
  res.json({ audits: await many(
    `SELECT a.*, u.nombre AS actor_name, p.title AS project_title FROM project_audits a
     JOIN users u ON u.id=a.actor_id LEFT JOIN projects p ON p.id=a.project_id
     ORDER BY a.created_at ASC`) });
});
app.use('/api/admin', admin);

// Acceso a documentos con permiso por rol.
app.get('/api/projects/:id/documents/:kind', requireAuth, async (req, res) => {
  const p = await projectById(req.params.id);
  if (!p) fail(404, 'Proyecto no encontrado.');
  const ok = req.user.role === ROLES.ADMIN
    || (req.user.role === ROLES.STUDENT && p.student_id === req.user.id)
    || (req.user.role === ROLES.TUTOR && p.tutor_id === req.user.id);
  if (!ok) fail(403, 'No tienes acceso.');
  await sendDocument(req, res, p);
});

// ---------- IA ----------
app.post('/api/ai/analyze', authLimiter, requireAuth, async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 12000);
  if (!process.env.GEMINI_API_KEY) fail(503, 'IA no configurada.');
  if (text.length < 30) fail(422, 'Texto insuficiente.');
  const prompt = `Extrae metadatos académicos de Informática y responde solo JSON: {"titulo":"","codigo_proyecto":"","slug":"","tipo_recurso":"","pnf":"Informática","linea":"","autores":[],"tutor":"","anio":""}\nTexto:${text}`;
  const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 } }),
  });
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) fail(upstream.status, 'No fue posible analizar el documento.');
  try {
    res.json(JSON.parse((payload?.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json|```/gi, '').trim()));
  } catch { fail(502, 'La IA devolvió datos inválidos.'); }
});

// ---------- Frontend ----------
const distDir = path.join(__dirname, 'dist');
app.use(express.static(distDir));
<<<<<<< HEAD
app.get('/', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
app.use('/api', (_req, res) => res.status(404).json({ message: 'Ruta no encontrada.' }));
app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ message: status >= 500 ? 'Error interno del servidor.' : error.message });
});

app.listen(port, () => process.stdout.write(`BRIANA activo en http://localhost:${port}\n`));
=======
app.get('/',(_req,res)=>res.sendFile(path.join(distDir,'index.html')));
app.use((_err,_req,res,_next)=>res.status(500).json({message:'Error interno.'}));
app.listen(port,()=>process.stdout.write(`BRIANA activo en http://localhost:${port}\n`));
>>>>>>> f30e0f4d90259bfb99a0416d387aaef4f02e2286
