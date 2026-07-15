import postgres from 'postgres';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://utils:utils@localhost:5433/utils_plane';
async function main(): Promise<void> {
  const client = postgres(databaseUrl, { max: 1, connect_timeout: 5 });

  try {
    await client`
    create temporary table active_user_verification (
      id text primary key,
      deletion_started_at timestamp
    )
  `;
    await client`
    create temporary table active_user_verification_audit (
      request_id integer primary key
    )
  `;
    await client`
    insert into active_user_verification (id, deletion_started_at)
    values ('user-1', null)
  `;

    await Promise.all(
      Array.from({ length: 20 }, (_, requestId) =>
        client.begin(async tx => {
          const [activeUser] = await tx<
            { id: string; deletion_started_at: Date | null }[]
          >`
          select id, deletion_started_at
          from active_user_verification
          where id = 'user-1'
          for update
        `;
          if (!activeUser || activeUser.deletion_started_at) {
            throw new Error('Active user was not available');
          }
          await tx`
          insert into active_user_verification_audit (request_id)
          values (${requestId})
        `;
        })
      )
    );

    const [result] = await client<{ count: number }[]>`
    select count(*)::int as count
    from active_user_verification_audit
  `;
    const count = result?.count ?? 0;
    if (count !== 20) {
      throw new Error(`Expected 20 committed transactions, received ${count}`);
    }

    console.log('20 concurrent active-user transactions completed with max=1');
  } finally {
    await client.end();
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
