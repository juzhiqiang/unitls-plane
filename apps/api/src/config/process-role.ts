export const PROCESS_ROLES = ['all', 'api', 'worker'] as const;

export type ProcessRole = (typeof PROCESS_ROLES)[number];

/**
 * 解析进程角色。未设置时保持旧的单进程行为，非法值必须在启动阶段失败，
 * 不能静默退回到 all。
 */
export function parseProcessRole(value: string | undefined): ProcessRole {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 'all';

  if ((PROCESS_ROLES as readonly string[]).includes(normalized)) {
    return normalized as ProcessRole;
  }

  throw new Error(
    `PROCESS_ROLE must be one of ${PROCESS_ROLES.join(', ')} (received "${value}")`
  );
}
