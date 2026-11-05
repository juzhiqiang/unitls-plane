import { db } from '@utils-plane/db';
import { sql } from 'drizzle-orm';

async function checkMigration() {
  console.log('检查Migration状态...\n');

  try {
    const result = await db.execute(
      sql`SELECT COUNT(*) as count FROM ai_try_on_references WHERE kind = 'pose'`
    );
    console.log('✓ 当前pose记录数:', result[0].count);

    const visCheck = await db.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_try_on_references' AND column_name = 'visibility'`
    );
    console.log('✓ visibility列是否存在:', visCheck.length > 0);

    if (visCheck.length > 0) {
      const byVis = await db.execute(
        sql`SELECT visibility, COUNT(*) as count FROM ai_try_on_references WHERE kind = 'pose' GROUP BY visibility ORDER BY visibility`
      );
      console.log('\n按visibility分组:');
      byVis.forEach(row => console.log(`  ${row.visibility}: ${row.count}`));
    } else {
      console.log('\n⚠ visibility列不存在,需要运行Migration');
    }
  } catch (error) {
    console.error('\n❌ 查询失败:', error.message);
  }
  process.exit(0);
}

checkMigration();
