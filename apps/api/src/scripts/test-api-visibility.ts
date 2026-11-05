import { db, aiTryOnReferences } from '@utils-plane/db';
import { eq } from 'drizzle-orm';

async function testAPIFilter() {
  console.log('[TestAPIFilter] Testing service-level filtering...');

  const allPoses = await db
    .select()
    .from(aiTryOnReferences)
    .where(eq(aiTryOnReferences.kind, 'pose'));
  console.log(`Total poses in DB: ${allPoses.length}`);

  const publicPoses = allPoses.filter(p => p.visibility === 'public');
  console.log(`Public poses: ${publicPoses.length}`);

  const hiddenPoses = allPoses.filter(p => p.visibility === 'hidden');
  console.log(`Hidden poses: ${hiddenPoses.length}`);

  const adultPoses = allPoses.filter(p => p.visibility === 'adult');
  console.log(`Adult poses: ${adultPoses.length}`);

  const intimatePoses = allPoses.filter(p => p.visibility === 'intimate');
  console.log(`Intimate poses: ${intimatePoses.length}`);

  console.log('\n=== Multiview Check ===');
  const viewCounts = publicPoses.reduce(
    (acc, p) => {
      const match = p.slug.match(/_(front|side|back|high|low|diag)$/);
      const view = match ? match[1] : 'no_suffix';
      acc[view] = (acc[view] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  console.log('Public poses by view:');
  console.table(viewCounts);

  console.log('\n=== Sample Non-Public Records (should NOT appear in API) ===');
  const samples = [
    ...adultPoses.slice(0, 2),
    ...intimatePoses.slice(0, 2),
    ...hiddenPoses.slice(0, 2),
  ];
  samples.forEach(p => {
    console.log(`  ${p.slug} | visibility=${p.visibility}`);
  });
}

testAPIFilter()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
