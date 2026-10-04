import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { createRoleVerifier } from './server/middleware/rbac.js';
import { createStudentRouter } from './server/routes/student.routes.js';
import { createTutorRouter } from './server/routes/tutor.routes.js';
import { createAdminRouter } from './server/routes/admin.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const documentsDir = path.join(dataDir, 'private', 'projects');
const tempDir = path.join(dataDir, 'private', 'tmp');
const recoveryCodes = new Map();

const ROLES = Object.freeze({
  STUDENT: 'estudiante',
  TUTOR: 'tutor',
  ADMIN: 'administrador',
});
const STATES = Object.freeze({
  PENDING: 'pendiente',
  CORRECTION: 'en_correccion',
  VALIDATION: 'en_validacion',
  PUBLISHED: 'publicado',
  REJECTED: 'rechazado',
});
const EDITABLE_STUDENT_STATES = new Set([STATES.PENDING, STATES.CORRECTION]);
const DOCUMENT_TYPES = new Set(['recurso', 'planilla']);

for (const key of ['JWT_SECRET', 'RECOVERY_CODE_PEPPER']) {
  if (!process.env[key]) throw new Error(`Falta la variable de entorno ${key}.`);
}

await fs.mkdir(documentsDir, { recursive: true });
await fs.mkdir(tempDir, { recursive: true });

const db = new Database(path.join(dataDir, 'briana.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function tableSql(name) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql || '';
}

function createUsersTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      cedula TEXT NOT NULL UNIQUE
        CHECK (length(cedula) = 8 AND cedula NOT GLOB '*[^0-9]*'),
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      telefono TEXT NOT NULL
        CHECK (length(telefono) = 11 AND telefono NOT GLOB '*[^0-9]*'),
      trayecto TEXT CHECK (trayecto IS NULL OR trayecto IN ('I','II','III','IV')),
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'estudiante'
        CHECK (rol IN ('estudiante','tutor','administrador')),
      CHECK (rol <> 'estudiante' OR trayecto IS NOT NULL),
      activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cedula ON users(cedula);
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(rol);
  `);
}

// Migra el esquema anterior (usuario/administrador) sin eliminar cuentas existentes.
const oldUsersSchema = tableSql('users');
if (oldUsersSchema && (!oldUsersSchema.includes("'estudiante'") || !oldUsersSchema.includes('cedula'))) {
  db.pragma('foreign_keys = OFF');
  db.pragma('legacy_alter_table = ON');
  db.transaction(() => {
    db.exec('ALTER TABLE users RENAME TO users_legacy');
    createUsersTable();
    db.exec(`
      INSERT INTO users (id,nombre,cedula,email,telefono,trayecto,password_hash,rol,activo,created_at,updated_at)
      SELECT id,nombre,
        printf('%08d', id % 100000000),
        email,
        CASE
          WHEN length(telefono)=11 AND telefono NOT GLOB '*[^0-9]*' THEN telefono
          ELSE printf('0412%07d', id % 10000000)
        END,
        CASE WHEN rol IN ('administrador','tutor') THEN NULL ELSE 'I' END,
        password_hash,
        CASE
          WHEN rol='administrador' THEN 'administrador'
          WHEN rol='tutor' THEN 'tutor'
          ELSE 'estudiante'
        END,
        activo,created_at,updated_at
      FROM users_legacy;
      DROP TABLE users_legacy;
    `);
  })();
  db.pragma('legacy_alter_table = OFF');
  db.pragma('foreign_keys = ON');
} else {
  createUsersTable();
}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_cedula ON users(cedula);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(rol);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    estudiante_id INTEGER NOT NULL,
    tutor_id INTEGER,
    titulo TEXT NOT NULL,
    slug TEXT,
    codigo_proyecto TEXT,
    tipo_recurso TEXT,
    pnf TEXT NOT NULL DEFAULT 'Informática',
    linea_investigacion TEXT,
    autores_json TEXT NOT NULL DEFAULT '[]',
    tutor_nombre TEXT,
    anio_publicacion TEXT,
    trayecto TEXT CHECK (trayecto IS NULL OR trayecto IN ('I','II','III','IV')),
    enviado_por_tutor TEXT,
    enviado_en TEXT,
    resumen TEXT,
    resource_path TEXT,
    planilla_path TEXT,
    estado TEXT NOT NULL DEFAULT 'pendiente'
      CHECK (estado IN ('pendiente','en_correccion','en_validacion','publicado','rechazado')),
    tutor_approved_at TEXT,
    published_at TEXT,
    rejected_at TEXT,
    rejection_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (estudiante_id) REFERENCES users(id) ON DELETE RESTRICT,
    FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS project_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('recurso','planilla')),
    version INTEGER NOT NULL DEFAULT 1,
    original_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_by INTEGER NOT NULL,
    is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0,1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,
    UNIQUE (project_id,tipo,version)
  );

  CREATE TABLE IF NOT EXISTS tutor_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    tutor_id INTEGER NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'metodologica'
      CHECK (tipo IN ('metodologica','tecnica','general')),
    comentario TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS project_audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    actor_id INTEGER NOT NULL,
    accion TEXT NOT NULL,
    estado_anterior TEXT,
    estado_nuevo TEXT,
    valores_anteriores_json TEXT,
    valores_nuevos_json TEXT,
    descripcion TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT
  );

  CREATE INDEX IF NOT EXISTS idx_projects_student ON projects(estudiante_id);
  CREATE INDEX IF NOT EXISTS idx_projects_trayecto ON projects(trayecto);
  CREATE INDEX IF NOT EXISTS idx_projects_tutor ON projects(tutor_id);
  CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(estado);
  CREATE INDEX IF NOT EXISTS idx_documents_current ON project_documents(project_id,tipo,is_current);
  CREATE INDEX IF NOT EXISTS idx_notes_project ON tutor_notes(project_id);
  CREATE INDEX IF NOT EXISTS idx_audits_project ON project_audits(project_id,created_at);
`);

// Migración incremental para bases de datos creadas antes del trayecto por proyecto.
for (const [column, definition] of [
  ['trayecto', "TEXT CHECK (trayecto IS NULL OR trayecto IN ('I','II','III','IV'))"],
  ['enviado_por_tutor', 'TEXT'],
  ['enviado_en', 'TEXT'],
]) {
  const exists = db.prepare('PRAGMA table_info(projects)').all().some(c => c.name === column);
  if (!exists) db.exec(`ALTER TABLE projects ADD COLUMN ${column} ${definition}`);
}

const normalizePhone = value => String(value || '').replace(/\D/g, '');
const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const safeJson = (value, fallback) => {
  try { return JSON.parse(value); } catch { return fallback; }
};
const publicUser = user => ({
  id: user.id, nombre: user.nombre, cedula: user.cedula, email: user.email,
  telefono: user.telefono,
  ...(user.rol === ROLES.STUDENT ? { trayecto: user.trayecto } : {}),
  rol: user.rol, activo: Boolean(user.activo),
});

async function seedAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_LOGIN_PASSWORD || '');
  if (!email || !password) return;
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return;
  db.prepare(`INSERT INTO users (nombre,cedula,email,telefono,trayecto,password_hash,rol) VALUES (?,?,?,?,?,?,?)`).run(
    process.env.ADMIN_NAME || 'Administrador BRIANA',
    String(process.env.ADMIN_CEDULA || '00000000'),
    email,
    normalizePhone(process.env.ADMIN_PHONE || '04120000000'),
    null,
    await bcrypt.hash(password, 12),
    ROLES.ADMIN,
  );
}
await seedAdmin();

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin(origin, callback) {
    const allowed = String(process.env.FRONTEND_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
    callback(!origin || !allowed.length || allowed.includes(origin) ? null : new Error('Origen no autorizado.'), true);
  },
  methods: ['GET','POST','PUT','PATCH','DELETE'],
  allowedHeaders: ['Content-Type','Authorization'],
}));
app.use(express.json({ limit: '256kb' }));

const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 15, message: { message: 'Demasiados intentos.' } });
const recoveryLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, message: { message: 'Demasiadas solicitudes.' } });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, tempDir),
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase() || '.pdf'}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(file.mimetype === 'application/pdf' ? null : new Error('Solo se permiten archivos PDF.'), file.mimetype === 'application/pdf'),
});

function tokenFor(user) {
  return jwt.sign({ sub: String(user.id), role: user.rol }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h', issuer: 'briana-api', audience: 'briana-panel',
  });
}

function requireAuth(req, res, next) {
  try {
    const value = String(req.headers.authorization || '');
    const payload = jwt.verify(value.startsWith('Bearer ') ? value.slice(7) : '', process.env.JWT_SECRET, { issuer: 'briana-api', audience: 'briana-panel' });
    req.user = db.prepare('SELECT * FROM users WHERE id=? AND activo=1').get(Number(payload.sub));
    if (!req.user) throw new Error();
    next();
  } catch { res.status(401).json({ message: 'La sesión expiró o no es válida.' }); }
}
const allowRoles = (...roles) => (req, res, next) => roles.includes(req.user.rol)
  ? next()
  : res.status(403).json({ message: 'No tienes permiso para realizar esta acción.' });

const verifyRole = createRoleVerifier({
  db,
  jwtSecret: process.env.JWT_SECRET,
});

function projectById(id) { return db.prepare('SELECT * FROM projects WHERE id=?').get(Number(id)); }
function canView(user, project) {
  return user.rol === ROLES.ADMIN
    || (user.rol === ROLES.STUDENT && project.estudiante_id === user.id)
    || (user.rol === ROLES.TUTOR && project.tutor_id === user.id);
}
function serializeProject(row) {
  if (!row) return null;
  return {
    id: row.id, estudianteId: row.estudiante_id, tutorId: row.tutor_id,
    titulo: row.titulo, slug: row.slug, codigoProyecto: row.codigo_proyecto,
    tipoRecurso: row.tipo_recurso, pnf: row.pnf, lineaInvestigacion: row.linea_investigacion,
    autores: safeJson(row.autores_json, []), tutorNombre: row.tutor_nombre,
    anioPublicacion: row.anio_publicacion, resumen: row.resumen,
    resourcePath: row.resource_path, planillaPath: row.planilla_path,
    estado: row.estado, tutorApprovedAt: row.tutor_approved_at,
    publishedAt: row.published_at, rejectedAt: row.rejected_at,
    rejectionReason: row.rejection_reason, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function audit(req, projectId, action, before, after, description) {
  db.prepare(`INSERT INTO project_audits
    (project_id,actor_id,accion,estado_anterior,estado_nuevo,valores_anteriores_json,valores_nuevos_json,descripcion,ip_address,user_agent)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    projectId, req.user.id, action, before?.estado || null, after?.estado || null,
    before ? JSON.stringify(serializeProject(before)) : null,
    after ? JSON.stringify(serializeProject(after)) : null,
    description || null, req.ip, String(req.headers['user-agent'] || '').slice(0, 500),
  );
}
const parseAuthors = value => Array.isArray(value)
  ? value.map(String).map(v => v.trim()).filter(Boolean)
  : String(value || '').split(';').map(v => v.trim()).filter(Boolean);

// ---------- Autenticación y usuarios ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post(['/api/register','/api/auth/register'], authLimiter, async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const cedula = String(req.body.cedula || '').replace(/\D/g, '');
  const email = String(req.body.email || '').trim().toLowerCase();
  const telefono = normalizePhone(req.body.telefono);
  const trayecto = req.body.trayecto ? String(req.body.trayecto) : null;
  const password = String(req.body.password || '');
  const requestedRole = [ROLES.STUDENT, ROLES.TUTOR, ROLES.ADMIN].includes(req.body.rolSolicitado)
    ? req.body.rolSolicitado
    : ROLES.STUDENT;
  if (nombre.length < 2 || !validEmail(email) || password.length < 8) return res.status(422).json({ message: 'Revisa nombre, correo y contraseña (mínimo 8 caracteres).' });
  if (!/^\d{8}$/.test(cedula)) return res.status(422).json({ message: 'La cédula debe contener exactamente 8 dígitos.' });
  if (!/^\d{11}$/.test(telefono)) return res.status(422).json({ message: 'El teléfono debe contener exactamente 11 dígitos.' });
  if (requestedRole === ROLES.STUDENT && !['I','II','III','IV'].includes(trayecto)) {
    return res.status(422).json({ message: 'El trayecto es obligatorio para la cuenta de estudiante.' });
  }
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ message: 'El correo ya está registrado.' });
  if (db.prepare('SELECT id FROM users WHERE cedula=?').get(cedula)) return res.status(409).json({ message: 'La cédula ya está registrada.' });
  const result = db.prepare('INSERT INTO users (nombre,cedula,email,telefono,trayecto,password_hash,rol) VALUES (?,?,?,?,?,?,?)').run(
    nombre, cedula, email, telefono,
    requestedRole === ROLES.STUDENT ? trayecto : null,
    await bcrypt.hash(password, 12), requestedRole,
  );
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
  res.status(201).json({
    message: `Cuenta de ${requestedRole} creada correctamente.`,
    token: tokenFor(user),
    user: publicUser(user),
  });
});
app.post(['/api/login','/api/auth/login'], authLimiter, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE email=? AND activo=1').get(String(req.body.email || '').trim().toLowerCase());
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) return res.status(401).json({ message: 'Correo o contraseña incorrectos.' });
  res.json({ token: tokenFor(user), user: publicUser(user), expiresInSeconds: 28_800 });
});
app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));
app.get('/api/admin/users', requireAuth, allowRoles(ROLES.ADMIN), (_req, res) => {
  res.json({ users: db.prepare('SELECT * FROM users ORDER BY created_at DESC').all().map(publicUser) });
});
app.patch('/api/admin/users/:id/role', requireAuth, allowRoles(ROLES.ADMIN), (req, res) => {
  const role = String(req.body.rol || '');
  if (!Object.values(ROLES).includes(role)) return res.status(422).json({ message: 'Rol no válido.' });
  db.prepare('UPDATE users SET rol=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(role, Number(req.params.id));
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.params.id))) });
});
app.post('/api/auth/admin-action/verify', authLimiter, requireAuth, allowRoles(ROLES.ADMIN), async (req, res) => {
  if (!(await bcrypt.compare(String(req.body.password || ''), req.user.password_hash))) return res.status(401).json({ message: 'Contraseña administrativa incorrecta.' });
  res.json({ ok: true });
});
app.post('/api/auth/admin-action/change', authLimiter, requireAuth, allowRoles(ROLES.ADMIN), async (req, res) => {
  if (!(await bcrypt.compare(String(req.body.currentPassword || ''), req.user.password_hash))) return res.status(401).json({ message: 'La contraseña actual no es correcta.' });
  if (String(req.body.newPassword || '').length < 8) return res.status(422).json({ message: 'La contraseña debe tener al menos 8 caracteres.' });
  db.prepare('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(await bcrypt.hash(req.body.newPassword, 12), req.user.id);
  res.json({ message: 'Contraseña actualizada.' });
});

// Rutas oficiales segmentadas por perfil. Cada router aplica verifyRole()
// antes de ejecutar cualquier controlador de negocio.
app.use('/api/student', createStudentRouter({
  db,
  verifyRole,
  upload,
  dataDir,
  documentsDir,
}));
app.use('/api/tutor', createTutorRouter({
  db,
  verifyRole,
  dataDir,
}));
app.use('/api/admin', createAdminRouter({
  db,
  verifyRole,
  upload,
  dataDir,
  documentsDir,
}));

// ---------- Compatibilidad temporal con endpoints sin prefijo ----------
app.post('/api/projects', requireAuth, allowRoles(ROLES.STUDENT, ROLES.ADMIN), (req, res) => {
  const studentId = req.user.rol === ROLES.ADMIN ? Number(req.body.estudianteId) : req.user.id;
  const student = db.prepare('SELECT id FROM users WHERE id=? AND rol=?').get(studentId, ROLES.STUDENT);
  if (!student) return res.status(422).json({ message: 'Estudiante no válido.' });
  const title = String(req.body.titulo || '').trim();
  if (!title) return res.status(422).json({ message: 'El título es obligatorio.' });
  const result = db.prepare(`INSERT INTO projects
    (estudiante_id,titulo,slug,codigo_proyecto,tipo_recurso,pnf,linea_investigacion,autores_json,tutor_nombre,anio_publicacion,resumen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    studentId, title, req.body.slug || null, req.body.codigoProyecto || null,
    req.body.tipoRecurso || null, 'Informática', req.body.lineaInvestigacion || null,
    JSON.stringify(parseAuthors(req.body.autores)), req.body.tutorNombre || null,
    req.body.anioPublicacion || null, req.body.resumen || null,
  );
  const project = projectById(result.lastInsertRowid);
  audit(req, project.id, 'project.created', null, project, 'Proyecto creado en estado pendiente.');
  res.status(201).json({ project: serializeProject(project) });
});
app.get('/api/projects', requireAuth, (req, res) => {
  let rows;
  if (req.user.rol === ROLES.ADMIN) rows = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  else if (req.user.rol === ROLES.TUTOR) rows = db.prepare('SELECT * FROM projects WHERE tutor_id=? ORDER BY updated_at DESC').all(req.user.id);
  else rows = db.prepare('SELECT * FROM projects WHERE estudiante_id=? ORDER BY updated_at DESC').all(req.user.id);
  res.json({ projects: rows.map(serializeProject) });
});
app.get('/api/student/projects', requireAuth, allowRoles(ROLES.STUDENT), (req, res) => res.json({ projects: db.prepare('SELECT * FROM projects WHERE estudiante_id=? ORDER BY updated_at DESC').all(req.user.id).map(serializeProject) }));
app.get('/api/tutor/projects', requireAuth, allowRoles(ROLES.TUTOR), (req, res) => res.json({ projects: db.prepare('SELECT * FROM projects WHERE tutor_id=? ORDER BY updated_at DESC').all(req.user.id).map(serializeProject) }));
app.get('/api/admin/projects', requireAuth, allowRoles(ROLES.ADMIN), (_req, res) => res.json({ projects: db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all().map(serializeProject) }));
app.get('/api/projects/:id', requireAuth, (req, res) => {
  const project = projectById(req.params.id);
  if (!project) return res.status(404).json({ message: 'Proyecto no encontrado.' });
  if (!canView(req.user, project)) return res.status(403).json({ message: 'No tienes acceso a este proyecto.' });
  const notes = db.prepare(`SELECT n.*,u.nombre AS tutor_nombre FROM tutor_notes n JOIN users u ON u.id=n.tutor_id WHERE n.project_id=? ORDER BY n.created_at ASC`).all(project.id);
  res.json({ project: serializeProject(project), notes });
});
app.put('/api/projects/:id/metadata', requireAuth, (req, res) => {
  const before = projectById(req.params.id);
  if (!before) return res.status(404).json({ message: 'Proyecto no encontrado.' });
  const studentAllowed = req.user.rol === ROLES.STUDENT && before.estudiante_id === req.user.id && EDITABLE_STUDENT_STATES.has(before.estado);
  if (!studentAllowed && req.user.rol !== ROLES.ADMIN) return res.status(403).json({ message: 'Los metadatos están bloqueados para tu rol o estado actual.' });
  db.prepare(`UPDATE projects SET titulo=?,slug=?,codigo_proyecto=?,tipo_recurso=?,linea_investigacion=?,autores_json=?,tutor_nombre=?,anio_publicacion=?,resumen=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
    String(req.body.titulo || before.titulo).trim(), req.body.slug ?? before.slug,
    req.body.codigoProyecto ?? before.codigo_proyecto, req.body.tipoRecurso ?? before.tipo_recurso,
    req.body.lineaInvestigacion ?? before.linea_investigacion,
    JSON.stringify(req.body.autores ? parseAuthors(req.body.autores) : safeJson(before.autores_json, [])),
    req.body.tutorNombre ?? before.tutor_nombre, req.body.anioPublicacion ?? before.anio_publicacion,
    req.body.resumen ?? before.resumen, before.id,
  );
  const after = projectById(before.id);
  audit(req, before.id, 'project.metadata.updated', before, after, 'Metadatos actualizados.');
  res.json({ project: serializeProject(after) });
});
app.patch('/api/projects/:id/assign-tutor', requireAuth, allowRoles(ROLES.ADMIN), (req, res) => {
  const before = projectById(req.params.id);
  const tutor = db.prepare('SELECT id,nombre FROM users WHERE id=? AND rol=? AND activo=1').get(Number(req.body.tutorId), ROLES.TUTOR);
  if (!before || !tutor) return res.status(422).json({ message: 'Proyecto o tutor no válido.' });
  db.prepare('UPDATE projects SET tutor_id=?,tutor_nombre=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(tutor.id, tutor.nombre, before.id);
  const after = projectById(before.id); audit(req, before.id, 'project.tutor.assigned', before, after, `Tutor asignado: ${tutor.nombre}`);
  res.json({ project: serializeProject(after) });
});

// ---------- Documentos privados ----------
app.post('/api/projects/:id/documents/:type', requireAuth, upload.single('pdf'), async (req, res) => {
  const project = projectById(req.params.id);
  const type = req.params.type;
  const removeTemp = async () => { if (req.file) await fs.unlink(req.file.path).catch(() => {}); };
  if (!project || !DOCUMENT_TYPES.has(type) || !req.file) { await removeTemp(); return res.status(422).json({ message: 'Proyecto, tipo o PDF no válido.' }); }
  const studentAllowed = req.user.rol === ROLES.STUDENT && project.estudiante_id === req.user.id && EDITABLE_STUDENT_STATES.has(project.estado);
  if (!studentAllowed && req.user.rol !== ROLES.ADMIN) { await removeTemp(); return res.status(403).json({ message: 'No puedes adjuntar documentos en este estado.' }); }

  const projectDir = path.join(documentsDir, String(project.id)); await fs.mkdir(projectDir, { recursive: true });
  const version = (db.prepare('SELECT MAX(version) v FROM project_documents WHERE project_id=? AND tipo=?').get(project.id, type).v || 0) + 1;
  const destination = path.join(projectDir, `${type}-v${version}-${crypto.randomUUID()}.pdf`);
  await fs.rename(req.file.path, destination);
  const relativePath = path.relative(dataDir, destination);
  db.transaction(() => {
    db.prepare('UPDATE project_documents SET is_current=0 WHERE project_id=? AND tipo=?').run(project.id, type);
    db.prepare(`INSERT INTO project_documents (project_id,tipo,version,original_name,storage_path,mime_type,size,uploaded_by) VALUES (?,?,?,?,?,?,?,?)`)
      .run(project.id, type, version, req.file.originalname, relativePath, req.file.mimetype, req.file.size, req.user.id);
    db.prepare(`UPDATE projects SET ${type === 'recurso' ? 'resource_path' : 'planilla_path'}=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(relativePath, project.id);
  })();
  const after = projectById(project.id); audit(req, project.id, `document.${type}.uploaded`, project, after, `Documento ${type} cargado, versión ${version}.`);
  res.status(201).json({ project: serializeProject(after), document: { tipo: type, version, originalName: req.file.originalname } });
});
app.get('/api/projects/:id/documents/:type', requireAuth, (req, res) => {
  const project = projectById(req.params.id); if (!project) return res.status(404).json({ message: 'Proyecto no encontrado.' });
  if (!canView(req.user, project)) return res.status(403).json({ message: 'No tienes acceso.' });
  const doc = db.prepare('SELECT * FROM project_documents WHERE project_id=? AND tipo=? AND is_current=1 ORDER BY version DESC LIMIT 1').get(project.id, req.params.type);
  if (!doc) return res.status(404).json({ message: 'Documento no encontrado.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(doc.original_name)}"`);
  res.sendFile(path.join(dataDir, doc.storage_path));
});

// ---------- Acciones del tutor ----------
app.post('/api/tutor/projects/:id/notes', requireAuth, allowRoles(ROLES.TUTOR), (req, res) => {
  const before = projectById(req.params.id);
  if (!before || before.tutor_id !== req.user.id) return res.status(403).json({ message: 'El proyecto no está asignado a este tutor.' });
  if ([STATES.PUBLISHED, STATES.REJECTED].includes(before.estado)) return res.status(409).json({ message: 'El proyecto está cerrado.' });
  const comment = String(req.body.comentario || '').trim(); if (comment.length < 3) return res.status(422).json({ message: 'La observación es obligatoria.' });
  const type = ['metodologica','tecnica','general'].includes(req.body.tipo) ? req.body.tipo : 'general';
  db.transaction(() => {
    db.prepare('INSERT INTO tutor_notes (project_id,tutor_id,tipo,comentario) VALUES (?,?,?,?)').run(before.id, req.user.id, type, comment);
    db.prepare('UPDATE projects SET estado=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(STATES.CORRECTION, before.id);
  })();
  const after = projectById(before.id); audit(req, before.id, 'tutor.correction.requested', before, after, comment);
  res.json({ project: serializeProject(after) });
});
app.post('/api/tutor/projects/:id/approve', requireAuth, allowRoles(ROLES.TUTOR), (req, res) => {
  const before = projectById(req.params.id);
  if (!before || before.tutor_id !== req.user.id) return res.status(403).json({ message: 'El proyecto no está asignado a este tutor.' });
  if (!EDITABLE_STUDENT_STATES.has(before.estado)) return res.status(409).json({ message: 'El estado actual no permite el visto bueno.' });
  if (!before.resource_path || !before.planilla_path) return res.status(422).json({ message: 'El recurso y la planilla firmada son obligatorios.' });
  db.prepare('UPDATE projects SET estado=?,tutor_approved_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(STATES.VALIDATION, before.id);
  const after = projectById(before.id); audit(req, before.id, 'tutor.approved', before, after, 'Tutor otorgó visto bueno académico.');
  res.json({ project: serializeProject(after) });
});

// ---------- Cierre administrativo ----------
app.post('/api/admin/projects/:id/publish', requireAuth, allowRoles(ROLES.ADMIN), (req, res) => {
  const before = projectById(req.params.id); if (!before) return res.status(404).json({ message: 'Proyecto no encontrado.' });
  if (before.estado !== STATES.VALIDATION) return res.status(409).json({ message: 'El proyecto debe estar En Validación.' });
  if (!before.resource_path || !before.planilla_path) return res.status(422).json({ message: 'Faltan documentos obligatorios.' });
  db.prepare('UPDATE projects SET estado=?,published_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(STATES.PUBLISHED, before.id);
  const after = projectById(before.id); audit(req, before.id, 'admin.published', before, after, 'Administrador cerró y publicó el proyecto.');
  res.json({ project: serializeProject(after) });
});
app.post('/api/admin/projects/:id/reject', requireAuth, allowRoles(ROLES.ADMIN), (req, res) => {
  const before = projectById(req.params.id); if (!before) return res.status(404).json({ message: 'Proyecto no encontrado.' });
  if (before.estado === STATES.PUBLISHED) return res.status(409).json({ message: 'Un proyecto publicado no puede rechazarse.' });
  const reason = String(req.body.motivo || '').trim(); if (reason.length < 5) return res.status(422).json({ message: 'Indica el motivo del rechazo.' });
  db.prepare('UPDATE projects SET estado=?,rejected_at=CURRENT_TIMESTAMP,rejection_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(STATES.REJECTED, reason, before.id);
  const after = projectById(before.id); audit(req, before.id, 'admin.rejected', before, after, reason);
  res.json({ project: serializeProject(after) });
});
app.get('/api/admin/audit', requireAuth, allowRoles(ROLES.ADMIN), (_req, res) => {
  const audits = db.prepare(`SELECT a.*,u.nombre actor_nombre,p.titulo project_title FROM project_audits a JOIN users u ON u.id=a.actor_id LEFT JOIN projects p ON p.id=a.project_id ORDER BY a.created_at ASC`).all();
  res.json({ audits });
});

// ---------- IA y recuperación ----------
app.post('/api/ai/analyze', authLimiter, requireAuth, async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 12_000);
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ message: 'IA no configurada.' });
  if (text.length < 30) return res.status(422).json({ message: 'Texto insuficiente.' });
  const prompt = `Extrae metadatos académicos de Informática y responde solo JSON: {"titulo":"","codigo_proyecto":"","slug":"","tipo_recurso":"","pnf":"Informática","linea":"","autores":[],"tutor":"","anio":""}\nTexto:${text}`;
  const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } }) });
  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) return res.status(upstream.status).json({ message: 'No fue posible analizar el documento.' });
  try { res.json(JSON.parse((payload?.candidates?.[0]?.content?.parts?.[0]?.text || '').replace(/```json|```/gi, '').trim())); }
  catch { res.status(502).json({ message: 'La IA devolvió datos inválidos.' }); }
});

const codeHash = code => crypto.createHash('sha256').update(`${process.env.RECOVERY_CODE_PEPPER}:${code}`).digest('hex');
const safeEqual = (a, b) => { const x=Buffer.from(a,'hex'), y=Buffer.from(b,'hex'); return x.length===y.length && crypto.timingSafeEqual(x,y); };
const mailer = process.env.EMAIL_USER && process.env.EMAIL_PASS ? nodemailer.createTransport({ service:'gmail', auth:{ user:process.env.EMAIL_USER, pass:process.env.EMAIL_PASS } }) : null;
app.post('/api/auth/recovery/request', recoveryLimiter, async (req, res) => {
  const channel = req.body.channel === 'whatsapp' ? 'whatsapp' : 'email';
  const contact = String(req.body.contact || '').trim();
  const user = channel === 'email' ? db.prepare('SELECT * FROM users WHERE email=? AND activo=1').get(contact.toLowerCase()) : db.prepare('SELECT * FROM users WHERE telefono=? AND activo=1').get(normalizePhone(contact));
  const id=crypto.randomUUID(), code=crypto.randomInt(100000,1000000).toString();
  recoveryCodes.set(id,{ userId:user?.id||null, codeHash:user?codeHash(code):codeHash(crypto.randomBytes(12).toString('hex')), expiresAt:Date.now()+600000, attempts:0 });
  if (user) {
    try {
      if (channel === 'email') {
        if (!mailer) throw new Error();
        await mailer.sendMail({ from:`BRIANA <${process.env.EMAIL_USER}>`, to:user.email, subject:'Código de recuperación BRIANA', text:`Tu código es ${code}. Expira en 10 minutos.` });
      } else {
        if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID || !user.telefono) throw new Error();
        const body={ messaging_product:'whatsapp',to:normalizePhone(user.telefono),type:'text',text:{body:`BRIANA: tu código es ${code}. Expira en 10 minutos.`} };
        const result=await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION||'v22.0'}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!result.ok) throw new Error();
      }
    } catch { recoveryCodes.delete(id); return res.status(502).json({message:'No fue posible enviar el código.'}); }
  }
  const destination=user?(channel==='email'?`${user.email.slice(0,2)}***${user.email.slice(user.email.indexOf('@'))}`:`***${user.telefono.slice(-4)}`):'el contacto registrado';
  res.status(202).json({recoveryId:id,destination,expiresInSeconds:600});
});
app.post('/api/auth/recovery/confirm', recoveryLimiter, async (req,res)=>{
  const item=recoveryCodes.get(String(req.body.recoveryId||''));
  if(!item||Date.now()>item.expiresAt)return res.status(410).json({message:'El código expiró.'});
  if(String(req.body.newPassword||'').length<8)return res.status(422).json({message:'La contraseña debe tener al menos 8 caracteres.'});
  if(++item.attempts>5){recoveryCodes.delete(req.body.recoveryId);return res.status(429).json({message:'Demasiados intentos.'});}
  if(!(item.userId&&/^\d{6}$/.test(req.body.code)&&safeEqual(codeHash(req.body.code),item.codeHash)))return res.status(401).json({message:'Código inválido.'});
  db.prepare('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(await bcrypt.hash(req.body.newPassword,12),item.userId);
  recoveryCodes.delete(req.body.recoveryId);res.json({message:'Contraseña actualizada correctamente.'});
});

setInterval(()=>{for(const[id,value]of recoveryCodes)if(Date.now()>value.expiresAt)recoveryCodes.delete(id);},60000).unref();
const distDir=path.join(__dirname,'dist');
app.use(express.static(distDir));
app.get('/',(_req,res)=>res.sendFile(path.join(distDir,'index.html')));
app.use((_err,_req,res,_next)=>res.status(500).json({message:'Error interno.'}));
app.listen(port,()=>process.stdout.write(`BRIANA activo en http://localhost:${port}\n`));