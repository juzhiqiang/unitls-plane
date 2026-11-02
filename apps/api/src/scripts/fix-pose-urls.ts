import * as fs from 'fs/promises';

async function fixUrls() {
  const listPath = 'pose-images-github-multiview.json';
  const data = JSON.parse(await fs.readFile(listPath, 'utf-8'));
  
  const fixed = data.map((item: any) => ({
    ...item,
    original: item.original.replace('/public/img/', '/img/'),
    thumbnail: item.thumbnail.replace('/public/thumbs/', '/thumbs/'),
  }));
  
  console.log(`Fixed ${fixed.length} URLs`);
  console.log('Sample before:', data[0].original);
  console.log('Sample after:', fixed[0].original);
  
  await fs.writeFile('pose-images-github-multiview-fixed.json', JSON.stringify(fixed, null, 2));
  console.log('Saved to pose-images-github-multiview-fixed.json');
}

fixUrls()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
