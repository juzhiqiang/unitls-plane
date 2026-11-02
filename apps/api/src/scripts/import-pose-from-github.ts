/**
 * 从 GitHub 文件树构造完整多视角姿势导入脚本
 * 
 * 根据 GitHub API 返回的文件树直接生成姿势记录，无需本地 pose-dicts.json
 * 
 * 命名规则（从 GitHub 树推断）：
 * - full_single_P001_front.png / full_single_P001_side.png / ... 
 * - full_sexy_P001_front.png / ...  
 * - pair60_P001_front.png / ...
 * - upper80v2_P001_front.png / ...
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import https from 'https';
import { db } from '@utils-plane/db';
import { aiTryOnReferences } from '@utils-plane/db/schema';

const GITHUB_TREE_API = 'https://api.github.com/repos/anhao/ai-pose-gallery-zh/git/trees/main?recursive=1';

interface GitHubTreeNode {
  path: string;
  type: 'blob' | 'tree';
  size?: number;
}

interface GitHubTreeResponse {
  tree: GitHubTreeNode[];
  truncated: boolean;
}

// 成人内容分类规则（基于文件名推断）
function classifyVisibility(filename: string): 'public' | 'hidden' | 'adult' | 'intimate' {
  const lower = filename.toLowerCase();
  
  // full_sexy 系列中 P018/P019/P051-P054 是 R18
  if (/full_sexy_p0(18|19|5[1-4])/.test(lower)) {
    return 'adult';
  }
  
  // pair60 系列中部分为亲密接触
  if (/pair60_p0(01|030|052|053|009|010|016|019)/.test(lower)) {
    return 'intimate';
  }
  
  // full_sexy 系列中 P026/P028/P029（挤胸），P033/P048/P049（后仰）
  if (/full_sexy_p0(26|28|29|33|48|49)/.test(lower)) {
    return 'hidden';
  }
  
  // A-pose、T-pose、walk 等基础姿势隐藏
  if (/\/(a|t|walk)\.png$/.test(lower)) {
    return 'hidden';
  }
  
  return 'public';
}

function generateTags(filename: string, view: string): string[] {
  const tags: string[] = [view];
  const lower = filename.toLowerCase();
  
  if (lower.includes('full_single')) tags.push('solo', '全身', '单人');
  else if (lower.includes('full_sexy')) tags.push('solo', '性感系', '全身');
  else if (lower.includes('pair60')) tags.push('pair', '双人', '60度');
  else if (lower.includes('upper80')) tags.push('solo', '上半身', '80度');
  
  tags.push('front', 'full-body');
  
  return tags;
}

async function fetchGitHubTree(): Promise<GitHubTreeNode[]> {
  return new Promise((resolve, reject) => {
    https.get(GITHUB_TREE_API, {
      headers: {
        'User-Agent': 'Codex-Utils-Plane',
        'Accept': 'application/vnd.github.v3+json',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API returned ${res.statusCode}`));
        return;
      }
      
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed: GitHubTreeResponse = JSON.parse(data);
          resolve(parsed.tree);
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });
  });
}

async function main() {
  console.log('[ImportPoseFromGitHub] Fetching GitHub file tree...');
  
  const tree = await fetchGitHubTree();
  console.log(`[ImportPoseFromGitHub] Loaded ${tree.length} nodes`);
  
  // 筛选 img/ 下的姿势 PNG 文件
  const poseImgPattern = /^(public\/)?(img\/)(.+_P\d+_(front|side|back|high|low|diag)\.png)$/i;
  const poseFiles = tree
    .filter(node => node.type === 'blob' && poseImgPattern.test(node.path))
    .map(node => {
      const match = node.path.match(poseImgPattern)!;
      return {
        fullPath: node.path,
        filename: match[3],
        view: match[4].toLowerCase(),
      };
    });
  
  console.log(`[ImportPoseFromGitHub] Found ${poseFiles.length} pose image files`);
  
  const records: Array<typeof aiTryOnReferences.$inferInsert> = [];
  
  poseFiles.forEach((file, index) => {
    const { filename, view } = file;
    const slug = filename.replace('.png', '').toLowerCase();
    const visibility = classifyVisibility(filename);
    
    const baseId = slug.replace(`_${view}`, '');
    const titleZh = baseId.replace(/_/g, ' ').toUpperCase() + ` (${view})`;
    const titleEn = baseId + ` ${view}`;
    
    records.push({
      slug,
      kind: 'pose',
      visibility,
      titleZh,
      titleEn,
      descriptionZh: `来自 AI Pose Gallery ZH`,
      descriptionEn: `From AI Pose Gallery ZH`,
      tags: generateTags(filename, view),
      assetBucket: 'try-on-references',
      assetStorageKey: `pose/${filename}`,
      thumbnailBucket: 'try-on-references',
      thumbnailStorageKey: `pose/thumbnails/${filename.replace('.png', '.jpg')}`,
      sourceUrl: 'https://github.com/anhao/ai-pose-gallery-zh',
      licenseName: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: 'AI Pose Gallery ZH',
      isEnabled: true,
      sortOrder: index,
    });
  });
  
  console.log(`[ImportPoseFromGitHub] Generated ${records.length} records`);
  console.log(`[ImportPoseFromGitHub] By visibility:`);
  const vCounts = records.reduce((acc, r) => {
    acc[r.visibility] = (acc[r.visibility] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log(JSON.stringify(vCounts, null, 2));
  
  console.log('[ImportPoseFromGitHub] Inserting records...');
  
  try {
    await db.insert(aiTryOnReferences).values(records).onConflictDoNothing();
    console.log(`[ImportPoseFromGitHub] Successfully imported ${records.length} pose references`);
  } catch (err: any) {
    console.error('[ImportPoseFromGitHub] Insert failed:', err);
    throw err;
  }
  
  // 导出图片清单
  const imageList = records.map(r => ({
    original: `https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/public/img/${r.assetStorageKey.replace('pose/', '')}`,
    thumbnail: `https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/public/thumbs/${r.thumbnailStorageKey.replace('pose/thumbnails/', '')}`,
    minioPath: r.assetStorageKey,
    minioThumbPath: r.thumbnailStorageKey,
    visibility: r.visibility,
  }));
  
  const listPath = path.join(process.cwd(), 'pose-images-github-multiview.json');
  await fs.writeFile(listPath, JSON.stringify(imageList, null, 2));
  console.log(`[ImportPoseFromGitHub] Image list saved to: ${listPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[ImportPoseFromGitHub] Failed:', err);
    process.exit(1);
  });
