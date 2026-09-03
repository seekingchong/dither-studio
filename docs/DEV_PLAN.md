# Dither Studio 开发计划

> 依据：`docs/PRD.md`、`docs/DESIGN.md`、`design-system/tokens.css`。
> 本文档是开发的唯一计划来源，每个里程碑完成后更新状态。

## 1. 目标与原则

- 产品形态：macOS 客户端。壳层只负责窗口和本地能力，界面与引擎全部是常规 web 前端代码。
- 未来同一份前端代码发布 web 端，因此壳层与前端之间只通过一个 `platform` 接口通信。
- 本地能力清单：打开文件、保存文件、读取文件、预设持久化、剪贴板写入、HEIC 转码、在 Finder 中显示。
- 样式只引用 `tokens.css` 的 `--tda-*` 变量，禁止裸色值、裸字号、裸圆角，零外部请求。

## 2. 技术选型

| 层 | 选择 | 理由 | 备选 |
|---|---|---|---|
| 壳层 | Electron | 内核是 Chromium，和 web 端表现一致；WebCodecs H.264 硬编码可用；打包工具成熟；沙盒里能安装并测试 | Tauri 2：包体小、WKWebView 原生解码 HEIC，但内核是 Safari，和 web 端有差异，且需要 Rust 工具链 |
| 构建 | Vite + TypeScript | 开发热更新快，产物同时给 Electron 和 web | |
| UI | 原生 DOM，不引框架 | 设计系统是 CSS 类，与 DOM 一一对应；参数面板由 schema 驱动，不需要框架的组件抽象；零依赖符合"零外部请求" | Preact |
| 引擎 | 纯 TypeScript，在 Web Worker 里运行 | 与 UI 完全解耦，可单测，不阻塞界面 | |
| GPU | WebGL 2 | 有序、半调、噪声、图案、特效、上采样这些逐像素独立的阶段走 GPU；误差扩散、曲线扫描、DBS 天生串行，只能 CPU | WebGPU 后续可加 |
| 视频解码 | `<video>` + `requestVideoFrameCallback`，WebCodecs `VideoDecoder` 备用 | 覆盖 mp4/webm/mov；GIF 动图用 `ImageDecoder` | |
| 视频编码 | WebCodecs `VideoEncoder`(avc1) + `mp4-muxer` | 硬件 H.264，`mp4-muxer` 是唯一需要引入的运行时第三方库，MIT 协议，约 30KB | |
| 测试 | vitest 跑引擎单测；Playwright + Chromium 截图验收 UI | 沙盒内可执行 | |
| 打包 | electron-builder 出 dmg | 需在你的 Mac 上执行 `npm run dist`，沙盒没有 macOS | |

## 3. 目录结构

```
dither-studio/
├─ electron/               主进程、preload（本地能力实现）
├─ src/
│  ├─ platform/            平台接口 + electron / web 两套实现
│  ├─ engine/              抖动引擎，纯函数，无 DOM
│  │  ├─ pipeline.ts       流水线编排
│  │  ├─ preprocess/       影调与预处理
│  │  ├─ dither/           算法族，每族一个文件，统一注册表
│  │  ├─ color/            灰度公式、调色板、Tint、Accent
│  │  ├─ render/           网格渲染：点形状、融合、间距、背景
│  │  ├─ effects/          后处理特效栈
│  │  ├─ gpu/              WebGL 路径
│  │  └─ worker.ts
│  ├─ params/              参数 schema，PRD 每个参数一条记录
│  ├─ state/               store、撤销重做、预设
│  ├─ ui/                  顶栏、参数面板、画布、导出、设置
│  └─ styles/              tokens.css + 组件类
├─ design-system/          设计系统原件
├─ docs/                   PRD、DESIGN、DEV_PLAN
└─ tests/                  引擎单测、UI 截图
```

## 4. 核心架构

### 4.1 平台接口

```ts
interface Platform {
  openMedia(): Promise<MediaFile[]>;            // 文件选择，含拖拽
  saveFile(bytes: Uint8Array, name: string): Promise<string | null>;
  readFile(path: string): Promise<Uint8Array>;
  storage: { get<T>(key): Promise<T | null>; set(key, value): Promise<void> };
  clipboard: { writeImage(png: Blob): Promise<void>; writeFile(path: string): Promise<void> };
  convertHeic?(bytes: Uint8Array): Promise<Uint8Array>;   // macOS 用 sips
  revealInFinder?(path: string): Promise<void>;
}
```

Electron 实现走 preload 的 `contextBridge`，web 实现走 File System Access API、`localStorage`、`navigator.clipboard`。前端代码只依赖这个接口。

### 4.2 引擎流水线

```
源帧 → 适配画布 (cover/contain/fill/原尺寸)
     → 像素化 (降采样倍率、方法、网格偏移)
     → 影调预处理 (自动、亮度、对比度、中间调/高光/阴影、饱和度、模糊、锐化、去噪、噪点、描边、反相)
     → 色彩空间 (按颜色模式：灰度公式 或 保留 RGB/CMYK 分通道)
     → 量化与抖动 (阈值 / 噪声 / 有序 / 半调 / 误差扩散 / 曲线 / 点扩散与 DBS / 图案)
     → 颜色映射 (单色 / 灰阶 / Tint / Palette / Channels，深度错配，Accent 层)
     → 网格渲染 (点融合、网点形状、网格间距、连线或网格点背景)
     → 特效栈 (扫描线 CRT、胶片颗粒、JPEG glitch、位移与像素排序、几何扭曲)
     → 输出 (最近邻上采样到画布或导出尺寸)
```

每个阶段是 `(buffer, params) => buffer` 的纯函数。Worker 收到参数后按阶段执行，参数没变的阶段复用缓存。

### 4.3 参数 schema

PRD 里的每个参数是一条记录：`{ id, group, label, type, min, max, step, default, options, visibleWhen }`。参数面板、预设序列化、撤销重做、自动调整全部从这张表推导。新增参数只加一条记录。

### 4.4 状态与渲染

- 单一 `params` 对象，不可变更新，订阅者是画布渲染器。
- 撤销栈存参数快照，滑块拖动过程合并成一次记录。快捷键 Cmd+Z / Shift+Cmd+Z。
- 渲染调度：参数变化后 16ms 内合并，取消上一次未完成的 Worker 任务。
- 多媒体坑位：`slots[]` 各自持有源媒体，共用同一套 `params`。1 个坑位单画布，4 个坑位 2×2 网格。

### 4.5 视频

- 预览：逐帧送入流水线，慢算法自动降到预览分辨率。
- 导出：按 60fps 时间线取帧，源视频帧率不足时重复帧，GIF 按各帧延时重采样。编码质量中、高、超高对应三档码率。

## 5. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 脚手架 | Electron + Vite + TS 工程；tokens.css 接入；platform 接口与两套实现；vitest 与 Playwright 配置；CI 脚本 | `npm run dev` 能起窗口，`npm test` 通过 |
| M1 端到端 MVP | 打开图片、拖拽；像素化；固定阈值、Bayer 4×4、Floyd–Steinberg 三个算法；1-bit 黑白；画布缩放档位；导出 PNG、复制 PNG；UI 骨架按 home 画板：顶栏、左参数面板、右预览 | Playwright 截图与设计稿比对；三个算法单测快照 |
| M2 算法全量 | 阈值 3、噪声 4、有序 13、半调 10、误差扩散 14 + 自定义核、曲线 4、点扩散与 DBS、图案 9，各族参数齐全 | 每个算法一个确定性输出快照测试 |
| M3 影调与像素化 | 预处理全部 12 项；降采样 4 种方法；网格偏移；像素尺寸按输入分辨率自适应默认 | 单测 + 截图 |
| M4 颜色系统 | 5 种颜色模式；灰阶级数；深度错配开关；13 组预设调色板；Tint 双色与色带；Accent 层全部参数 | 单测 + 截图 |
| M5 网格渲染 | 点融合 metaball；欧几里得、圆方、反向网点；横纵网格间距；连线背景、网格点背景 | 截图 |
| M6 特效栈 | 扫描线 CRT、胶片颗粒、JPEG glitch、块位移、行位移、像素排序、波形、桶形、散射；可堆叠、可排序 | 截图 |
| M7 视频与 GPU | 视频与 GIF 动图输入；逐帧预览；MP4 H.264 导出三档质量；WebGL 路径与 GPU 开关；HEIC 转码 | 导出文件可在 QuickTime 播放 |
| M8 预设与体验 | 内置预设 7 个起；用户预设保存、重命名、删除；撤销重做与快捷键；浅深主题；全局设置：坑位 1 或 4、GPU 开关；4 坑位预览 | 截图 + 预设持久化测试 |
| M9 发布 | electron-builder 打 dmg；web 构建目标；README | 你本机 `npm run dist` 出包并能打开 |

每个里程碑单独提交并推送到分支，M1 完成后你就能在本机跑起来看效果。

## 6. 需要你确认的事项

| # | 事项 | 我的建议 |
|---|---|---|
| 1 | 壳层用 Electron 还是 Tauri | Electron，理由见第 2 节 |
| 2 | 画布默认缩放。PRD 写 10%，1000×600 的 10% 只有 100×60 像素 | 保留 10/25/50/100 四档，另加"适应窗口"档作为默认 |
| 3 | 字体。设计规范说 Inter 和 Roboto Mono 是 macOS 自带，实际 macOS 只自带 PingFang SC 和 SF Pro | 把 Inter 与 Roboto Mono 字体文件随应用打包，都是 OFL 协议，不产生外部请求；web 端同样打包 |
| 4 | 深色主题。PRD 要浅深两套，设计规范只有浅色 | M8 通过覆盖 token 实现深色，色值我按墨色反转推导，你后续在 Figma 里校正 |
| 5 | HEIC 输入。Chromium 不原生解码 | macOS 上主进程调用系统 `sips` 转 PNG，零依赖；web 端后续补 wasm 解码库 |
| 6 | 一键复制 MP4。系统剪贴板不接受视频数据 | 复制为文件，可在 Finder 粘贴；web 端降级为下载 |
| 7 | GPU 加速范围。误差扩散、曲线扫描、DBS 无法并行 | 开关默认开，不适用的算法自动走 CPU，界面不报错 |
| 8 | DBS 与点扩散耗时秒级 | 仅静态图可用，视频模式下自动降到预览分辨率 |
| 9 | 有序矩阵数值。libdither 的非矩形、中心白点、对角，ImageMagick 的 c5×5 到 c7×7 | 按公开源码重建，不逐一核对 |
| 10 | 导出固定 60fps，源视频 24 或 30fps | 重复帧补齐，不做插帧 |
| 11 | 4 个坑位是否共用同一套参数 | 共用，PRD 描述的是同一效果同时预览 4 个媒体 |
| 12 | 内置预设的具体参数 | 我先定初版，你看效果后调 |

## 7. 风险

- 视频导出依赖 WebCodecs 的 H.264 编码。Electron 内置 Chromium 在 macOS 上有硬件编码，可行；web 端 Safari 支持有限，届时降级为 WebM。
- 性能。画布 1000×600、像素尺寸 1 时误差扩散约 60 万像素，单帧 20 到 40ms，可接受。4 坑位加视频加慢算法会卡，靠预览降分辨率兜底。
- 沙盒里无法执行 macOS 打包，M9 需要你本机执行并反馈。
- 设计稿目前只有 home 画板一页。弹窗、导出面板、设置页需要新的 Figma 画板，你给带 node-id 的链接我用 MCP 读取。

## 8. 状态

| 阶段 | 状态 |
|---|---|
| M0 | 待开始 |
| M1 | 待开始 |
| M2 | 待开始 |
| M3 | 待开始 |
| M4 | 待开始 |
| M5 | 待开始 |
| M6 | 待开始 |
| M7 | 待开始 |
| M8 | 待开始 |
| M9 | 待开始 |
