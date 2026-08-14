import type { EntitlementUser } from '@utils-plane/utils';

export type EntitlementSession =
  | {
      user?: {
        id?: string | null;
        plan?: string | null;
        role?: string | null;
      };
    }
  | null
  | undefined;

export function getEntitlementUserFromSession(
  session: EntitlementSession
): EntitlementUser | null {
  const user = session?.user;
  if (!user?.id) return null;

  return {
    userId: user.id,
    plan: user.plan,
    role: user.role,
  };
}
