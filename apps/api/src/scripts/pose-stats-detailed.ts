import { db } from '@utils-plane/db';
import { sql } from 'drizzle-orm';

async function detailedStats() {
  const byView = await db.execute(sql`
    SELECT 
      substring(slug from '_(front|side|back|high|low|diag)$') as view,
      visibility,
      COUNT(*) as count
    FROM ai_try_on_references
    WHERE kind='pose'
    GROUP BY view, visibility
    ORDER BY visibility, view
  `);
  
  console.log('By view & visibility:');
  console.table(byView.rows);
  
  const publicPoses = await db.execute(sql`
    SELECT slug, visibility, array_to_string(tags, ', ') as tags
    FROM ai_try_on_references
    WHERE kind='pose' AND visibility='public'
    ORDER BY sort_order
    LIMIT 10
  `);
  
  console.log('\n=== Sample Public Poses ===');
  publicPoses.rows.forEach((r: any) => {
    console.log(`${r.slug} | ${r.tags}`);
  });
}

detailedStats()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
