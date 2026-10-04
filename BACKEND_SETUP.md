# Backend de recuperación de BRIANA

## 1. Base de datos y variables de entorno

El backend crea automáticamente `data/briana.sqlite` y la tabla `users`:

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  telefono TEXT,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'usuario',
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  updated_at TEXT
);
```

1. Copia `.env.example` como `.env`.
2. Configura `ADMIN_EMAIL` con el correo del administrador inicial.
3. Configura `ADMIN_WHATSAPP` en formato internacional, solo con números.
4. Cambia `RECOVERY_CODE_PEPPER` por una cadena larga y aleatoria.
5. Configura `JWT_SECRET` con un secreto largo y aleatorio.
6. Mueve la clave de Gemini a `GEMINI_API_KEY`.

Durante el primer arranque se crea la cuenta administrativa inicial usando `ADMIN_EMAIL` y `ADMIN_LOGIN_PASSWORD`. Durante las pruebas, el registro permite seleccionar estudiante, tutor o administrador sin código institucional. La cédula exige 8 dígitos, el teléfono 11 dígitos y el trayecto es obligatorio para estudiantes.

## 2. Configurar Gmail

1. Activa la verificación en dos pasos en la cuenta de Google.
2. Abre la configuración de contraseñas de aplicaciones de Google.
3. Crea una contraseña para BRIANA.
4. Coloca el correo en `EMAIL_USER`.
5. Coloca la contraseña de aplicación de 16 caracteres en `EMAIL_PASS`; no uses la contraseña normal de Gmail.

## 3. Configurar WhatsApp Cloud API

1. Crea una aplicación en Meta for Developers y agrega WhatsApp.
2. Obtén el `Phone Number ID` y un token permanente de un System User.
3. Crea y aprueba una plantilla llamada `briana_recovery_code` con una variable en el cuerpo, por ejemplo: `Tu código de recuperación de BRIANA es {{1}}`.
4. Configura `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_NAME` y `WHATSAPP_TEMPLATE_LANGUAGE`.

La plantilla es necesaria cuando no existe una conversación abierta de 24 horas con el administrador.

## 4. Iniciar el sistema

```bash
npm run build
node server.js
```

La aplicación completa estará disponible en `http://localhost:3000`.

## 5. Frontend y backend en dominios distintos

Si el HTML permanece en Netlify y `server.js` se publica en Render o Railway, configura al principio de `index.html`:

```html
<script>
  window.BRIANA_API_URL = 'https://tu-backend.onrender.com/api';
</script>
```

Además, agrega el dominio de Netlify a `FRONTEND_ORIGINS`.

## Endpoints

- `POST /api/register` y `POST /api/auth/register`
- `POST /api/login` y `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/admin-action/verify`
- `POST /api/auth/admin-action/change`
- `POST /api/auth/recovery/request`
- `POST /api/auth/recovery/confirm`
- `POST /api/ai/analyze`

El login devuelve un JWT con ocho horas de duración. Los endpoints de IA requieren usuario autenticado, mientras que las operaciones administrativas también exigen rol `administrador`.

Los códigos de recuperación:

- Tienen seis dígitos.
- Expiran en diez minutos.
- Admiten máximo cinco intentos.
- Se almacenan temporalmente como hash, nunca como texto plano.
- Se eliminan al utilizarse.

En una implantación con varias instancias del backend, sustituye el `Map` en memoria por Redis.