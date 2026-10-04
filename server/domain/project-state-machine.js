export const ROLES = Object.freeze({
  STUDENT: 'estudiante',
  TUTOR: 'tutor',
  ADMIN: 'administrador',
});

export const PROJECT_STATES = Object.freeze({
  PENDING: 'pendiente',
  CORRECTION: 'en_correccion',
  TUTOR_APPROVED: 'en_validacion',
  PUBLISHED: 'publicado',
  REJECTED: 'rechazado',
});

export const FINAL_STATES = new Set([
  PROJECT_STATES.PUBLISHED,
  PROJECT_STATES.REJECTED,
]);

export const STUDENT_EDITABLE_STATES = new Set([
  PROJECT_STATES.PENDING,
  PROJECT_STATES.CORRECTION,
]);

const transitions = new Map([
  [`${PROJECT_STATES.CORRECTION}:${PROJECT_STATES.CORRECTION}`, new Set([ROLES.TUTOR])],
  [`${PROJECT_STATES.PENDING}:${PROJECT_STATES.TUTOR_APPROVED}`, new Set([ROLES.TUTOR])],
  [`${PROJECT_STATES.CORRECTION}:${PROJECT_STATES.TUTOR_APPROVED}`, new Set([ROLES.TUTOR])],
  [`${PROJECT_STATES.TUTOR_APPROVED}:${PROJECT_STATES.PUBLISHED}`, new Set([ROLES.ADMIN])],
  // El administrador puede devolver el caso al ciclo si detecta ajustes pendientes.
  [`${PROJECT_STATES.TUTOR_APPROVED}:${PROJECT_STATES.CORRECTION}`, new Set([ROLES.ADMIN])],
  [`${PROJECT_STATES.PENDING}:${PROJECT_STATES.CORRECTION}`, new Set([ROLES.TUTOR, ROLES.ADMIN])],
  [`${PROJECT_STATES.PENDING}:${PROJECT_STATES.REJECTED}`, new Set([ROLES.ADMIN])],
  [`${PROJECT_STATES.CORRECTION}:${PROJECT_STATES.REJECTED}`, new Set([ROLES.ADMIN])],
  [`${PROJECT_STATES.TUTOR_APPROVED}:${PROJECT_STATES.REJECTED}`, new Set([ROLES.ADMIN])],
]);

export class StateTransitionError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'StateTransitionError';
    this.status = status;
  }
}

export function assertStudentCanEdit(project, userId) {
  if (Number(project.estudiante_id) !== Number(userId)) {
    throw new StateTransitionError('El proyecto no pertenece al estudiante autenticado.', 403);
  }
  if (!STUDENT_EDITABLE_STATES.has(project.estado)) {
    throw new StateTransitionError(
      `El estudiante no puede editar un proyecto en estado ${project.estado}.`,
      409,
    );
  }
}

export function assertTutorAssignment(project, tutorId) {
  if (Number(project.tutor_id) !== Number(tutorId)) {
    throw new StateTransitionError('El proyecto no está asignado al tutor autenticado.', 403);
  }
}

export function assertTransition({
  project,
  to,
  actorRole,
  requireDocuments = false,
}) {
  const from = project.estado;
  if (FINAL_STATES.has(from)) {
    throw new StateTransitionError(`El proyecto está cerrado en estado ${from}.`);
  }

  const roles = transitions.get(`${from}:${to}`);
  if (!roles || !roles.has(actorRole)) {
    throw new StateTransitionError(
      `Transición no permitida: ${from} → ${to} para el rol ${actorRole}.`,
    );
  }

  if (requireDocuments && (!project.resource_path || !project.planilla_path)) {
    throw new StateTransitionError(
      'El recurso académico y la planilla firmada son obligatorios para el visto bueno.',
      422,
    );
  }

  return true;
}

export function stateLabel(state) {
  return ({
    pendiente: 'Pendiente',
    en_correccion: 'En Corrección',
    en_validacion: 'Aprobado por Tutor / En Validación',
    publicado: 'Aprobado / Publicado',
    rechazado: 'Rechazado',
  })[state] || state;
}