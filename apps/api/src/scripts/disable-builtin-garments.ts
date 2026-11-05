// 必须是第一个 import:加载仓库根目录 .env.local(详见 env-loader 注释)。
import '../env-loader';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and, inArray } from 'drizzle-orm';
import { aiTryOnReferences } from '@utils-plane/db';

const client = postgres(process.env.DATABASE_URL, { max: 1 });
const db = drizzle(client);

// 禁用4张原创平面图服饰
const builtinSlugs = [
  'garment-tshirt-flat',
  'garment-dress-flat',
  'garment-trousers-flat',
  'garment-jacket-flat',
];

async function main() {
  try {
    console.log('Disabling builtin flat garments...');
    await db
      .update(aiTryOnReferences)
      .set({ isEnabled: false })
      .where(
        and(
          eq(aiTryOnReferences.kind, 'garment'),
          inArray(aiTryOnReferences.slug, builtinSlugs)
        )
      );

    console.log('Done! Builtin flat garments disabled.');
    console.log(
      'Now only real costume garments will be shown in the try-on page.'
    );
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
