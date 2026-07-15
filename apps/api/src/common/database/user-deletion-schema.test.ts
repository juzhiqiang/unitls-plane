import { describe, expect, it } from 'bun:test';
import { user } from '@utils-plane/db';

describe('user schema', () => {
  it('persists the account deletion start time as a nullable timestamp', () => {
    expect('deletionStartedAt' in user).toBe(true);
    expect(user.deletionStartedAt).toMatchObject({
      name: 'deletion_started_at',
      notNull: false,
    });
  });
});
