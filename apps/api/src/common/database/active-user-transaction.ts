import { ConflictException, NotFoundException } from '@nestjs/common';
import { db, user } from '@utils-plane/db';
import { eq, sql } from 'drizzle-orm';

export const PRODUCER_LOCK_TIMEOUT_MS = 30 * 1000;
export const PRODUCER_STATEMENT_TIMEOUT_MS = 2 * 60 * 1000;
export const PRODUCER_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

export type ActiveUserTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

async function configureProducerTransaction(
  tx: ActiveUserTransaction
): Promise<void> {
  await tx.execute(
    sql.raw(`SET LOCAL lock_timeout = '${PRODUCER_LOCK_TIMEOUT_MS}ms'`)
  );
  await tx.execute(
    sql.raw(
      `SET LOCAL statement_timeout = '${PRODUCER_STATEMENT_TIMEOUT_MS}ms'`
    )
  );
  await tx.execute(
    sql.raw(
      `SET LOCAL idle_in_transaction_session_timeout = '${PRODUCER_IDLE_TIMEOUT_MS}ms'`
    )
  );
}

export async function withProducerTransaction<T>(
  operation: (tx: ActiveUserTransaction) => Promise<T>
): Promise<T> {
  return db.transaction(async tx => {
    await configureProducerTransaction(tx);
    return operation(tx);
  });
}

export async function withActiveUserTransaction<T>(
  userId: string,
  operation: (tx: ActiveUserTransaction) => Promise<T>
): Promise<T> {
  return withProducerTransaction(async tx => {
    const [existingUser] = await tx
      .select({ id: user.id, deletionStartedAt: user.deletionStartedAt })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
      .for('update');

    if (!existingUser) {
      throw new NotFoundException('Account not found');
    }
    if (existingUser.deletionStartedAt) {
      throw new ConflictException('Account deletion is in progress');
    }

    return operation(tx);
  });
}
