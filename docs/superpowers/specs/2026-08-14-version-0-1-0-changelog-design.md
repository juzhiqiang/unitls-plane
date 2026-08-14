# v0.1.0 版本统一与更新日志设计

## 背景

当前 workspace 中根包、Web、API 和共享包的版本号不一致，认证页还硬编码显示 `v1.0.0`。产品已经进入首个可对外说明的免费公测版本，需要统一发布标识，并为用户提供持续可读的更新记录。

## 目标

1. 根包、`apps/*` 和 `packages/*` 的 package 版本统一为 `0.1.0`，用户界面统一显示 `v0.1.0`。
2. 新增双语公开更新日志页，首版记录当前公测已交付的用户可感知能力。
3. 在营销页脚提供“更新日志”入口，在登录/注册页现有版本号处提供可点击入口。
4. 后续版本只需新增一条精选日志内容，不依赖读取或暴露 Git 提交历史。

## 非目标

- 不把所有 Git commit、内部重构、测试调整或部署细节直接展示给用户。
- 不增加数据库表、API 接口或后台编辑器；首期日志随前端代码发布。
- 不改变现有工具、套餐额度或认证流程。

## 页面与交互

更新日志位于 `/{locale}/changelog`，沿用营销页的头部、页脚、背景和排版令牌。主体采用纵向版本时间线：

- 页面标题和简短说明位于内容顶部，明确这是面向用户的版本记录。
- 每个版本是一个语义化的 `article`，显示版本标签、发布日期、版本标题和摘要。
- 变更按“新功能 / 改进 / 修复”分组，每组使用短列表，便于扫描。
- 最新版本排在最前面；暂时只有 `v0.1.0`，后续版本按相同结构向下追加。
- 桌面端使用日期与版本信息侧栏、变更内容主列；移动端折叠为单列，不能出现横向溢出。
- 页脚新增本地化“更新日志”链接。
- 认证页左侧状态区的 `v0.1.0` 使用本地化导航 `Link` 跳转到更新日志，移动端不新增额外控件。

## 内容与本地化

更新日志内容放入 `apps/web/messages/zh.json` 和 `apps/web/messages/en.json` 的 `PublicSite.changelog` 命名空间。数组使用 `t.raw` 读取，字段固定为：

```text
metadata.title
metadata.description
title
intro
entries[].version
entries[].date
entries[].title
entries[].summary
entries[].groups[].title
entries[].groups[].items[]
```

`zh` 文案面向中文用户，`en` 文案保持自然英文；版本号和日期在两个语言中保持同一发布事实。首版内容覆盖：本地图片/PDF/字体/文档工具、服务器任务与账号文件、任务历史与数据导出、套餐额度策略、图片压缩默认尺寸/完整对比/GIF/APNG 修复和公测边界说明。

## 版本来源

新增 `packages/utils/src/release.ts`，导出 `APP_VERSION = '0.1.0'` 和 `APP_VERSION_LABEL = 'v0.1.0'`。Web 认证页从共享包读取展示值，避免继续硬编码。package manifest 仍保留标准的 `version: "0.1.0"`，并通过测试锁定所有 workspace manifest 一致。

## 路由与 SEO

更新日志页实现与隐私、条款、公测说明一致的 `generateMetadata`：提供本地化 title/description、canonical、语言 alternate 和 Open Graph 基础字段。`sitemap` 与 `robots` 的公开路由列表同步加入 `changelog`；页面无需认证即可访问。

## 验证

- 新增页面结构测试，确认中英文页面均包含版本、日期、分组标题、变更条目和 canonical 配置。
- 新增版本一致性测试，扫描根包、`apps/*`、`packages/*` 的 manifest 均为 `0.1.0`，共享版本标签为 `v0.1.0`。
- 更新营销页脚测试和认证页测试，确认两个入口存在且链接到 `/changelog`。
- 运行 Web 全量单元测试（排除 Playwright E2E 文件）、格式检查、构建和版本验证脚本。
