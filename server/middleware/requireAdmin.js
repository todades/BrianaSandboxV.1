import jwt from 'jsonwebtoken';

/**
 * Middleware de SEGURIDAD para el Panel de Administración.
 *
 * Responsabilidades:
 *  1. Valida el token JWT del encabezado `Authorization: Bearer <token>`.
 *  2. Verifica la firma y el emisor/audiencia del token.
 *  3. Verifica de forma ESTRICTA que el rol sea 'administrador'.
 *
 * Uso en server.js:
 *   app.use('/api/admin', adminRouter);
 *   (dentro de admin.routes.js, `router.use(requireAdmin)` protege
 *    todas las rutas menos el /login de administrador).
 */
export function requireAdmin(req, res, next) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  if (!token) {
    return res.status(401).json({ message: 'Token de sesión no proporcionado.' });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: 'briana-api',
      audience: 'briana-panel',
    });

    // Verificación ESTRICTA de rol: solo el administrador entra.
    if (payload.role !== 'administrador') {
      return res.status(403).json({ message: 'Acceso restringido: solo administradores.' });
    }

    req.user = { id: Number(payload.sub), rol: payload.role };
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Sesión inválida o expirada.' });
  }
}

export default requireAdmin;
