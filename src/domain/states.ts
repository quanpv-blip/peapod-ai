// Máy trạng thái của content_item. Nguồn: ba-team/docs/05-data-model-and-states.md mục 2.
// Giữ đồng bộ với CHECK trong db/migrations/001_init.sql (test kiểm tra điều này).

export const STATES = [
  'GENERATING',
  'MEDIA_PENDING',
  'IN_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'REJECTED',
  'CANCELLED',
  'FAILED_GENERATE',
  'FAILED_MEDIA',
  'FAILED_PUBLISH',
] as const;

export type State = (typeof STATES)[number];

const T: Record<State, readonly State[]> = {
  GENERATING: ['MEDIA_PENDING', 'IN_REVIEW', 'FAILED_GENERATE'],
  MEDIA_PENDING: ['IN_REVIEW', 'FAILED_MEDIA'],
  IN_REVIEW: ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'CANCELLED'],
  CHANGES_REQUESTED: ['GENERATING'],
  APPROVED: ['SCHEDULED', 'IN_REVIEW', 'CANCELLED', 'FAILED_PUBLISH'],
  SCHEDULED: ['PUBLISHING', 'PUBLISHED', 'IN_REVIEW', 'CANCELLED', 'FAILED_PUBLISH'],
  PUBLISHING: ['PUBLISHED', 'FAILED_PUBLISH'],
  PUBLISHED: [],
  REJECTED: [],
  CANCELLED: [],
  FAILED_GENERATE: ['GENERATING', 'CANCELLED'],
  FAILED_MEDIA: ['MEDIA_PENDING', 'CANCELLED'],
  FAILED_PUBLISH: ['SCHEDULED', 'PUBLISHING', 'CANCELLED'],
};

export const TERMINAL: readonly State[] = STATES.filter((s) => T[s].length === 0);

export function canTransition(from: State, to: State): boolean {
  return T[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: State,
    readonly to: State,
  ) {
    super(`Chuyển trạng thái không hợp lệ: ${from} -> ${to}`);
  }
}

export function assertTransition(from: State, to: State): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** Trạng thái mà ở đó nội dung đã được duyệt và có thể đã hẹn giờ ở Meta; sửa nội dung phải hủy bài hẹn giờ. */
export function editRequiresRemoteCancel(state: State): boolean {
  return state === 'SCHEDULED';
}
