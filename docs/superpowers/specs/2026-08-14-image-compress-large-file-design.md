# 图片压缩套餐额度与大文件提示设计

## 背景

图片压缩页当前将上传区的 `maxSize` 固定为 50 MB。超过该值的图片会被 `react-dropzone`
直接拒绝，并显示未经本地化的 `File is larger than 52428800 bytes`。固定值既不能反映游客的 10
MB 额度，也不能让 Pro、Team、Private 等账号使用更高额度。

共享权益目前定义游客 10 MB、普通登录 50 MB、Pro 100 MB、Team 150 MB、Private 250 MB。显式
`plan: pro_preview` 的免费公测账号需要按顶额会员处理，但当前仍使用普通登录额度。

## 目标

- 图片压缩的本地和服务端处理使用同一个账号单文件额度。
- 游客为 10 MB，普通登录为 50 MB，Pro 为 100 MB，Team 为 150 MB，Private 为 250 MB。
- 只有显式 `plan: pro_preview` 的账号按顶额会员处理；普通 `plan: free` 登录账号仍为 50 MB。
- `pro_preview` 在全部共享权益限制中与 `private` 对齐，而不是只提高图片压缩额度。
- 文件超过当前额度时在选择阶段拒绝，并显示中英文可读提示，不再暴露原始字节错误。

## 方案

### 共享权益

保留 `pro_preview` 计划标识，避免影响账号展示和未来公测管理；将它的计划等级和 `LIMITS`
中的全部限制值对齐 `private`。普通登录账号仍通过 `signed_in` 使用原有额度。

API 传输层最高 250 MB 和业务层套餐校验保持不变。服务端继续从数据库用户的 `plan`、`role` 计算额度。

### 图片压缩页

页面根据当前会话用户的 `id`、`plan`、`role` 调用共享 `getLimit(..., 'upload.maxFileSize')`。得到的
`maxFileSize` 直接传给 `FileDropzone`，因此文件在进入本地或服务端流程前就遵守同一额度。

处理开始前再次检查现有文件，防止会话退出、套餐降级或状态变化后继续处理超过新额度的文件。现有“小于 5
MB推荐本地，否则推荐服务端”的规则不变，处理方式不再改变容量额度。

### 错误文案

`FileDropzone` 将格式化后的容量交给中英文消息模板，并把 `react-dropzone` 的 `file-too-large`
错误映射为本地化提示。图片压缩页格式提示只列支持格式，当前账号容量由上传控件动态展示。

## 影响范围

- `packages/utils`：`pro_preview` 对齐顶额会员的等级与全部限制。
- 图片压缩页：从真实会话计算本地和服务端共同额度，并增加处理前防御校验。
- `FileDropzone`：本地化容量标签和文件过大错误。
- 中英文 messages：动态容量和图片压缩超额提示。
- README 与 `PROJECT_SPECS.md`：记录套餐额度和公测预览规则。

## 测试

- 断言 `pro_preview` 与 `private` 的全部共享限制一致，并具备相同计划等级。
- 断言图片压缩对游客、普通登录、Pro Preview、Pro、Team、Private 返回正确额度。
- 断言图片压缩页把动态额度传给上传控件，不再固定 50 MB。
- 断言 `FileDropzone` 的中英文错误不包含原始字节报错。
- 运行 packages 与 Web 聚焦测试、Web 全量测试、格式检查和生产构建。

## 非目标

- 不把普通 `plan: free` 登录账号自动升级为 `pro_preview`。
- 不提高 Pro、Team、Private 的既有额度。
- 不修改 API 最高 250 MB 的传输层限制。
- 不保证额度内的所有图片都能在任意设备成功解码；浏览器内存和图片像素尺寸仍是运行时限制。
