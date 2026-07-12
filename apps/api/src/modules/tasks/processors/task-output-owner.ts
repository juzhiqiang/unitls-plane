import { db, user as userTable, type User } from '@utils-plane/db';
import { eq } from 'drizzle-orm';

export type TaskOutputOwner = Pick<User, 'id' | 'plan' | 'role'>;

export async function getTaskOutputOwner(
  userId?: string | null
): Promise<TaskOutputOwner | null> {
  if (!userId) return null;

  const [owner] = await db
    .select({ id: userTable.id, plan: userTable.plan, role: userTable.role })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  if (!owner) {
    throw new Error(`Task output owner ${userId} was not found`);
  }

  return owner;
}
