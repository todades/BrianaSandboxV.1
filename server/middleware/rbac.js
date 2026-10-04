import jwt from 'jsonwebtoken';

/**
 * RBAC centralizado. Cada uso valida el JWT, recarga el usuario desde la BD
 * y verifica que el rol actual se encuentre en la lista permitida.
 */
export function createRoleVerifier({ db, jwtSecret }) {
  if (!db) throw new Error('createRoleVerifier requiere una instancia de base de datos.');
  if (!jwtSecret) throw new Error('createRoleVerifier requiere JWT_SECRET.');

  return function verifyRole(...allowedRoles) {
    const allowed = new Set(allowedRoles.flat().filter(Boolean));

    return function roleGuard(request, response, next) {
      const authorization = String(request.headers.authorization || '');
      const token = authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length).trim()
        : '';

      if (!token) {
        response.status(401).json({ message: 'Debes iniciar sesión.' });
        return;
      }

      try {
        const payload = jwt.verify(token, jwtSecret, {
          issuer: 'briana-api',
          audience: 'briana-panel',
        });

        const user = db.prepare(`
          SELECT id, nombre, email, telefono, password_hash, rol, activo
          FROM users
          WHERE id = ? AND activo = 1
        `).get(Number(payload.sub));

        if (!user) {
          response.status(401).json({ message: 'La cuenta no está disponible.' });
          return;
        }

        if (payload.role !== user.rol) {
          response.status(401).json({ message: 'La sesión quedó obsoleta. Inicia sesión nuevamente.' });
          return;
        }

        if (allowed.size && !allowed.has(user.rol)) {
          response.status(403).json({ message: 'Tu rol no tiene permiso para esta acción.' });
          return;
        }

        request.user = user;
        request.auth = payload;
        next();
      } catch (error) {
        const expired = error?.name === 'TokenExpiredError';
        response.status(401).json({
          message: expired ? 'La sesión expiró.' : 'El token de acceso no es válido.',
        });
      }
    };
  };
}