# SkillForge 平台对接要点

> 来源：`tda-app-skillforge` 技能仓库（SKILL.md、templates/frontend、scripts/publish.py），读取于 2026-09-03。
> 只记录与 Dither Studio 有关的约束。二期发布时以平台当时的文档为准，本文档用于指导一期的工程结构。

## 1. 应用形态

- 一个应用就是一个目录：`manifest.yaml`，加可选的 `backend/`（FastAPI，Python 3.11）、`agent/`（SKILL.md）、`frontend/`（Vite）。三个模块都可以单独关闭。
- 前端是独立的整页应用，不是嵌进平台 React 树的组件。构建产物由平台的 Nginx 托管在 `/skillforge/apps/{name}/static/`。
- 平台的前端模板是 React 18 + Vite 5 + TypeScript，与我们的选型一致。
- React Flow 是平台自身的技术栈，与应用无关。我们不需要做组件级嵌入兼容，需要的是一个"平台入口"构建目标。
- 应用名规则：小写字母、数字、连字符。`dither-studio` 符合。

## 2. 前端硬性要求

- `vite.config` 的 `base` 必须是 `/skillforge/apps/{name}/static/`。
- 身份：首屏从 URL 参数 `?X-User-Id=工号` 读取并存入 `sessionStorage`。没有这个参数必须显示认证失败页，不允许匿名降级。
- 所有对平台或后端的请求必须带 `X-User-Id` 请求头。平台模板提供了 `apiFetch` 封装，裸 `fetch` 刷新后会 401。
- 前端没有环境变量，敏感信息只能在后端读取。
- 发布脚本在本地执行 `npm install` 和 `npm run build`，要求 `frontend/dist/` 有产物。构建命令和输出目录可在 manifest 配置。

## 3. 可以直接从前端调用的平台能力

不需要自建后端就能用的三项，都要带 `X-User-Id` 请求头：

| 能力 | manifest 开关 | 接口 | Dither Studio 的用途 |
|---|---|---|---|
| 用户数据 KV | `user_data.enabled` | `{前缀}/platform/apps/{name}/user-data`，GET / PUT / DELETE，按应用、用户、key 隔离，存 MySQL | 用户预设、全局设置 |
| 用户文件 | `user_files.enabled` | `{前缀}/platform/apps/{name}/user-files`，上传 / 下载 / 列表 / 软删除。`scope=user` 私有，`scope=shared` 公共。存阿里云 OSS，只写不删 | 源素材、导出产物 |
| AI 对话 | `agent.enabled` | SSE 流，前端走 `/skillforge/agent/chat/stream`。Body 为 message、session_id、force_agent。session_id 必须唯一 | 二期"描述风格生成预设"等 |

补充：

- 共享文件有免鉴权直链 `/skillforge/apps/{name}/shared/{path}`。音视频会 302 到 OSS 预签名地址，支持 Range 拖动。
- 私有文件在页面里展示需要先用 `apiFetch` 取 blob 再赋给 `<img>`，因为原生标签不能带自定义请求头。
- 对外公开 API 只有后端才能声明，与前端无关。

## 4. 限制与注意

- 上传请求体上限：Nginx 50MB，平台代理另有上限，取两者小值。超出返回 413，后端看不到日志。视频源文件可能超限，需要前端先压缩或分片，二期评估。
- 单文件上限 `max_file_size_mb` 默认 100，可在 manifest 配置。
- 发布包 tar.gz 上限 100MB。打包脚本会打包整个应用目录，只排除 `node_modules`、`.git`、`.env*`、缓存目录等固定列表，不能自定义排除。Electron 的打包产物绝不能留在应用目录内。
- 发布和访问都要求工号在平台用户白名单中。
- 平台对后端做 `/health` 探活。我们如果没有后端则不涉及。

## 5. 对一期工程的具体要求

1. Vite 应用放在 `frontend/` 目录，与平台的应用布局一致。根目录留给 `manifest.yaml`（二期）、`electron/`、`docs/`。
2. `base` 通过环境变量 `VITE_BASE` 注入，三个构建目标：Electron 用 `./`，独立 web 用 `/`，平台用 `/skillforge/apps/dither-studio/static/`。
3. 入口拆分：`src/app/electron.tsx`、`src/app/web.tsx`。二期加 `src/app/platform.tsx`，负责 `X-User-Id` 引导、认证失败页、`apiFetch`，并构造 `Platform` 接口的平台实现。
4. `Platform` 接口的方法与平台能力一一对应：`storage` 对应 user-data，`files` 对应 user-files，`ai` 对应 agent chat。接口签名按此设计。
5. 资源体积要控制：字体、蓝噪声纹理等随包资源计入 100MB 上限。
6. Electron 构建输出放在 `release/` 并加入 `.gitignore`。二期发布前用打包脚本把 `manifest.yaml` 和 `frontend/` 复制到干净目录再执行发布，避免 Electron 产物和文档混入。
