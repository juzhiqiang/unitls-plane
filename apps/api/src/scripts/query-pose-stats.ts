import { db, aiTryOnReferences } from '@utils-plane/db';
import { sql, eq } from 'drizzle-orm';

async function queryPoseStats() {
  console.log('[QueryPoseStats] Querying database...');

  const all = await db
    .select()
    .from(aiTryOnReferences)
    .where(eq(aiTryOnReferences.kind, 'pose'));
  console.log(`Total pose records: ${all.length}`);

  const byVisibility = await db.execute(
    sql`SELECT visibility, COUNT(*) as count FROM ai_try_on_references WHERE kind='pose' GROUP BY visibility ORDER BY visibility`
  );
  console.log('By visibility:', byVisibility.rows);

  const viewPattern = /_(front|side|back|high|low|diag)$/i;
  const byView = new Map<string, number>();
  let noViewSuffix = 0;

  all.forEach(r => {
    const match = r.slug.match(viewPattern);
    if (match) {
      const view = match[1].toLowerCase();
      byView.set(view, (byView.get(view) || 0) + 1);
    } else {
      noViewSuffix++;
    }
  });

  console.log('By view suffix:');
  Array.from(byView.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([view, count]) => {
      console.log(`  ${view}: ${count}`);
    });
  console.log(`  no_suffix: ${noViewSuffix}`);

  const sampleRecords = all.slice(0, 5);
  console.log('\nSample records:');
  sampleRecords.forEach(r => {
    console.log(
      `  slug: ${r.slug} visibility: ${r.visibility} tags: ${r.tags.join(', ')}`
    );
  });
}

queryPoseStats()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[QueryPoseStats] Error:', err);
    process.exit(1);
  });
