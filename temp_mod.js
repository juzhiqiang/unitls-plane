const fs = require('fs');

const filePath = 'apps/web/src/app/[locale]/(app)/image/try-on/page.tsx';
let content = fs.readFileSync(filePath, 'utf-8');

// 1. 导入
content = content.replace(
  "import { ResultPanel } from '@/components/tools/result-panel';",
  "import { ResultPanel } from '@/components/tools/result-panel';\nimport { ImageViewerModal } from '@/components/tools/image-viewer-modal';"
);

// 2. 状态
const stateRe = /(\[activeTask, setActiveTask\] = useState<ActiveTryOnTaskState \| null>\(\s*null\s*\);)/;
content = content.replace(stateRe, $1

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSrc, setViewerSrc] = useState(''););

// 3. img
const imgRe = /(<img\s+src=\{buildFileDownloadUrl\(effectiveTask\.outputFileId\)\}\s+alt=\{t\('resultPreviewAlt'\)\}\s+className=")([^"]+)("\s*\/>)/;
content = content.replace(imgRe, (m, p1, p2, p3) => {
  return ${p1} cursor-pointer hover:opacity-90"
                onClick={() => {
                  setViewerSrc(buildFileDownloadUrl(effectiveTask.outputFileId!));
                  setViewerOpen(true);
                }};
});

// 4. modal
content = content.replace('</ToolPageShell>', 
      {/* 图片查看器 */}
      <ImageViewerModal
        src={viewerSrc}
        alt={t('resultPreviewAlt')}
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />
    </ToolPageShell>);

fs.writeFileSync(filePath, content);
console.log('Done');
