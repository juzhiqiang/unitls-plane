import { db } from '@utils-plane/db';
import { sql } from 'drizzle-orm';

async function runMigration() {
  console.log('手动执行Migration...\n');
  
  try {
    // 检查enum是否存在
    const enumCheck = await db.execute(sql`SELECT 1 FROM pg_type WHERE typname = 'ai_try_on_reference_visibility'`);
    
    if (enumCheck.length === 0) {
      await db.execute(sql`CREATE TYPE "public"."ai_try_on_reference_visibility" AS ENUM('public', 'hidden', 'adult', 'intimate')`);
      console.log('✓ 创建visibility enum类型');
    } else {
      console.log('✓ visibility enum类型已存在');
    }
    
    // 检查列是否存在
    const colCheck = await db.execute(sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_try_on_references' AND column_name = 'visibility'`);
    
    if (colCheck.length === 0) {
      await db.execute(sql`ALTER TABLE "ai_try_on_references" ADD COLUMN "visibility" "ai_try_on_reference_visibility" DEFAULT 'public' NOT NULL`);
      console.log('✓ 添加visibility列');
    } else {
      console.log('✓ visibility列已存在');
    }
    
    // 验证
    const result = await db.execute(sql`SELECT COUNT(*) as count FROM ai_try_on_references WHERE visibility = 'public'`);
    console.log('\n✅ Migration成功! 当前public记录数:', result[0].count);
    
  } catch (error) {
    console.error('\n❌ Migration失败:', error.message);
  }
  process.exit(0);
}

runMigration();
