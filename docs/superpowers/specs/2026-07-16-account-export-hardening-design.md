# 账号导出加固设计

## 背景

任务 5 已实现大账号分页导出、私有 JSONL
spool、SQLite 路径去重和 ZIP 流式写出。全新质量审查发现以下边界仍需加固：PostgreSQL 微秒时间戳在 JS
`Date`
游标中丢失精度、预检阶段无法响应客户端断连、ZIP 文件名不完全兼容 Windows、写阶段初始化未全部纳入即时清理，以及测试进程共享系统临时目录。

本设计继续遵守已确认范围：不新增遥测，不改变匿名访问令牌或
`/tasks/:id/status`，不修改生产端口、默认凭据或匿名桶策略，也不增加用户级或全局并发配额。

## 游标精度

Repository 保持 `(createdAt, id)` keyset 排序和每页 250 行，但额外选择 `created_at::text`
作为仅供分页使用的私有游标字段。下一页条件将该字符串参数显式转换回 PostgreSQL
`timestamp`，避免 Drizzle 的 date 模式经过 `new Date()` 和 `toISOString()` 时把微秒截断为毫秒。

生成器对外继续返回原有任务/文件类型，不暴露私有游标字段。任务和文件使用同一实现模式，保持 `userId`
与 `snapshotAt` 过滤不变，也不引入 schema migration。相较 timestamp(3)
migration，此方案不改写历史数据；相较纯 UUID 排序，此方案继续利用现有 `(userId, createdAt)`
索引和稳定顺序。

## 预检取消

Controller 在调用 `prepareExport` 前监听响应 `close`。若响应尚未完成就关闭，则中止一个请求级
`AbortController`。信号依次传给 `prepareExport`、Repository 迭代器、spool 编排和
`MinioService.head`。

Repository 在每次查询前后检查信号；spool 在每次写入和对象 HEAD 前后检查信号；S3 SDK 通过
`abortSignal` 取消正在等待的
`HeadObject`。任何阶段中止都进入已有的句柄、SQLite 和目录清理路径。Controller 在退出时移除监听器，写出阶段仍由现有流事件负责取消。

不增加并发配额。公开公测文档已经把每日任务和并发配额列为本次范围外；本轮通过及时取消断连请求减少无效资源消耗，现有请求限流继续生效。

## ZIP 路径

归档路径只保留文件 basename，并执行以下规范化：

- 移除 C0/C1 控制字符，将 Windows 非法字符 `< > : " / \\ | ? *` 替换为下划线。
- 去除尾随点和空格；空名称回退到文件 ID。
- 对 `CON`、`PRN`、`AUX`、`NUL`、`COM1` 到 `COM9`、`LPT1` 到 `LPT9` 等设备名增加前缀。
- 限制单个文件名长度，保留可识别扩展名，并为冲突后缀预留空间。
- SQLite registry 存储经过 Unicode 规范化并转小写的碰撞键，实际 ZIP 路径仍保留安全的显示大小写。

因此 `Report.pdf` 与 `report.pdf`
会稳定获得不同导出路径，且 Windows 解压不会因设备名、非法字符或尾随点空格拒绝文件。

## 生命周期与测试隔离

`writeExport` 最外层始终拥有 prepared spool。ZIP 构造、监听器注册、`finished(output)`
初始化和实际写出全部位于该层的 `try/finally`
内；即使初始化同步失败，也立即删除 spool。若写出错误与清理错误同时发生，使用带 `cause`
的聚合错误保留原始失败。

`AccountExportService`
支持可选的临时根目录注入，生产默认使用系统临时目录。导出测试为每个测试文件创建唯一临时根目录，启动清理和 spool 扫描只在该目录内进行；`process.kill`
mock 不再影响其他测试进程。

## 验收

- 微秒时间戳跨越 250 行页边界时，不重复、不遗漏、能终止。
- 预检期间客户端断连会停止后续分页和 HEAD，并恢复临时目录基线。
- Windows 不兼容名称、大小写冲突和超长名称得到稳定且唯一的 ZIP 路径。
- ZIP 初始化同步失败时 prepared spool 仍立即删除。
- 两个导出测试进程并行运行不会互相删除临时目录。
- 聚焦测试、API/Web/packages 全量测试、Lint、API/Web build、OpenAPI 漂移检查全部通过。
