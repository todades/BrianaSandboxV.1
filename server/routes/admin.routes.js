import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../lib/db.js';
import { requireAdmin } from '../middleware/requireAdmin.js';

const router = Router();

// ============================================================
// 1. LOGIN DE ADMINISTRADOR (público, SOLO acepta rol administrador)
//    Es el "acceso especial/protegido" para el admin único.
//    Los estudiantes/tutores NO pueden entrar por aquí.
// ============================================================
router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const user = await db
      .prepare('SELECT * FROM users WHERE email = ? AND is_active = TRUE')
      .get(email);

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: 'Credenciales incorrectas.' });
    }

    // Solo el administrador puede iniciar sesión por este acceso.
    if (user.rol !== 'administrador') {
      return res.status(403).json({
        message: 'Este acceso es exclusivo para el administrador. Usa el inicio de sesión público.',
      });
    }

    const token = jwt.sign({ sub: String(user.id), role: user.rol }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
      issuer: 'briana-api',
      audience: 'briana-panel',
    });

    res.json({
      token,
      user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
    });
  } catch (err) {
    console.error('Error en admin login:', err);
    res.status(500).json({ message: 'Error interno al iniciar sesión de administrador.' });
  }
});

// ============================================================
// A PARTIR DE AQUÍ, TODAS LAS RUTAS REQUIEREN ROL ADMINISTRADOR
// ============================================================
router.use(requireAdmin);

// ============================================================
// MÉTRICAS / DASHBOARD
// ============================================================
router.get('/dashboard', async (req, res) => {
  try {
    const totalProyectos = (await db.prepare('SELECT COUNT(*) c FROM projects').get()).c;
    const porEstado = (await db.prepare('SELECT estado, COUNT(*) c FROM projects GROUP BY estado').all());
    const mapa = {};
    porEstado.forEach((r) => (mapa[r.estado] = r.c));

    const tutoresActivos = (
      await db.prepare("SELECT COUNT(*) c FROM users WHERE rol = 'tutor' AND is_active = TRUE").get()
    ).c;
    const estudiantesActivos = (
      await db.prepare("SELECT COUNT(*) c FROM users WHERE rol = 'estudiante' AND is_active = TRUE").get()
    ).c;

    res.json({
      totalProyectos,
      porEstado: {
        publicado: mapa['publicado'] || 0,
        en_validacion: mapa['en_validacion'] || 0,
        rechazado: mapa['rechazado'] || 0,
        en_correccion: mapa['en_correccion'] || 0,
        pendiente: mapa['pendiente'] || 0,
      },
      tutoresActivos,
      estudiantesActivos,
    });
  } catch (err) {
    console.error('Error en dashboard:', err);
    res.status(500).json({ message: 'Error al cargar las métricas.' });
  }
});

// ============================================================
// GESTIÓN DE PROYECTOS
// ============================================================
const ESTADOS_VALIDOS = ['pendiente', 'en_correccion', 'en_validacion', 'publicado', 'rechazado'];

// Listar proyectos (con nombres de estudiante y tutor)
router.get('/projects', async (req, res) => {
  try {
    const projects = await db.prepare(`
      SELECT p.*,
             s.nombre AS estudiante_nombre,
             t.nombre AS tutor_nombre_asignado
      FROM projects p
      LEFT JOIN users s ON s.id = p.student_id
      LEFT JOIN users t ON t.id = p.tutor_id
      ORDER BY p.created_at DESC
    `).all();
    res.json({ projects });
  } catch (err) {
    console.error('Error listando proyectos:', err);
    res.status(500).json({ message: 'Error al listar proyectos.' });
  }
});

// Listar tutores disponibles (para asignar/reasignar)
router.get('/tutors', async (req, res) => {
  try {
    const tutores = await db
      .prepare("SELECT id, nombre, email FROM users WHERE rol = 'tutor' ORDER BY nombre")
      .all();
    res.json({ tutores });
  } catch (err) {
    console.error('Error listando tutores:', err);
    res.status(500).json({ message: 'Error al listar tutores.' });
  }
});

// Cambiar estado de un proyecto
router.patch('/projects/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const nuevoEstado = String(req.body.estado || '');
    const motivo = String(req.body.motivo || '').trim();

    if (!ESTADOS_VALIDOS.includes(nuevoEstado)) {
      return res.status(422).json({ message: 'Estado no válido.' });
    }
    if (nuevoEstado === 'rechazado' && motivo.length < 5) {
      return res.status(422).json({ message: 'El rechazo requiere un motivo (mín. 5 caracteres).' });
    }

    const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ message: 'Proyecto no encontrado.' });

    await db.prepare(`
      UPDATE projects SET
        estado = ?,
        published_at = CASE WHEN ? = 'publicado' THEN CURRENT_TIMESTAMP ELSE published_at END,
        rejected_at  = CASE WHEN ? = 'rechazado' THEN CURRENT_TIMESTAMP ELSE rejected_at END,
        rejection_reason = CASE WHEN ? = 'rechazado' THEN ? ELSE rejection_reason END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nuevoEstado, nuevoEstado, nuevoEstado, nuevoEstado, motivo || null, id);

    await db.prepare(`
      INSERT INTO project_audits (project_id, actor_id, accion, estado_anterior, estado_nuevo, descripcion)
      VALUES (?, ?, 'admin.estado_cambiado', ?, ?, ?)
    `).run(id, req.user.id, project.estado, nuevoEstado, motivo || 'Cambio manual de estado por administrador.');

    const updated = await db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    res.json({ project: updated });
  } catch (err) {
    console.error('Error cambiando estado:', err);
    res.status(500).json({ message: 'Error al cambiar el estado del proyecto.' });
  }
});

// Asignar / reasignar tutor
router.patch('/projects/:id/tutor', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const tutorId = req.body.tutorId === null || req.body.tutorId === '' || req.body.tutorId === undefined
      ? null
      : Number(req.body.tutorId);

    const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ message: 'Proyecto no encontrado.' });

    let tutorNombre = null;
    if (tutorId) {
      const tutor = await db.prepare("SELECT nombre FROM users WHERE id = ? AND rol = 'tutor'").get(tutorId);
      if (!tutor) return res.status(422).json({ message: 'Tutor no válido.' });
      tutorNombre = tutor.nombre;
    }

    await db.prepare('UPDATE projects SET tutor_id = ?, tutor_nombre = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(tutorId, tutorNombre, id);

    await db.prepare(`
      INSERT INTO project_audits (project_id, actor_id, accion, descripcion)
      VALUES (?, ?, 'admin.tutor_asignado', ?)
    `).run(id, req.user.id, tutorId ? `Tutor reasignado a: ${tutorNombre}` : 'Tutor removido del proyecto.');

    const updated = await db.prepare(`
      SELECT p.*, t.nombre AS tutor_nombre_asignado
      FROM projects p LEFT JOIN users t ON t.id = p.tutor_id
      WHERE p.id = ?
    `).get(id);
    res.json({ project: updated });
  } catch (err) {
    console.error('Error asignando tutor:', err);
    res.status(500).json({ message: 'Error al asignar el tutor.' });
  }
});

// Eliminar proyecto (con confirmación en el frontend)
router.delete('/projects/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const project = await db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!project) return res.status(404).json({ message: 'Proyecto no encontrado.' });

    // DELETE CASCADE elimina project_documents y tutor_notes automáticamente.
    await db.prepare('DELETE FROM projects WHERE id = ?').run(id);

    await db.prepare(`
      INSERT INTO project_audits (project_id, actor_id, accion, descripcion)
      VALUES (NULL, ?, 'admin.proyecto_eliminado', ?)
    `).run(req.user.id, `Proyecto eliminado: ${project.titulo}`);

    res.json({ message: 'Proyecto eliminado correctamente.' });
  } catch (err) {
    console.error('Error eliminando proyecto:', err);
    res.status(500).json({ message: 'Error al eliminar el proyecto.' });
  }
});

// ============================================================
// GESTIÓN DE USUARIOS (estudiantes y tutores)
// ============================================================

// Listar usuarios (solo estudiante/tutor, nunca el admin)
router.get('/users', async (req, res) => {
  try {
    const rol = req.query.rol; // opcional: 'estudiante' | 'tutor'
    let users;
    if (rol && ['estudiante', 'tutor'].includes(rol)) {
      users = await db.prepare(
        'SELECT id, nombre, email, telefono, cedula, rol, is_active, created_at FROM users WHERE rol = ? ORDER BY nombre'
      ).all(rol);
    } else {
      users = await db.prepare(
        "SELECT id, nombre, email, telefono, cedula, rol, is_active, created_at FROM users WHERE rol IN ('estudiante','tutor') ORDER BY nombre"
      ).all();
    }
    res.json({ users });
  } catch (err) {
    console.error('Error listando usuarios:', err);
    res.status(500).json({ message: 'Error al listar usuarios.' });
  }
});

// Alternar is_active (activar / desactivar)
router.patch('/users/:id/toggle-active', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado.' });
    if (user.rol === 'administrador') {
      return res.status(422).json({ message: 'No se puede desactivar al administrador.' });
    }

    const nuevoEstado = !user.is_active;
    await db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(nuevoEstado, id);

    await db.prepare(`
      INSERT INTO project_audits (project_id, actor_id, accion, descripcion)
      VALUES (NULL, ?, 'admin.usuario_toggle', ?)
    `).run(req.user.id, `${nuevoEstado ? 'Activado' : 'Desactivado'} usuario: ${user.nombre}`);

    const updated = await db.prepare('SELECT id, nombre, rol, is_active FROM users WHERE id = ?').get(id);
    res.json({ user: updated });
  } catch (err) {
    console.error('Error toggle activo:', err);
    res.status(500).json({ message: 'Error al activar/desactivar el usuario.' });
  }
});

// Cambiar rol (SOLO entre estudiante y tutor; NUNCA administrador)
router.patch('/users/:id/role', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const nuevoRol = String(req.body.rol || '');
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado.' });

    // NUNCA crear/eliminar administradores desde la UI.
    if (nuevoRol === 'administrador' || user.rol === 'administrador') {
      return res.status(403).json({ message: 'No se puede modificar el rol administrador.' });
    }
    // Solo se permite alternar entre estudiante y tutor.
    if (!['estudiante', 'tutor'].includes(nuevoRol)) {
      return res.status(422).json({ message: 'Rol no permitido. Solo estudiante o tutor.' });
    }

    await db.prepare('UPDATE users SET rol = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(nuevoRol, id);

    await db.prepare(`
      INSERT INTO project_audits (project_id, actor_id, accion, descripcion)
      VALUES (NULL, ?, 'admin.rol_cambiado', ?)
    `).run(req.user.id, `Rol de ${user.nombre} cambiado de ${user.rol} a ${nuevoRol}.`);

    const updated = await db.prepare('SELECT id, nombre, rol, is_active FROM users WHERE id = ?').get(id);
    res.json({ user: updated });
  } catch (err) {
    console.error('Error cambiando rol:', err);
    res.status(500).json({ message: 'Error al cambiar el rol del usuario.' });
  }
});

export default router;
