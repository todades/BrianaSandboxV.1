# Backend multirol de BRIANA

## Roles

| Rol | Permisos principales |
|---|---|
| `estudiante` | Crear proyectos, editar sus metadatos en `pendiente`/`en_correccion`, cargar recurso y planilla, consultar seguimiento. |
| `tutor` | Ver únicamente proyectos asignados, registrar observaciones y otorgar visto bueno. |
| `administrador` | Gestionar roles, asignar tutores, consultar todos los proyectos y auditoría, editar metadatos, rechazar y publicar. |

El registro permite seleccionar `estudiante`, `tutor` o, temporalmente durante las pruebas, `administrador`, sin código institucional. Todos los perfiles deben registrar una cédula única de exactamente 8 dígitos y un teléfono de exactamente 11 dígitos. El trayecto (`I`, `II`, `III` o `IV`) es obligatorio únicamente para estudiantes.

## Máquina de estados

```text
pendiente
   ├── tutor solicita cambios ──> en_correccion
   │                                  └── estudiante corrige
   └── tutor da visto bueno (requiere recurso + planilla)
                                      └──> en_validacion
                                              └── administrador publica ──> publicado

pendiente / en_correccion / en_validacion
   └── administrador rechaza ──> rechazado
```

`publicado` y `rechazado` son estados finales. Los estudiantes solo pueden editar en `pendiente` o `en_correccion`.

## Rutas de autenticación

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/register` | Público; siempre crea estudiante |
| POST | `/api/login` | Público |
| GET | `/api/auth/me` | Autenticado |
| POST | `/api/auth/recovery/request` | Público con rate limit |
| POST | `/api/auth/recovery/confirm` | Público con código temporal |
| GET | `/api/admin/users` | Administrador |
| PATCH | `/api/admin/users/:id/role` | Administrador |

## Rutas de proyectos

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/api/projects` | Estudiante o administrador |
| GET | `/api/student/tutors` | Estudiante autenticado; muestra cuentas tutor activas para asignación |
| POST | `/api/student/projects` | Crea proyecto con `tutorId` obligatorio |
| POST | `/api/student/projects/:id/resubmit` | Reenvía al tutor un proyecto en `en_correccion` |
| GET | `/api/projects` | Bandeja filtrada según rol |
| GET | `/api/student/projects` | Estudiante |
| GET | `/api/tutor/projects` | Tutor |
| GET | `/api/admin/projects` | Administrador |
| GET | `/api/projects/:id` | Propietario, tutor asignado o administrador |
| PUT | `/api/projects/:id/metadata` | Estudiante en estado editable o administrador |
| PATCH | `/api/projects/:id/assign-tutor` | Administrador |

## Documentos

Los PDF se almacenan en `DATA_DIR/private/projects/{projectId}` y nunca se exponen como archivos públicos.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/projects/:id/documents/recurso` | FormData con campo `pdf` |
| POST | `/api/projects/:id/documents/planilla` | FormData con campo `pdf` |
| GET | `/api/projects/:id/documents/recurso` | Visualización privada |
| GET | `/api/projects/:id/documents/planilla` | Visualización privada |
| GET | `...?download=1` | Descarga privada |

Cada reemplazo crea una versión en `project_documents`; las versiones anteriores permanecen para trazabilidad.

## Acciones del tutor

| Método | Ruta | Efecto |
|---|---|---|
| POST | `/api/tutor/projects/:id/notes` | Crea observación y cambia a `en_correccion` |
| POST | `/api/tutor/projects/:id/approve` | Exige recurso + planilla y cambia a `en_validacion` |
| POST | `/api/tutor/projects/:id/send-to-admin` | Envía al administrador con recurso y planilla |

Ejemplo de observación:

```json
{
  "tipo": "metodologica",
  "comentario": "Ajustar los objetivos específicos y corregir las referencias."
}
```

## Acciones del administrador

| Método | Ruta | Efecto |
|---|---|---|
| POST | `/api/admin/projects/:id/publish` | Exige `en_validacion` y ambos documentos; cambia a `publicado` |
| POST | `/api/admin/projects/:id/reject` | Requiere motivo; cambia a `rechazado` |
| GET | `/api/admin/audit` | Historial completo en orden cronológico |

## Ejemplo de creación y carga

```js
const created = await fetch('/api/projects', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    titulo: 'Sistema web para biblioteca digital',
    autores: ['Autor Uno', 'Autor Dos'],
    pnf: 'Informática',
  }),
}).then(response => response.json());

const form = new FormData();
form.append('pdf', archivoPdf);
await fetch(`/api/projects/${created.project.id}/documents/recurso`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
```

## Variables mínimas

```env
JWT_SECRET=secreto-muy-largo
JWT_EXPIRES_IN=8h
RECOVERY_CODE_PEPPER=otro-secreto-largo
GEMINI_API_KEY=tu-clave

ADMIN_NAME=Administrador BRIANA
ADMIN_EMAIL=admin@institucion.edu
ADMIN_LOGIN_PASSWORD=contraseña-inicial
```

En producción, utiliza un disco persistente de Render/Railway para `DATA_DIR` o migra SQLite y los documentos a PostgreSQL + almacenamiento S3.