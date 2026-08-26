import { Logger } from '@nestjs/common';
import {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFile, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { imageGeneratePresets } from '@utils-plane/db';

const logger = new Logger('SeedImageGeneratePresets');

/**
 * 把内置 AI 生图提示词模板 seed 到 DB（image_generate_presets 表）+ MinIO presets 桶。
 *
 * 模板内容以前硬编码在前端 PRESETS 数组 + messages 文案 + public/presets 静态图，
 * 现在改为 DB + MinIO 匿名只读桶 + GET /tasks/image-generate/presets 下发，
 * 方便后续后台动态运营增删改。本轮只 seed 12 条内置模板，后台 CRUD 留到后续。
 *
 * 脚本职责：
 *   1. 连 DB（postgres({max:1}) + drizzle，finally client.end()）。
 *   2. 连 S3（沿用 models 桶模式），确保 presets 桶存在 + 匿名 GetObject policy + CORS。
 *   3. 从 IMAGE_GENERATE_PRESETS_DIR 读取 12 张示例图，PutObject 到 presets 桶，
 *      key = 文件名，immutable cache。
 *   4. 按 slug upsert 12 行：ON CONFLICT (slug) DO UPDATE 刷新
 *      title/prompt/imageStorageKey/sortOrder/isBuiltin，**不动 is_enabled**
 *      （后台将来禁用的内置模板 re-seed 后仍保持禁用）。
 *
 * 全程失败返回 0 不阻塞启动（仿 sync-id-photo-models.ts）；下次重启会重试。
 *
 * 环境变量：
 *   DATABASE_URL
 *   S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_REGION / S3_FORCE_PATH_STYLE
 *   S3_PRESETS_BUCKET（默认 presets）
 *   IMAGE_GENERATE_PRESETS_DIR（不设时按候选路径探测：镜像内 /app/public/presets、
 *     仓库根 apps/web/public/presets、从 apps/api 起的 ../web/public/presets）
 */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * 示例图目录。显式配了就用配的；否则按候选顺序探测，
 * 让「仓库根跑」「apps/api 下跑」「容器内跑」三种情形都能命中。
 */
async function resolvePresetsDir(): Promise<string | null> {
  const configured = process.env.IMAGE_GENERATE_PRESETS_DIR;
  const candidates = configured
    ? [configured]
    : [
        '/app/public/presets',
        path.resolve(process.cwd(), 'apps/web/public/presets'),
        path.resolve(process.cwd(), '../web/public/presets'),
      ];

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) return candidate;
    } catch {
      // 继续试下一个候选
    }
  }
  return null;
}

interface BuiltinPreset {
  slug: string;
  titleZh: string;
  titleEn: string;
  promptZh: string;
  promptEn: string;
  imageStorageKey: string;
  sortOrder: number;
}

const BUILTIN_PRESETS: BuiltinPreset[] = [
  {
    slug: 'sciencePictureBook',
    titleZh: '导览式科普绘本',
    titleEn: 'Guided science picture book',
    promptZh: `请根据【主题】创作一张高完成度的「导览式科普绘本」风格插画。

这是一张结合"大型场景主视觉 + 导览路线 + 可爱导览 IP + 知识站点 + 儿童科普绘本质感"的场景导览式科普图解页。画面需要让观者像被带着参观一个复杂系统一样，边看边理解主题背后的运行逻辑、空间结构、流程关系和关键知识点。

【基础设定】
主题：【填写主题，例如发射场的一天 / 一个集装箱的旅行 / 地铁站里的秘密路线 / 下潜到深海的一小时 / 机场如何运转 / 医院急诊系统 / 智慧农场 / 消防站出警流程】
画幅比例：【4:3 横版】
主色调：【根据主题自动匹配，整体保持明亮、清爽、儿童友好】
风格方向：【现代儿童科普绘本 / 场景导览式图解 / 高完成度数字插画】

【核心表达】
请围绕【主题】设计一个完整的大型场景或复杂系统。画面中必须有一个明确的主视觉场景，例如大型设施、交通系统、科技装备、自然探索场景、城市公共系统或生产流程。主体要足够清晰、有规模感、有细节，能够成为第一眼的视觉中心。

画面不是单纯展示这个场景，而是要通过"导览路线"的方式组织信息。请设计一条清晰的参观路线、流程路线、时间线或空间动线，让读者可以沿着路线一步步理解这个系统是如何运行的。

【导览 IP 设计】
请为本图设计一个原创、可爱、亲和的导览小 IP。导览 IP 可以是小动物、小朋友、拟人化工具或其他适合主题的原创形象，但必须具有独立原创性，不要照搬任何参考图中的角色、动物形象、服装、配色或搭档关系。

导览 IP 的作用是：
1. 开场介绍主题
2. 指向关键知识点
3. 引导读者顺着路线阅读
4. 增加儿童绘本的陪伴感和趣味性

导览 IP 可以在画面中出现 2–3 次，但不要过度抢主视觉。角色应圆润、可爱、有表情、有动作，适合儿童科普绘本。

【信息结构】
画面中请设置 3–6 个"知识站点"，每个站点用简短中文标签和短说明表达。站点命名可以采用：
- 第1站｜xxx
- 第2站｜xxx
- 重点观察｜xxx
- 小知识｜xxx
- 为什么｜xxx
- 如何工作｜xxx

每个知识点都要围绕主题的核心运行逻辑展开，不要写空泛说明。文字要短、清楚、自然，避免长段落，适合儿童阅读。

【画面模块】
整张图建议包含以下模块：
1. 顶部主标题区：清楚写出主题名称
2. 开场导览区：导览 IP 引出主题
3. 大型主场景区：展示主题系统的完整场景
4. 导览路线区：用箭头、虚线、路径、时间节点或流程线串联知识点
5. 知识站点区：用小信息框、导览牌、局部标注展示关键知识
6. 小百科 / 小贴士区：补充一个有趣知识
7. 收尾区：让导览 IP 做简短总结或引导

【构图要求】
画面采用 4:3 横版构图，整体像一本高质量儿童科普绘本的跨页，也像一张儿童科技馆导览图。画面需要有清晰的视觉重心：大型主场景占据主要空间，导览路线贯穿画面，知识模块自然分布在周围。信息丰富但不能杂乱，阅读路径要顺畅。

【视觉风格】
整体采用现代儿童科普绘本风格：
- 明亮、清爽、干净的色彩
- 清晰自然的手绘线条
- 高完成度数字插画质感
- 细节丰富但有秩序
- 可爱但不低幼
- 有科普图解感
- 有导览地图感
- 场景真实可信，但表达方式亲和

【文字与标注】
文字以中文为主，使用短标题、短标签、简短说明。不要生成大段复杂文字。信息框应像儿童科普书中的导览牌、知识卡片或小贴士。文字要尽量清晰、简洁、可读。

【最终目标】
让整张图像一页高质量的儿童科普绘本：孩子第一眼被可爱角色和大场景吸引，第二眼能顺着路线读懂系统如何运行，第三眼还能继续发现细节和知识点。画面要具有系列化潜力，方便后续替换不同主题继续创作同类型图片。`,
    promptEn: `Create a high-finish "guided science picture book" illustration for a given [TOPIC].

This is a scene-based explainer page that combines a large main-scene visual, a guided route, a cute guide mascot, knowledge stops, and a children's science-book feel. The viewer should feel guided through a complex system, reading its running logic, spatial layout, process flow, and key facts as they go.

[BASE SETUP]
Topic: [fill in, e.g. A Day at the Launch Site / A Container's Journey / Secret Routes in a Subway / An Hour Diving Deep / How an Airport Works / Hospital ER System / Smart Farm / Fire Station Response Flow]
Aspect ratio: [4:3 landscape]
Palette: [match the topic; keep it bright, clean, kid-friendly]
Style: [modern children's science picture book / scene-based explainer / high-finish digital illustration]

[CORE]
Design a full large scene or complex system around the topic. There must be a clear main-scene visual — a large facility, transport system, tech installation, nature scene, public system, or production flow — clear, large-scale, detailed enough to be the first focal point.

Do not just show the scene; organize information via a "guided route." Design a clear visiting path, process line, timeline, or spatial flow so readers follow it step by step and understand how the system runs.

[GUIDE MASCOT]
Design an original, cute, friendly guide mascot for this page. It can be an animal, a child, a personified tool, or another original form that fits the topic, but it must be independently original — do not copy any existing character, animal look, costume, palette, or pairing.

The guide mascot should: 1) introduce the topic, 2) point to key facts, 3) lead readers along the route, 4) add the companionship and fun of a children's book.

The mascot may appear 2–3 times but must not steal the main scene. Keep it round, cute, expressive, in motion, and suited to a children's science book.

[INFO STRUCTURE]
Place 3–6 "knowledge stops," each with a short label and brief note. Stop names may be: Stop 1 | xxx, Stop 2 | xxx, Watch | xxx, Fun fact | xxx, Why? | xxx, How it works | xxx.

Each fact must explain a core running logic of the topic — no vague filler. Text must be short, clear, natural, no long paragraphs, kid-readable.

[MODULES]
Suggested: 1) top title area, 2) opening guide area where the mascot introduces the topic, 3) large main-scene area, 4) guided-route area with arrows, dashed lines, paths, time nodes, or flow lines, 5) knowledge-stop area with info boxes, guide signs, callouts, 6) fun-fact / tip area, 7) closing area where the mascot gives a short summary.

[COMPOSITION]
4:3 landscape, like a high-quality children's science-book spread or a kids' science-museum guide map. Clear focal point: the main scene takes most space, the route runs through, knowledge modules sit around it. Rich but not messy, smooth reading path.

[VISUAL STYLE]
Modern children's science-book: bright, clean color; clear natural hand-drawn lines; high-finish digital illustration; rich detail but orderly; cute but not babyish; explainer feel; map-guide feel; believable scene, friendly delivery.

[TEXT]
Short titles, short labels, brief notes — no long complex paragraphs. Info boxes like guide signs, fact cards, or tips in a children's book. Keep text clear, concise, readable.

[GOAL]
Like one page of a high-quality children's science book: kids are drawn in by the cute character and big scene, follow the route to read how the system runs, and keep finding new details. The page should be serializable so other topics can reuse the same layout.`,
    imageStorageKey: 'science-picture-book.jpg',
    sortOrder: 0,
  },
  {
    slug: 'marketStallProposal',
    titleZh: '集市摊位设计提案',
    titleEn: 'Market stall design proposal',
    promptZh: `请根据以下用户输入，生成一张横版 4:3 的《创意集市摊位设计提案板 / Creative Market Stall Proposal Board》。

这不是单纯的摊位效果图，而是一张完整的品牌出摊视觉提案图，需要同时呈现：摊位实景渲染、物料展开、尺寸示意、配色材质、品牌元素、IP形象、使用场景和核心亮点。

【用户输入】
品牌名：【填写品牌名】
摊位主题：【填写主题，例如鲜果气泡饮 / 章鱼小丸子 / 甜品冰品 / 文创手作】
主营产品：【填写具体产品】
目标人群：【年轻人 / 学生 / 女性消费者 / 亲子家庭 / 文创市集人群等】
整体风格：【清爽活力 / 街头热食 / 梦幻甜美 / 文艺手作 / 复古可爱 / 高饱和潮流等】
主色调：【填写主色】
辅助色：【填写辅助色】
IP形象：【填写IP设定，例如青柚精灵 / 小丸子研究员 / 云朵精灵 / 邮差小狗】
核心口号：【填写一句短口号】
使用场景：【文创市集 / 美食市集 / 校园活动 / 音乐节 / 商场快闪 / 品牌路演】

【整体画面要求】
画面比例为横版 4:3。
整体是一张专业的摊位设计提案板，采用高信息量但清晰有序的版式。
画面需要有明显的设计感、提案感和商业落地感，不要像普通广告海报，也不要像单纯效果图。

整体视觉应融合：
1. 写实摊位渲染效果图
2. 平面物料展开图
3. 简化尺寸结构图
4. 品牌视觉系统展示
5. 手绘批注、箭头、圈注、marker 标记
6. 淡淡的纸张纹理或设计稿纹理背景

整体风格参考当代年轻人喜欢的文创集市、美食集市、快闪摊位、品牌市集摊位。需要新潮、好拍照、适合打卡传播，同时看起来真实可搭建、可落地执行。

【版式结构】
整张图应包含以下板块：

1. 顶部标题区
- 大标题：【品牌名】· 创意集市摊位设计提案
- 副标题：【主题品类】视觉系统 / Pop-up Stall Proposal
- 标题字体要有设计感，不能太普通
- 可以加入少量手绘符号、品牌图形、IP小头像或短口号

2. 主视觉效果区
- 左侧或画面核心区域放一张最大的摊位写实渲染图
- 场景为真实文创集市 / 户外市集 / 美食集市 / 商场快闪 / 校园活动等
- 需要有背景人流、帐篷、树木、灯串、摊位氛围，但人物不要喧宾夺主
- 摊位必须是"文创集市标准摊位"，不是三轮车、不是餐车
- 摊位结构包括：顶部异形招牌、前台围板、侧边围板、菜单立牌、挂牌、产品陈列、IP立牌、打卡装置、灯光或装饰物
- 主视觉要写实、清晰、有真实搭建感

3. 物料展开区 / Graphic & Materials
展示这套摊位涉及的主要物料设计，采用平铺设计稿方式呈现：
- 顶部招牌
- 前台围板
- 侧边围板
- 菜单立牌 A3
- 挂牌 / 双面吊牌
- 贴纸 / 小标识
- 吉祥物立牌
- 价格标签
- 手持打卡牌
每个物料旁边可以有简短编号和中文标签，排版要整洁，有设计提案感。

4. 尺寸示意区 / Dimensions
展示摊位的简化正视图和侧视图。
加入可信的尺寸标注，例如：
- 总宽度 240cm
- 总高度 260cm
- 柜体宽度 220cm
- 操作台高度 90cm
- 顶部招牌高度 70cm
- 侧面深度 60-120cm
尺寸不需要像 CAD 一样精确，但要看起来专业、合理、可落地。
可以加入人物比例剪影作为参照。

5. 配色 / 材质区 / Color & Material
展示 4-5 个色块，并标注色彩名称和近似 HEX 色值。
展示推荐材质，例如：
- KT板
- 雪弗板
- 泡沫板异形切割
- 亚克力灯箱
- PVC贴纸
- 防水喷绘布
- 金属框架
- 木纹板 / 布旗 / 灯串等
材质展示要像设计提案板，不要过于杂乱。

6. 品牌元素区 / Brand Elements
展示完整品牌视觉系统：
- Logo组合
- IP吉祥物
- 吉祥物表情包
- 辅助图形
- 产品图标
- 底纹 / 延展图案
- 小贴纸元素
这一块要体现品牌可延展性，而不是只做一个摊位外观。

7. 摊位类型区 / Stall Type
明确写出：
A. 文创集市标准摊位（本方案主推）
说明适用场景：
文创市集 / 美食市集 / 校园活动 / 音乐节 / 商场快闪 / 品牌路演
说明特点：
模块化搭建、运输方便、视觉醒目、适合拍照打卡、物料可复用。

注意：本图只展示"文创集市标准摊位"，不要展示三轮车流动摊位。

8. 使用场景 / 设计关键词 / 核心亮点
底部可以加入小型信息栏：
- 使用场景：文创市集、校园活动、音乐节、商场快闪、品牌路演
- 设计关键词：年轻、打卡、社交、模块化、高识别、可延展
- 核心亮点：高辨识度、易搭建、强互动、高传播、可复用、适合商业落地

【视觉风格要求】
整体画面要明亮、有冲击力，避免颜色太淡、太灰、太暗。
提高对比度，主色要更饱和，标题和重点信息要清晰有力。
背景可以使用淡淡的纸张纹理、印刷纹理、设计稿纹理或浅色图案，但不能抢主体。
版式要专业、整洁、有层次，像设计师给客户做的完整摊位提案板。
可以加入少量手绘箭头、圈注、便利贴感批注、marker笔记，增强提案氛围。

中文文字要简洁，不要塞太多长句。
主标题、板块标题、口号、标签尽量清晰准确。
所有品牌名、口号、IP和物料文字都必须原创，不要复制任何参考图里的品牌、标语或具体文字。

【最终效果】
生成一张完整、专业、年轻化、高完成度的创意集市摊位设计提案板。
它应该看起来像一个小品牌从 0 到 1 的出摊视觉系统方案：
既有真实摊位落地效果，又有物料设计、尺寸说明、品牌系统和商业应用场景。`,
    promptEn: `Generate a 4:3 landscape "Creative Market Stall Proposal Board" from the user input below.

Not a simple stall render — a complete brand pop-up visual proposal showing the stall render, laid-out materials, dimension callouts, color and material, brand elements, mascot, usage scenes, and key highlights in one board.

[USER INPUT]
Brand name: [fill in]
Stall theme: [fill in, e.g. fresh fruit sparkling drink / mini takoyaki / dessert & ice / creative handmade]
Main product: [fill in]
Target audience: [young people / students / female shoppers / families with kids / market-goers]
Overall style: [fresh & energetic / street hot food / dreamy & sweet / artsy handmade / retro cute / high-saturation trend]
Primary color: [fill in]
Secondary color: [fill in]
Mascot: [fill in, e.g. grapefruit sprite / takoyaki researcher / cloud sprite / postman pup]
Slogan: [fill in one short slogan]
Usage scene: [creative market / food market / campus event / music festival / mall pop-up / brand roadshow]

[OVERALL IMAGE]
4:3 landscape. A professional stall design proposal board — high information density but clean and orderly. Designed, proposal-like, commercially ready-to-build — not a generic ad poster, not a bare render.

Fuse: 1) realistic stall render, 2) flat material lay-flat sheet, 3) simplified dimension diagram, 4) brand visual system, 5) hand-drawn annotations, arrows, circles, marker notes, 6) a faint paper / design-draft texture background. Fresh, photogenic, check-in friendly, yet genuinely buildable.

[LAYOUT]
1. Top title: main title "[Brand] · Creative Market Stall Design Proposal"; subtitle "[theme] Visual System / Pop-up Stall Proposal"; designed (not generic) title font; a few hand-drawn marks, brand graphics, mascot avatars, or a short slogan.
2. Main visual: the largest realistic stall render on the left or core. Scene: a real creative market / outdoor market / food market / mall pop-up / campus event. Background crowd, tents, trees, string lights — but people must not steal focus. The stall must be a "standard creative-market stall" — not a tricycle cart, not a food truck. Structure: shaped top sign, front fascia, side fascia, menu standee, hanging tags, product display, mascot standee, photo-op installation, lighting or decor. Realistic, clear, real build feel.
3. Materials lay-flat: flat design sheets — top sign, front fascia, side fascia, menu standee A3, hanging / double-sided tag, stickers / small marks, mascot standee, price tags, handheld photo-op card. Each with a short number and label; tidy, proposal-like.
4. Dimensions: simplified front and side views with credible dimensions (total width 240cm, total height 260cm, counter width 220cm, counter height 90cm, top sign height 70cm, side depth 60-120cm). Not CAD-precise but professional, reasonable, buildable. A human-scale silhouette may be added.
5. Color / Material: 4-5 swatches with names and approximate HEX; recommended materials (KT board, PVC foam board, foam die-cut, acrylic light box, PVC sticker, waterproof print fabric, metal frame, wood-grain board / fabric flag / string lights). Proposal-board feel, not cluttered.
6. Brand Elements: full brand visual system — logo lockups, mascot, mascot emoji set, secondary graphics, product icons, background / extension pattern, small stickers. Show brand extensibility, not just a stall exterior.
7. Stall Type: state "A. Standard creative-market stall (main recommendation)." Applicable scenes: creative market / food market / campus event / music festival / mall pop-up / brand roadshow. Features: modular build, easy to transport, visually striking, photo-friendly, reusable materials. Do not show tricycle mobile stalls.
8. Bottom info bar: usage scenes (creative market, campus event, music festival, mall pop-up, brand roadshow); design keywords (young, check-in, social, modular, high-recognition, extensible); key highlights (high recognition, easy to build, strong interaction, high sharing, reusable, commercially ready).

[VISUAL STYLE]
Bright and punchy — avoid washed-out, gray, dark looks. Boost contrast; primary color more saturated; titles and key info clear and strong. Background may use a faint paper, print, or design-draft texture or light pattern, but must not steal focus. Professional, tidy, layered — like a designer's full stall proposal to a client. A few hand-drawn arrows, circles, sticky-note annotations, and marker notes may heighten the proposal feel.

Keep text concise — no long sentences. Titles, section titles, slogans, labels clear and accurate. All brand names, slogans, mascot, and material text must be original — do not copy any reference image's brand, tagline, or specific text.

[FINAL RESULT]
A complete, professional, youthful, high-finish creative market stall design proposal board — like a small brand's 0-to-1 pop-up visual system: real stall build effect plus material design, dimensions, brand system, and commercial use scenes.`,
    imageStorageKey: 'market-stall-proposal.jpg',
    sortOrder: 1,
  },
  {
    slug: 'twitterArticleCover',
    titleZh: 'X 推文文章封面',
    titleEn: 'X / Twitter article cover',
    promptZh: `请为我的文章生成一张高级感 X/Twitter 推文封面图。

【文章标题】：
填入你的文章标题

【文章主题/核心内容】：
填入你的文章内容，或者用 3-5 句话概括这篇文章讲什么

【目标风格】：
高级、简约、现代、像 X 上热门文章封面图，带教程感/专栏感/官方感，不要廉价海报感。

【画面要求】：
横版 5:2 比例，深色背景，适合 X 暗黑模式。
左侧放超大号主标题，标题要清晰、有冲击力，手机缩略图也能看清。
右侧根据文章主题生成一个视觉主体，可以是 UI 面板、数据图表、产品界面、人物剪影、工具图标、流程卡片、科技元素等。
画面中加入和文章内容相关的图标、关键词标签、信息卡片、步骤模块，让画面丰富但不杂乱。

【文字排版】：
主标题使用大号粗体中文字体。
从文章标题中自动提取 1-2 个关键词，用蓝色/紫色/金色渐变高亮。
可以加入一个小标签，例如：
"X 文章封面"
"实战教程"
"Prompt 模板"
"AI 工具指南"
根据文章内容自动选择最合适的标签。

【视觉元素】：
根据文章主题自动生成相关元素：
如果是 AI / Prompt 类文章：加入提示词输入框、聊天气泡、鼠标指针、AI 图标、UI 卡片。
如果是 Web3 / 加密类文章：加入 K 线、链上数据、钱包、代币图标、数据面板。
如果是电商类文章：加入产品卡片、价格标签、购物车、数据看板、商品展示框。
如果是教程类文章：加入步骤卡片、流程线、编号模块、工具图标。
如果是个人 IP 类文章：加入头像区域、专栏卡片、社媒界面、个人品牌标签。

【整体设计】：
深黑色/深蓝色/炭灰色渐变背景。
加入细微网格线、柔和光晕、玻璃拟态 UI 卡片、霓虹描边、细节线条、虚线连接。
整体要有层次感、空间感、专业感。
画面丰富，有图标、有文字、有主题、有视觉焦点，但保持干净高级。
不要卡通，不要廉价促销风，不要杂乱，不要土味配色，不要过多小字。

【输出要求】：
生成一张 5:2 横版封面图。
文字必须清晰可读，中文不要乱码。
高级社交媒体封面，premium editorial design, dark futuristic UI, glassmorphism, clean typography, high contrast, polished, modern, professional.`,
    promptEn: `Generate a premium X/Twitter article cover image.

[ARTICLE TITLE]
Fill in your article title

[ARTICLE TOPIC / CORE CONTENT]
Fill in your article content, or summarize in 3-5 sentences

[TARGET STYLE]
Premium, minimal, modern — like a trending X article cover. Editorial / column / official feel, not a cheap poster.

[IMAGE]
5:2 landscape, dark background, fits X dark mode. Place an oversized main title on the left — clear, punchy, readable even as a phone thumbnail. On the right, generate a visual subject tied to the topic: a UI panel, data chart, product interface, silhouette, tool icon, flow card, or tech element. Add topic-relevant icons, keyword tags, info cards, and step modules — rich but not cluttered.

[TYPOGRAPHY]
Main title in large bold Chinese font. Auto-extract 1-2 keywords from the title and highlight them in a blue / purple / gold gradient. Add a small tag chosen to fit the article, e.g. "X Article Cover", "Hands-on Tutorial", "Prompt Template", "AI Tool Guide".

[VISUAL ELEMENTS]
Generate elements by topic:
- AI / Prompt article: prompt input box, chat bubbles, cursor, AI icon, UI cards.
- Web3 / crypto article: candlestick chart, on-chain data, wallet, token icons, data panel.
- E-commerce article: product cards, price tags, cart, dashboard, product showcase.
- Tutorial article: step cards, flow lines, numbered modules, tool icons.
- Personal-brand article: avatar area, column cards, social-media interface, brand tags.

[OVERALL DESIGN]
Dark-black / dark-blue / charcoal gradient background. Add subtle grid lines, soft glow, glassmorphism UI cards, neon outlines, detail lines, dashed connectors. Layered, spatial, professional. Rich — icons, text, topic, a focal point — but clean and premium. No cartoon, no cheap promo look, no clutter, no tacky colors, not too much small text.

[OUTPUT]
A 5:2 landscape cover. Text must be crisp and readable — no garbled Chinese. Premium social cover: premium editorial design, dark futuristic UI, glassmorphism, clean typography, high contrast, polished, modern, professional.`,
    imageStorageKey: 'twitter-article-cover.jpg',
    sortOrder: 2,
  },
  {
    slug: 'xiaohongshuCover',
    titleZh: '小红书封面',
    titleEn: 'Xiaohongshu cover',
    promptZh: `请根据以下用户输入，生成一张小红书风格的竖版封面图，主打「流量密码」——一眼就想点进去看详情。

【用户输入】
画面主体：【填写主体，例如护肤品瓶子 / 清单笔记本 / 对比图】
周围元素：【填写周围散落物，例如花瓣和珍珠 / 图标 / 标签贴纸】
顶部大标题：【填写一句吸睛短标题，例如"熬夜党必备神器" / "3个方法" / "Before After 对比"】
配色基调：【柔和粉色和奶油色调 / 清新蓝白 / 奶油黄 / 莫兰迪绿等】
整体风格：【韩系美妆杂志内页 / 干货清单卡片 / 对比评测卡 / 治愈日常】
使用场景：【美妆护肤 / 穿搭 / 美食 / 学习干货 / 好物分享 / 对比测评】

【画面要求】
比例 3:4 竖版。
画面中央放【画面主体】，周围散落【周围元素】。
顶部用大号可爱手写风格字体写着【顶部大标题】，标题清晰有冲击力，手机信息流缩略图也能看清。
光线温暖、梦幻、稍微过曝，营造柔和氛围。
整体 aesthetic 感强，让人想点进去看详情。

【风格变体微调】
如果是干货类（学习方法 / 清单 / 教程）：把主体换成清单 / 笔记本 / 便签，标题改成"3个方法""5个工具"这类数字清单口吻，配色可换清新蓝白或奶油黄，周围元素换成图标和打勾标签。
如果是对比类（Before/After / 避坑 / 红黑榜）：左右分栏，左侧 Before 右侧 After 做对比，中间用箭头或分隔线，标题突出"对比""避坑""红黑榜"。
如果是种草类（好物 / 护肤 / 穿搭）：保持中央产品 + 周围花瓣珍珠的韩系美妆杂志内页风，粉色奶油色调，光线过曝梦幻。

【视觉风格】
韩系美妆杂志内页质感，柔和手写体标题，信息流封面级第一眼吸引力。
不要廉价促销风，不要杂乱，不要过多小字，标题和主体必须清晰。

【最终目标】
一张让人在信息流里想立刻点进去的小红书封面：主体清晰、标题吸睛、配色柔和高级、自带流量密码感，可替换不同主题继续创作。`,
    promptEn: `Generate a vertical Xiaohongshu (RED) style cover image built for clicks — a "traffic magnet" that makes people want to tap through.

[USER INPUT]
Main subject: [fill in, e.g. skincare bottle / checklist notebook / comparison chart]
Surrounding elements: [fill in, e.g. petals and pearls / icons / sticker tags]
Top headline: [fill in a punchy short title, e.g. "Late-Night Saver" / "3 Methods" / "Before After"]
Color base: [soft pink & cream / fresh blue & white / butter yellow / Morandi green, etc.]
Overall style: [Korean beauty magazine inner page / how-to checklist card / comparison review card / cozy daily]
Use scene: [beauty & skincare / outfit / food / study tips / good finds / comparison review]

[IMAGE]
3:4 vertical. Place the main subject at the center, scatter the surrounding elements around it. Place an oversized cute handwritten-style headline at the top — clear, punchy, readable even as a feed thumbnail. Warm, dreamy, slightly overexposed light for a soft mood. Strong aesthetic — makes people want to tap through.

[STYLE VARIANTS]
How-to (methods / checklist / tutorial): swap the subject for a checklist / notebook / sticky note, title in a numbered-list tone ("3 Methods", "5 Tools"), switch palette to fresh blue-white or butter yellow, surrounding elements become icons and check tags.
Comparison (Before/After / pitfall / red-black list): split left-right, Before on the left and After on the right, with an arrow or divider in the middle; title emphasizes "comparison", "pitfall", "red-black list".
Recommendation (good finds / skincare / outfit): keep the central product + petals-and-pearls Korean beauty magazine inner-page style, pink-cream palette, dreamy overexposed light.

[VISUAL STYLE]
Korean beauty magazine inner-page feel, soft handwritten title, feed-cover-grade first-glance pull. No cheap promo look, no clutter, not too much small text — the title and subject must stay clear.

[GOAL]
A Xiaohongshu cover that makes people tap through the instant they see it in the feed: clear subject, punchy title, soft premium palette, a built-in traffic-magnet feel. Serializable for other topics.`,
    imageStorageKey: 'xiaohongshu-cover.jpg',
    sortOrder: 3,
  },
  {
    slug: 'wechatArticleCover',
    titleZh: '公众号文章封面',
    titleEn: 'WeChat article cover',
    promptZh: `请根据以下用户输入，生成一张高级微信公众号文章封面图，横版 16:9，主打意境感与强烈点击欲。

【用户输入】
文章主题/标题：【填写主题，例如"师妹带你玩转GPT"】
大标题分两行：【第一行，例如"师妹带你"】【第二行，例如"玩转GPT"】
高亮关键词：【填写要放大并做渐变高亮的词，例如"GPT"】
高亮渐变色：【薄荷绿/青绿色渐变 / 金紫渐变 / 蓝青渐变 / 莫兰迪渐变等】
背景氛围色：【深黑+墨绿+薄荷绿 / 深蓝+青 / 炭灰+金 / 深紫+粉等】
主角人物：【填写人物设定，例如年轻女性侧脸半身 / 男性侧脸 / 无人物纯产品】
主角气质：【冷静聪明 / 高级专业 / 亲和活力】
信息卡片标签：【填写3个左右短标签，例如"创意生成""高效写作""代码助手"】
左上角品牌标识：【填写图标+文字，例如"ChatGPT 图标"】

【整体风格】
高级、简约、科技感、公众号爆款文章封面、官方教程封面质感。
深色背景，背景氛围色渐变，干净但画面丰富，有强烈点击欲,不廉价,不花哨。

【画面布局】
左侧是大标题，中文大字排版分两行：
【大标题第一行】
【大标题第二行】
其中【高亮关键词】使用更大的字体，做成高亮渐变色，文字要清晰、粗体、有高级感。
标题下方加一条细长的弧形光线装饰，颜色与高亮渐变呼应，提升设计感。

左上角放置【左上角品牌标识】，图标要清晰、简洁、现代。

右侧放【主角人物】，气质【主角气质】，黑色或深色衣服，柔和侧光，真实摄影质感，不要卡通。
（无人物主题可换成大型 3D 产品图标或抽象科技主体。）
人物前方放一个大型 3D 图标，深色玻璃质感，边缘有发光效果。

周围加入少量半透明玻璃拟态信息卡片，卡片上是简短中文标签：
【信息卡片标签1】
【信息卡片标签2】
【信息卡片标签3】
每个卡片配极简线性小图标，如灯泡、文档、代码符号等。
加入细微的虚线连接、圆形光环、AI 界面元素，营造智能工具感。

【色彩与字体】
色彩：深黑、背景氛围色、高亮渐变色、白色，少量霓虹光。
字体：现代无衬线字体，大标题粗体，排版高级，手机端缩略图也能看清。
画面要有留白、有层次、有高级光影，不要杂乱。
无水印，无多余文字，无乱码。

【最终目标】
一张高级感、意境感、科技感拉满的公众号文章封面：左侧大标题吸睛、右侧人物/科技主体有质感、玻璃卡片丰富层次，整体像官方教程封面，让人想立刻点进去读全文。`,
    promptEn: `Generate a premium WeChat Official Account article cover image, 16:9 landscape, built for mood and click-through pull.

[USER INPUT]
Article theme / title: [fill in, e.g. "Mentor Sister Walks You Through GPT"]
Two-line headline: [line 1, e.g. "Mentor Sister Walks You"] [line 2, e.g. "Through GPT"]
Highlight keyword: [fill in the word to enlarge and gradient-highlight, e.g. "GPT"]
Highlight gradient: [mint-green / cyan-green / gold-purple / blue-cyan / Morandi]
Background mood: [dark-black + ink-green + mint / deep-blue + cyan / charcoal + gold / deep-purple + pink]
Main character: [fill in, e.g. young female side-profile half-body / male side profile / no character — product only]
Character vibe: [calm & smart / premium & professional / warm & energetic]
Info card tags: [fill in ~3 short tags, e.g. "Creative", "Efficient Writing", "Code Helper"]
Top-left brand mark: [fill in icon + text, e.g. "ChatGPT icon"]

[OVERALL STYLE]
Premium, minimal, tech-forward — a viral WeChat article cover, official-tutorial-cover quality. Dark background with a mood-color gradient. Clean yet rich, strong click-pull, not cheap, not gaudy.

[LAYOUT]
Left side: a large two-line Chinese headline:
[headline line 1]
[headline line 2]
The [highlight keyword] uses a larger size with the [highlight gradient] — crisp, bold, premium.
Below the title, add a thin curved arc of light in a color echoing the highlight gradient to lift the design.

Top-left: place the [top-left brand mark] — clear, clean, modern.

Right side: place the [main character], [character vibe], dark clothing, soft side light, realistic photographic feel, not cartoon.
(For no-character themes, swap in a large 3D product icon or abstract tech subject.)
In front of the character, place a large 3D icon in dark glass with glowing edges.

Around them, add a few translucent glassmorphism info cards with short Chinese tags:
[tag 1]
[tag 2]
[tag 3]
Each card has a minimal linear icon (lightbulb, document, code symbol, etc.).
Add subtle dashed connectors, circular halos, and AI-interface elements for a smart-tool feel.

[COLOR & TYPE]
Colors: deep black, the background mood color, the highlight gradient, white, a touch of neon glow.
Type: modern sans-serif, bold headline, premium layout, readable even as a phone thumbnail.
Leave whitespace, layer the light and shadow, keep it uncluttered.
No watermark, no stray text, no garbled characters.

[GOAL]
A premium, moody, tech-forward WeChat article cover: punchy headline on the left, textured character / tech subject on the right, glass cards adding depth — like an official tutorial cover that makes people want to tap through and read the full article.`,
    imageStorageKey: 'wechat-article-cover.jpg',
    sortOrder: 4,
  },
  {
    slug: 'personalIpCover',
    titleZh: '个人 IP 封面',
    titleEn: 'Personal IP cover',
    promptZh: `请把上传的头像做成一张高级个人 IP 风格的 X 推文封面图，比例 5:2。

【用户输入】
我的 IP 名：【填写你的名字/账号名】
文章标题：【填写你的文章标题】
文章简介：【用1-2句话填写文章主要内容，也可以直接塞全文】
头像位置：【画面一侧，例如左侧 / 右侧】
背景质感：【例如黑金 / 墨绿金 / 深蓝银 / 炭灰金】

【画面要求】
整体要像高级专栏封面、知识博主文章头图、官方教程 Banner。
使用深色背景，【背景质感】质感，适合 X 暗黑模式。
头像人物放在画面【头像位置】，作为个人 IP 视觉核心，要高级、精致、有博主感。
另一侧放文章标题和简介，排版要大气、清晰、有层次：
- 大标题写【文章标题】
- 简介写【文章简介】
- 可加一行小字【我的 IP 名】作为专栏署名
画面中加入一个精致的 X logo。
根据文章主题加入少量相关图标或元素。
整体要高级、简约、干净、有点击欲，不要廉价海报感，不要杂乱，不要太多字。

【最终目标】
一张像高级知识博主专栏头图的 X 推文封面：头像有 IP 感、标题大气、质感高级，让人想点进去读全文。可替换不同头像和文章继续创作。`,
    promptEn: `Turn an uploaded avatar into a premium personal-IP style X/Twitter post cover, 5:2.

[USER INPUT]
My IP name: [fill in your name / handle]
Article title: [fill in your article title]
Article intro: [fill in 1-2 sentences on the main content, or paste the full text]
Avatar placement: [one side of the image, e.g. left / right]
Background texture: [e.g. black-gold / ink-green gold / deep-blue silver / charcoal gold]

[IMAGE]
Like a premium column cover, knowledge-blogger article hero, or official tutorial banner. Dark background with [background texture] feel, fit for X dark mode. Place the avatar on [avatar placement] as the personal-IP visual core — premium, refined, blogger-like. On the other side, place the article title and intro with an airy, clear, layered layout:
- Main title: [article title]
- Intro: [article intro]
- Optional small line: [my IP name] as a column byline
Add a refined X logo. Add a few topic-relevant icons or elements. Premium, minimal, clean, click-worthy — no cheap-poster feel, no clutter, not too much text.

[GOAL]
A premium knowledge-blogger column-style X post cover: avatar with IP feel, an airy title, premium texture, making people want to tap through. Serializable for other avatars and articles.`,
    imageStorageKey: 'personal-ip-cover.png',
    sortOrder: 5,
  },
  {
    slug: 'ecommerceProduct',
    titleZh: '电商产品图与场景图',
    titleEn: 'E-commerce product image',
    promptZh: `请根据以下用户输入，生成一张专业电商产品图，干净、商业感、高端目录风格。

【用户输入】
产品主体：【填写产品，例如不锈钢保温杯 / 护肤品瓶 / 耳机 / 咖啡杯 / 香水】
画面类型：【白底产品图 / 场景图】
产品角度：【填写摆放角度，例如稍微倾斜30度 / 正面平视 / 俯拍45度】
灯光方向：【填写灯光，例如左侧柔和工作室灯光 / 顶部柔光 / 双侧柔光】
阴影方向：【填写阴影，例如右侧自然淡淡阴影 / 正下方接触阴影】
使用场景：【仅白底图不填；场景图填写，例如木质桌面早餐 / 户外露营 / 浴室梳妆台】

【白底产品图】
纯白色背景。
一个【产品主体】居中放置，【产品角度】，展示产品深度。
【灯光方向】，【阴影方向】。
干净、商业感、高端目录风格。
没有任何文字、没有任何道具、没有任何水印。
焦点锐利，8K 品质感。
比例 1:1。

【场景图微调】
如果是场景图：把纯白背景换成与【使用场景】匹配的真实环境（木质桌面、大理石、户外草地等），产品融入生活场景，加入少量自然道具（如咖啡豆、毛巾、绿叶），保持产品仍是视觉焦点，整体高级生活方式感，不杂乱。
比例可按平台需要调整为 3:4 或 1:1。

【整体要求】
商业摄影质感，材质与高光真实，色彩还原准确，产品主体清晰锐利。
不要文字、不要水印、不要过度装饰道具喧宾夺主。
适合电商主图、详情页与社媒投放，可替换不同产品继续创作。`,
    promptEn: `Generate a professional e-commerce product image — clean, commercial, high-end catalog feel.

[USER INPUT]
Product: [fill in, e.g. stainless steel thermos / skincare bottle / headphones / coffee cup / perfume]
Image type: [white-background product / scene shot]
Product angle: [fill in, e.g. tilted 30 degrees / front eye-level / top-down 45 degrees]
Lighting direction: [fill in, e.g. soft studio light from the left / top softbox / dual soft light]
Shadow direction: [fill in, e.g. soft natural shadow on the right / contact shadow directly below]
Scene: [leave blank for white-background; for scene shot fill in, e.g. wooden breakfast table / outdoor camping / bathroom vanity]

[WHITE-BACKGROUND PRODUCT]
Pure white background. Place the [product] centered, [product angle], showing product depth. [lighting direction], [shadow direction]. Clean, commercial, high-end catalog feel. No text, no props, no watermark. Sharp focus, 8K quality. 1:1.

[SCENE VARIANT]
For a scene shot: replace the white background with a real environment matching [scene] (wooden table, marble, outdoor grass, etc.), place the product in a lifestyle scene with a few natural props (coffee beans, towel, green leaves), keep the product as the focal point, overall premium lifestyle feel, not cluttered. Aspect ratio may shift to 3:4 or 1:1 per platform.

[OVERALL]
Commercial photography feel, realistic materials and highlights, accurate color, sharp product. No text, no watermark, no props that steal focus. Fits e-commerce hero images, detail pages, and social ads. Serializable for other products.`,
    imageStorageKey: 'ecommerce-product.jpg',
    sortOrder: 6,
  },
  {
    slug: 'ecommerceDetailPage',
    titleZh: '电商产品详情页',
    titleEn: 'E-commerce product detail page',
    promptZh: `请根据以下用户输入，生成一张高级感电商产品详情页海报，竖版构图，比例 4:5，像高端品牌电商详情页整合图。

【用户输入】
产品名称：【填写产品，例如不锈钢保温杯 / 护肤精华 / 蓝牙耳机 / 咖啡机】
主标题：【填写主标题，与产品名一致或品牌名+品类】
副标题：【填写一句话卖点，例如简约设计・双层锁温・防漏便携】
顶部小字：【填写一句情绪标语，例如精致生活・品质之选】
主图卖点正文：【填写2-3句产品说明，例如精选不锈钢材质，双层真空锁温，长效保温保冷】
产品主图描述：【填写外观，例如银色拉丝金属杯身、浅灰杯盖、按压锁扣、稍倾斜立体感】
主色调：【填写配色，例如白色+浅灰+香槟金 / 米白+原木+墨绿 / 纯白+浅蓝+银】
四个功能卖点：【填写4组"标题：说明"，例如双层锁温：长效保温保冷】
三个细节特写：【填写3组"标题：说明"，例如杯盖锁扣细节：一键锁扣设计：轻松开合】
场景模块标题/副标题/正文：【例如随行相伴 / 每一刻都从容 / 通勤办公出行一杯好水陪伴品质生活】
三个场景标签：【例如通勤办公 / 差旅出行 / 车载随行】
三个信任背书：【填写3组，例如精选304不锈钢：安全材质安心饮水】

【整体风格】
像高端品牌电商详情页，简约、干净、精致、轻奢、有质感，版式清晰，图文并茂，适合电商展示。
主色调以【主色调】为主，画面高级，不廉价，不杂乱，不要淘宝低端风。
排版像完整的产品详情页，留白舒服，层次清晰，文字规整，不能出框，不能拥挤。
字体风格高级，中文排版精致，视觉重点突出产品同时兼顾信息讲解。
不要低端促销感，不要过度花哨，不要杂色，不要水印。

【画面内容分模块】
画面内容分为多个信息模块，从上到下排版像完整的产品详情页：

1. 首屏主视觉模块
- 左侧是大标题和卖点文案，右侧是产品主图。
- 大标题写【主标题】。
- 副标题写【副标题】。
- 上方小字写【顶部小字】。
- 正文简短说明：【主图卖点正文】。
- 右侧展示一个高端【产品主图描述】，像专业棚拍图。背景纯净白色，左侧柔和工作室灯光，右侧自然淡阴影，焦点锐利，8K 质感。

2. 功能卖点图标模块
- 使用4个高级极简线性图标，搭配短文案，排版整齐，图标为香槟金色（或与主色调呼应）。
- 四个卖点分别写【四个功能卖点】。

3. 细节展示模块
- 下方做3个细节特写小图，排成一行，每个小图下方带标题和简短说明。
- 三个特写分别写【三个细节特写】。

4. 场景氛围模块
- 底部增加一个生活方式场景模块，左侧文案，右侧产品站立展示。
- 大标题写【场景模块标题】，副标题写【场景模块副标题】，正文写【场景模块正文】。
- 下方配3个小图标和文字：【三个场景标签】。
- 右侧场景为极简高级生活方式空间，浅色桌面，柔和窗景背景，产品直立摆放，氛围干净高级。

5. 底部信任背书模块
- 底部做3个横向卖点标签，配小图标：【三个信任背书】。

【最终目标】
整体效果像高端品牌旗舰店详情页首屏+详情模块整合图：首屏主视觉+功能卖点+细节特写+场景氛围+信任背书，一页讲清产品，可替换不同产品继续创作。`,
    promptEn: `Generate a premium e-commerce product detail-page poster, 4:5 vertical, like a high-end brand detail page integrated image.

[USER INPUT]
Product name: [fill in, e.g. stainless steel thermos / skincare serum / bluetooth earbuds / coffee machine]
Main title: [fill in, product name or brand + category]
Subtitle: [fill in a one-line selling point, e.g. Minimalist Design · Double-Layer Thermal · Leakproof & Portable]
Top small text: [fill in a mood line, e.g. Refined Living · The Quality Choice]
Hero copy: [fill in 2-3 sentences, e.g. Premium stainless, double-wall vacuum, long-lasting hot or cold]
Product render: [fill in appearance, e.g. silver brushed metal body, light-gray lid, press-lock cap, slightly tilted for depth]
Primary palette: [fill in, e.g. white + light gray + champagne gold / cream + oak + ink green / pure white + soft blue + silver]
Four feature points: [fill in 4 "title: note" pairs, e.g. Double-wall thermal: long-lasting hot or cold]
Three detail close-ups: [fill in 3 "title: note" pairs, e.g. Lid lock detail: One-press lock: easy one-hand open]
Scene module title / subtitle / copy: [e.g. Always With You / Calm In Every Moment / Commute, office, or travel — a good cup of water for a quality life]
Three scene tags: [e.g. Commute & Office / Travel / Car]
Three trust badges: [fill in 3, e.g. 304 Stainless Steel: Safe material, worry-free drinking]

[OVERALL STYLE]
Like a high-end brand e-commerce detail page — minimal, clean, refined, quietly premium, textured, clear layout, text-and-image, fit for e-commerce. Palette built on [primary palette]. Premium, not cheap, not cluttered, no low-end marketplace vibe. Layout like a complete product detail page — comfortable whitespace, clear hierarchy, tidy text, no overflow, no crowding. Premium type, refined Chinese typography. Visual focus on the product while still informing. No cheap promo feel, no gaudiness, no muddy colors, no watermark.

[LAYOUT — stacked modules top to bottom like a full detail page]

1. Hero module
- Left side: main title and selling copy. Right side: product hero image.
- Main title: [main title]. Subtitle: [subtitle]. Top small text: [top small text]. Body: [hero copy].
- Right side: a premium [product render], like a pro studio shot. Pure white background, soft studio light from the left, soft natural shadow on the right, sharp focus, 8K quality.

2. Feature icon module
- 4 premium minimal linear icons paired with short copy, tidy layout, icons in champagne gold (or echoing the palette).
- Four points: [four feature points].

3. Detail close-up module
- 3 detail close-up thumbnails in a row, each with a title and short note below.
- Three close-ups: [three detail close-ups].

4. Lifestyle scene module
- Bottom: a lifestyle scene module, copy on the left, product standing on the right.
- Main title: [scene module title], subtitle: [scene module subtitle], body: [scene module copy].
- Below it, 3 small icons with text: [three scene tags].
- Right side: a minimal premium lifestyle space — light-color table, soft window background, product standing upright, clean premium mood.

5. Trust badge module
- Bottom: 3 horizontal trust badges with small icons: [three trust badges].

[GOAL]
Like a high-end flagship-store detail page combining hero + feature + detail + scene + trust — one page that fully explains the product. Serializable for other products.`,
    imageStorageKey: 'ecommerce-detail-page.jpg',
    sortOrder: 7,
  },
  {
    slug: 'ecommercePromoPoster',
    titleZh: '电商促销海报',
    titleEn: 'E-commerce promo poster',
    promptZh: `请根据以下用户输入，生成一张高级感很强的电商促销海报，构图居中，比例 16:9，适合电商首页 banner。

【用户输入】
主促销数字文字：【填写促销字，例如5折 / 7折 / 立减300 / 双11】
立体字材质：【填写材质，例如象牙白/香槟白+鎏金描边 / 深红鎏金 / 黑金质感 / 玫瑰金】
铭牌文字：【填写短标语，例如限时3天 / 仅此一次 / 新品首发】
铭牌样式：【例如深红色搭配金边 / 黑金 / 墨绿金边】
背景配色：【填写配色，例如深红+酒红+黑红渐变 / 深蓝+午夜蓝 / 墨绿+黑金 / 紫黑+金紫】
画幅比例：【16:9 / 1:1 / 9:16 等】

【整体风格】
高端品牌促销视觉、轻奢、电商大促主 KV、官方海报质感。
画面精致、克制、贵气，强调高级、精致、有冲击力，但不过度花哨。
不要廉价火焰爆炸感，不要俗气背景，不要卡通感，不要低端火焰，不要闪电，不要廉价特效，不要杂乱装饰。

【主视觉】
海报中央是超大号立体促销数字文字【主促销数字文字】，字体为高级 3D 立体字。
主体是【立体字材质】，有明显但干净的立体厚度、柔和阴影、金属反光，看起来像高端商业广告。

【铭牌】
下方放一个精致的小型高级铭牌，写着【铭牌文字】，文字为金色，铭牌为【铭牌样式】。

【背景与装饰】
背景采用【背景配色】的高级空间感设计，可以有柔和光晕、暗纹渐变、细微粒子、优雅环形光线、轻微体积光，整体干净利落、层次分明，不杂乱。
画面两侧和边缘可加入少量金属线条、微光装饰、轻奢框线，增强质感。

【最终目标】
构图居中，重点突出【主促销数字文字】，一张高级感拉满的电商促销海报，像高端品牌官方活动主视觉，可替换不同促销主题继续创作。`,
    promptEn: `Generate a highly premium e-commerce promotional poster, centered composition, 16:9, fit for an e-commerce homepage banner.

[USER INPUT]
Main promo text: [fill in, e.g. 50% OFF / 30% OFF / $300 Off / Double 11]
3D text material: [fill in, e.g. ivory / champagne white + gilded gold outline / deep red gold leaf / black-gold / rose gold]
Plaque text: [fill in a short line, e.g. 3 Days Only / One Time Only / New Launch]
Plaque style: [e.g. deep red with gold border / black-gold / ink-green gold border]
Background palette: [fill in, e.g. deep red + wine red + black-red gradient / deep blue + midnight blue / ink green + black-gold / purple-black + gold-purple]
Aspect ratio: [16:9 / 1:1 / 9:16, etc.]

[OVERALL STYLE]
High-end brand promotional visual, quietly luxurious, big-sale main KV, official-poster quality. Refined, restrained, opulent — premium, polished, impactful, but not gaudy. No cheap fire / explosion feel, no tacky background, no cartoon look, no low-end flames, no lightning, no cheap effects, no clutter.

[MAIN VISUAL]
At the center, an oversized 3D promo text [main promo text] in a premium 3D typeface. Body in [3D text material], with clean but clear depth, soft shadow, metallic reflection — like a high-end commercial ad.

[PLAQUE]
Below it, a refined small premium plaque reading [plaque text] in gold, plaque in [plaque style].

[BACKGROUND & DECOR]
Background: a premium spatial design in [background palette] — soft halos, dark-pattern gradients, fine particles, elegant ring lights, slight volumetric light. Clean, crisp, layered, not cluttered. Along the sides and edges, a few metal lines, faint-glow trims, and light-luxury frame lines may enhance the texture.

[GOAL]
Centered composition, spotlight on [main promo text]. A premium-feel e-commerce promo poster like a high-end brand's official event main visual. Serializable for other promo themes.`,
    imageStorageKey: 'ecommerce-promo-poster.jpg',
    sortOrder: 8,
  },
  {
    slug: 'pptMindMap',
    titleZh: 'PPT 信息导图',
    titleEn: 'PPT information mind map',
    promptZh: `请根据我提供的主题和原文内容，自动生成一张【高级竖版 PPT 信息导图】。

你不需要逐字照搬原文，而是要帮我自动提炼重点、归纳结构、拆分模块，并设计成一张适合讲解的高颜值 PPT 导图。

【用户输入】
主题：【在这里填写你的主题】
原文内容：【在这里粘贴你的文章、课程大纲、产品介绍、项目说明或任意内容】

【生成要求】
1. 自动理解主题
根据我提供的内容，自动判断这张图最适合做成：知识导图 / 平台合集 / 方法论拆解 / 产品介绍 / 流程说明 / 对比分析 / 教程步骤 / 活动说明 / 课程封面。选择最适合的导图结构，不要机械套模板。

2. 自动提炼模块
从原文中自动提炼 6-10 个核心模块。每个模块需要包含：简短标题、一句话说明、对应图标或视觉符号。
如果内容里出现平台、品牌、工具、软件、社交媒体、电商平台，请自动配上对应 LOGO 或高度相似的识别图标。例如：X、小红书、微信、公众号、PPT、电商、AI 工具、社交平台等。

3. 版式要求
做成竖版 PPT 信息导图，比例 3:4 或 4:5。顶部是大标题和副标题。中间是核心模块卡片区。底部是总结区或亮点区。
整体要像一页专业课程 PPT、知识付费封面、AI 工具教程封面、公众号长图封面，让人一眼看出这张图在讲什么。

4. 视觉风格
高级、精美、现代、干净、有设计感。参考 2026 年流行的 AI SaaS 官网、Keynote 发布会、知识付费课程封面、高级信息图风格。
使用：浅色高级背景、蓝紫渐变光感、玻璃拟态卡片、圆角模块、柔和阴影、精致图标、统一色彩体系、清晰层级排版。
不要廉价感，不要杂乱，不要像普通海报，不要文字堆满。

5. 文字要求
中文排版必须清晰。所有文字不能出框、不能重叠、不能裁切、不能变形。每个模块文字尽量短，适合 PPT 展示。标题要醒目，说明文字要简洁。不要生成大段文章。

6. 底部总结
请根据原文自动生成一句有总结力的金句，放在底部。这句话要简洁、有传播感，适合做课程封面或文章配图。

7. 画质要求
高清、精致、8K 质感、商业级 PPT 视觉。整体图文并茂，信息清楚，视觉高级。`,
    promptEn: `Generate a premium vertical PPT information mind map from the topic and source text I provide.

Do not copy the source verbatim — distill the key points, structure, and modules yourself, and design it into a high-quality PPT-style mind map fit for presenting.

[USER INPUT]
Topic: [fill in your topic here]
Source content: [paste your article, course outline, product intro, project brief, or any content here]

[REQUIREMENTS]
1. Understand the topic automatically
From the content, decide what this map is best made into: knowledge map / platform collection / methodology breakdown / product intro / process flow / comparison / tutorial steps / event brief / course cover. Pick the best structure — do not mechanically apply a template.

2. Distill modules automatically
Extract 6-10 core modules from the source. Each module needs: a short title, a one-line note, and a matching icon or visual symbol. If platforms, brands, tools, software, social media, or e-commerce platforms appear, auto-place the corresponding LOGO or a highly similar recognizable icon — e.g. X, RED, WeChat, Official Account, PPT, e-commerce, AI tools, social platforms.

3. Layout
Vertical PPT information mind map, 3:4 or 4:5. Title and subtitle at the top. Core module cards in the middle. A summary or highlight area at the bottom. It should look like one page of a professional course PPT, a paid-knowledge cover, an AI-tool tutorial cover, or a long Official Account cover — readable at a glance.

4. Visual style
Premium, refined, modern, clean, designed. Reference 2026's trendy AI SaaS sites, Keynote keynotes, paid-knowledge course covers, high-end infographics. Use a light premium background, blue-purple gradient glow, glassmorphism cards, rounded modules, soft shadows, refined icons, a unified color system, clear hierarchy. No cheap feel, no clutter, no ordinary-poster look, no text-packed blocks.

5. Text
Chinese typesetting must be crisp. No text may overflow, overlap, be cut, or distort. Keep each module's text short, fit for PPT. Titles prominent, notes concise. No long paragraphs.

6. Bottom summary
From the source, auto-generate one punchy summary line for the bottom. Short, shareable, fit for a course cover or article illustration.

7. Quality
High-res, refined, 8K feel, commercial-grade PPT visual. Text and image together, information clear, premium look.`,
    imageStorageKey: 'ppt-mind-map.jpg',
    sortOrder: 9,
  },
  {
    slug: 'tutorialSteps',
    titleZh: '分步骤图解教程',
    titleEn: 'Step-by-step tutorial',
    promptZh: `请根据以下用户输入，生成一张现代扁平化教程步骤信息图，比例 16:9，像软件帮助中心/说明文档里的教程图。

【用户输入】
顶部教程图标：【填写图标，例如绿色书本 / 蓝色齿轮 / 橙色灯泡】
大标题：【填写标题，例如使用教程 / 快速上手 / 新手指引】
副标题小字：【填写一行小字，例如只需四步，轻松完成操作】
主色调：【填写主色，例如绿色 / 蓝色 / 橙色】
背景色：【填写背景，例如浅灰色 / 米白 / 浅蓝】
文字色：【例如深灰色 / 深蓝】
步骤数量：【填写数字，例如4 / 3 / 5】
各步骤内容：【填写每步"图标 + 主标题 + 小字"，例如下载图标：下载：下载应用】
步骤连接方式：【例如弯曲箭头 / 直线箭头 / 虚线连接】
底部提示条图标：【例如绿色盾牌勾选 / 蓝色信息圈】
底部提示条文字：【例如请按以上步骤依次操作，确保数据安全与操作成功】

【整体风格】
浅灰色（或【背景色】）干净背景，简洁、专业、清晰，像软件帮助中心/说明文档里的教程图。
纯几何矢量感，扁平化设计，教程说明风格，UI 帮助文档风格，干净留白。
【主色调】为主色，【文字色】文字，图标线条清晰统一。
不要写实纹理，不要 3D，不要复杂装饰，不要水印。

【画面布局】
顶部居中放一个小的【顶部教程图标】，旁边写大标题【大标题】，下方一行小字【副标题小字】。

画面中间横向排列【步骤数量】个白色圆角卡片，每个卡片顶部有一个【主色调】圆形编号徽章，里面是白色数字：1、2、3……
各步骤从左到右排列，步骤之间用【步骤连接方式】连接。
每个卡片内部包含一个浅【主色调】圆形底和一个极简 2D 图标：
各步骤内容依次填入。

卡片底部有一条细【主色调】强调线。

底部居中放一个浅【主色调】提示条，左边是【底部提示条图标】，文字写【底部提示条文字】。

【最终目标】
一张干净、专业、扁平化的教程步骤信息图，像软件帮助文档里的标准教程图，可替换不同步骤主题继续创作。`,
    promptEn: `Generate a modern flat-style step-by-step tutorial infographic, 16:9, like an illustration from a software help center / documentation page.

[USER INPUT]
Top tutorial icon: [fill in, e.g. green book / blue gear / orange lightbulb]
Main title: [fill in, e.g. User Guide / Quick Start / Beginner's Guide]
Subtitle small text: [fill in one line, e.g. Four steps to finish with ease]
Primary color: [fill in, e.g. green / blue / orange]
Background color: [fill in, e.g. light gray / cream / light blue]
Text color: [e.g. dark gray / dark blue]
Step count: [fill in a number, e.g. 4 / 3 / 5]
Per-step content: [fill in each step's "icon + title + small text", e.g. download icon: Download: Download the app]
Step connector: [e.g. curved arrow / straight arrow / dashed line]
Bottom tip bar icon: [e.g. green shield check / blue info circle]
Bottom tip bar text: [e.g. Follow the steps above in order to ensure data safety and a successful operation]

[OVERALL STYLE]
Light-gray (or [background color]) clean background — simple, professional, clear, like an illustration from a software help center / documentation page. Pure geometric vector feel, flat design, tutorial-instruction style, UI help-doc style, clean whitespace. [primary color] as the main color, [text color] text, consistent icon line weight. No realistic textures, no 3D, no complex decoration, no watermark.

[LAYOUT]
Top center: a small [top tutorial icon] beside the main title [main title], with one line of small text [subtitle small text] below.

Middle: [step count] white rounded cards arranged horizontally, each topped with a [primary color] circular numbered badge holding a white number: 1, 2, 3...
Steps run left to right, connected by [step connector].
Each card holds a light-[primary color] circular backdrop and a minimal 2D icon; fill in the [per-step content] in order.

A thin [primary color] accent line runs along the bottom of each card.

Bottom center: a light-[primary color] tip bar with [bottom tip bar icon] on the left and text [bottom tip bar text].

[GOAL]
A clean, professional, flat tutorial step infographic like a standard help-doc tutorial image. Serializable for other step topics.`,
    imageStorageKey: 'tutorial-steps.jpg',
    sortOrder: 10,
  },
  {
    slug: 'mindMap',
    titleZh: '思维导图与知识图谱',
    titleEn: 'Mind map & knowledge graph',
    promptZh: `请根据以下用户输入，生成一张思维导图信息图，教育海报风格，清晰、有条理、有色彩区分，比例 16:9。

【用户输入】
中心节点主题：【填写中心主题，例如 Web3生态 / 人工智能 / 营销方法论】
主分支数量：【填写数量，例如5 / 4 / 6】
各主分支：【填写每个分支"颜色 + 主题"，例如蓝色代表 DeFi / 绿色代表 NFT】
每分支子节点：【填写每个主分支下2-3个小节点，带小图标】
背景色：【例如白色 / 浅灰 / 米白】
连接线风格：【例如略带手绘感不完全笔直 / 工整直线 / 流畅曲线】

【画面要求】
【背景色】背景。
中心节点写着【中心节点主题】，有【主分支数量】个主分支向外辐射。
各主分支依次用对应颜色代表对应主题：【各主分支】。
每个主分支下有2-3个小节点，带有小图标：【每分支子节点】。
连接线【连接线风格】。
教育海报风格，清晰、有条理、有色彩区分。

【最终目标】
一张中心辐射、色彩分明、清晰有层次的思维导图信息图，像教育海报，可替换不同主题继续创作。`,
    promptEn: `Generate a mind-map infographic, educational-poster style — clear, orderly, color-coded, 16:9.

[USER INPUT]
Central node topic: [fill in, e.g. Web3 Ecosystem / AI / Marketing Methodology]
Branch count: [fill in, e.g. 5 / 4 / 6]
Branches: [fill in each branch's "color + topic", e.g. blue for DeFi / green for NFT]
Sub-nodes per branch: [fill in 2-3 small nodes per branch, with small icons]
Background: [e.g. white / light gray / cream]
Connector style: [e.g. slightly hand-drawn, not perfectly straight / clean straight lines / smooth curves]

[IMAGE]
[background] background. A central node reading [central node topic] radiates [branch count] main branches. Each branch represents its topic in its color: [branches]. Each main branch has 2-3 small sub-nodes with small icons: [sub-nodes per branch]. Connectors are [connector style]. Educational-poster style — clear, orderly, color-coded.

[GOAL]
A radial, color-coded, clear and layered mind-map infographic like an educational poster. Serializable for other topics.`,
    imageStorageKey: 'mind-map.jpg',
    sortOrder: 11,
  },
];

function contentTypeFor(name: string): string {
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

async function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    logger.log(`Bucket ${bucket} already exists`);
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    logger.log(`Created bucket ${bucket}`);
  }

  // 匿名只读策略(允许前端公开拉取模板示例图)
  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: '*',
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  };
  try {
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify(policy),
      })
    );
    logger.log(`Anonymous read policy set on ${bucket}`);
  } catch (err) {
    // 非 MinIO 后端可能不支持匿名策略,不阻塞
    logger.warn(`Bucket policy set skipped: ${(err as Error).message}`);
  }

  // CORS 配置(浏览器跨域拉取示例图必须)
  const corsRules = {
    CORSRules: [
      {
        AllowedOrigins: ['*'],
        AllowedMethods: ['GET', 'HEAD'],
        AllowedHeaders: ['*'],
        ExposeHeaders: [
          'Content-Length',
          'Content-Type',
          'ETag',
          'Cache-Control',
        ],
        MaxAgeSeconds: 86400,
      },
    ],
  };
  try {
    await client.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: corsRules,
      })
    );
    logger.log(`CORS rules set on ${bucket}`);
  } catch (err) {
    logger.warn(`CORS config set skipped: ${(err as Error).message}`);
  }
}

async function uploadImages(
  client: S3Client,
  bucket: string,
  presetsDir: string
): Promise<void> {
  for (const preset of BUILTIN_PRESETS) {
    if (!preset.imageStorageKey) continue;
    const localPath = path.join(presetsDir, preset.imageStorageKey);
    let body: Buffer;
    try {
      body = await readFile(localPath);
    } catch (err) {
      logger.warn(
        `Image ${preset.imageStorageKey} not readable at ${localPath}: ${(err as Error).message} — skipping upload`
      );
      continue;
    }
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: preset.imageStorageKey,
        Body: body,
        ContentType: contentTypeFor(preset.imageStorageKey),
        CacheControl: CACHE_CONTROL,
      })
    );
    logger.log(
      `Synced ${preset.imageStorageKey} (${body.length} bytes) to ${bucket}`
    );
  }
}

async function upsertPresets(databaseUrl: string): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    for (const preset of BUILTIN_PRESETS) {
      await db
        .insert(imageGeneratePresets)
        .values({
          slug: preset.slug,
          titleZh: preset.titleZh,
          titleEn: preset.titleEn,
          promptZh: preset.promptZh,
          promptEn: preset.promptEn,
          imageStorageKey: preset.imageStorageKey,
          sortOrder: preset.sortOrder,
          isBuiltin: true,
        })
        .onConflictDoUpdate({
          target: imageGeneratePresets.slug,
          set: {
            titleZh: preset.titleZh,
            titleEn: preset.titleEn,
            promptZh: preset.promptZh,
            promptEn: preset.promptEn,
            imageStorageKey: preset.imageStorageKey,
            sortOrder: preset.sortOrder,
            isBuiltin: true,
            updatedAt: sql`now()`,
            // 注意:刻意不刷新 is_enabled —— 后台将来禁用的内置模板在 re-seed 后仍保持禁用。
          },
        });
      logger.log(`Upserted preset ${preset.slug}`);
    }

    // 校验:确保 12 条内置模板都在库
    const rows = await db
      .select({ slug: imageGeneratePresets.slug })
      .from(imageGeneratePresets)
      .where(eq(imageGeneratePresets.isBuiltin, true));
    logger.log(`DB seed complete: ${rows.length} builtin presets present`);
  } finally {
    await client.end();
  }
}

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  const region = process.env.S3_REGION ?? 'us-east-1';
  const bucket = process.env.S3_PRESETS_BUCKET ?? 'presets';

  // DB seed(独立于 S3:即使 MinIO 没配,模板文案也能下发,只是没有示例图)
  if (!databaseUrl) {
    logger.warn('DATABASE_URL not set, skipping DB seed');
  } else {
    try {
      await upsertPresets(databaseUrl);
    } catch (err) {
      logger.error(`DB seed failed: ${(err as Error).message}`);
      // 不阻塞:下次重启重试
    }
  }

  // S3 示例图同步
  if (!endpoint) {
    logger.warn('S3_ENDPOINT not set, skipping image sync');
    return 0;
  }

  const client = new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId: accessKey || 'minioadmin',
      secretAccessKey: secretKey || 'minioadmin',
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });

  try {
    await ensureBucket(client, bucket);
    const presetsDir = await resolvePresetsDir();
    if (!presetsDir) {
      logger.warn(
        'Presets image dir not found (set IMAGE_GENERATE_PRESETS_DIR), skipping image sync'
      );
      return 0;
    }
    logger.log(`Syncing preset images from ${presetsDir}`);
    await uploadImages(client, bucket, presetsDir);
    logger.log(`Image sync complete: ${BUILTIN_PRESETS.length} presets`);
    return 0;
  } catch (err) {
    logger.error(`Image sync failed: ${(err as Error).message}`);
    return 0; // 不阻塞启动
  }
}

main()
  .then(code => process.exit(code))
  .catch(() => process.exit(0));
