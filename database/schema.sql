PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  cedula TEXT NOT NULL UNIQUE
    CHECK (length(cedula) = 8 AND cedula NOT GLOB '*[^0-9]*'),
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  telefono TEXT NOT NULL
    CHECK (length(telefono) = 11 AND telefono NOT GLOB '*[^0-9]*'),
  trayecto TEXT CHECK (trayecto IS NULL OR trayecto IN ('I', 'II', 'III', 'IV')),
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'estudiante'
    CHECK (rol IN ('estudiante', 'tutor', 'administrador')),
 activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (rol <> 'estudiante' OR trayecto IS NOT NULL)
);

CREATE UNIQUE INDEX idx_users_cedula ON users(cedula);
CREATE INDEX idx_users_role ON users(rol);

CREATE TABLE projects (
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
  trayecto TEXT CHECK (trayecto IS NULL OR trayecto IN ('I', 'II', 'III', 'IV')),
  enviado_por_tutor TEXT,
  enviado_en TEXT,
  resumen TEXT,
  resource_path TEXT,
  planilla_path TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN (
      'pendiente',
      'en_correccion',
      'en_validacion',
      'publicado',
      'rechazado'
    )),
  tutor_approved_at TEXT,
  published_at TEXT,
  rejected_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (estudiante_id) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE project_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('recurso', 'planilla')),
  version INTEGER NOT NULL DEFAULT 1,
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_by INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE (project_id, tipo, version)
);

CREATE TABLE tutor_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  tutor_id INTEGER NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'metodologica'
    CHECK (tipo IN ('metodologica', 'tecnica', 'general')),
  comentario TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (tutor_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE project_audits (
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

CREATE INDEX idx_users_role ON users(rol);
CREATE INDEX idx_projects_student ON projects(estudiante_id);
CREATE INDEX idx_projects_tutor ON projects(tutor_id);
CREATE INDEX idx_projects_status ON projects(estado);
CREATE INDEX idx_documents_current ON project_documents(project_id, tipo, is_current);
CREATE INDEX idx_notes_project ON tutor_notes(project_id);
CREATE INDEX idx_audits_project ON project_audits(project_id, created_at);