# Dither Studio 开发计划

> 依据：`docs/PRD.md`、`docs/DESIGN.md`、`docs/PARAM_HELP.md`、`docs/PREVIEW_SCALING.md`、`design-system/tokens.css`。
> 本文档是开发的唯一计划来源，每个里程碑完成后更新状态。

## 1. 目标与原则

- 产品形态：macOS 客户端。壳层只负责窗口和本地能力，界面与引擎全部是常规 web 前端代码。
- 应用身份：名称 `Dither Studio`，应用标识 `dither-studio`，bundle id `com.tda.dither-studio`。图标母版与各平台产物在 `assets/icon/`，接线方式见该目录 README。
- 未来同一份前端代码发布 web 端，因此壳层与前端之间只通过一个 `platform` 接口通信。
- 本地能力清单：打开文件、保存文件、读取文件、预设持久化、剪贴板写入、HEIC 转码、在 Finder 中显示。
- 样式只引用 `tokens.css` 的 `--tda-*` 变量，禁止裸色值、裸字号、裸圆角，零外部请求。
- 二期会作为 SkillForge 平台上的一个应用整体发布。前端是独立整页应用，由平台静态托管，可通过平台 API 使用用户数据、用户文件和 AI 能力。本地能力与平台能力都通过 `platform` 接口注入。对接要点见 `docs/PLATFORM_NOTES.md`。

## 2. 技术选型

| 层 | 选择 | 理由 | 备选 |
|---|---|---|---|
| 壳层 | Electron | 内核是 Chromium，和 web 端表现一致；WebCodecs H.264 硬编码可用；打包工具成熟；沙盒里能安装并测试 | Tauri 2：包体小、WKWebView 原生解码 HEIC，但内核是 Safari，和 web 端有差异，且需要 Rust 工具链 |
| 构建 | Vite + TypeScript | 开发热更新快，产物同时给 Electron 和 web | |
| UI | React 18 + TypeScript | 二期平台是 React Flow 技术栈，React 组件可以直接迁移；设计系统的 CSS 类原样复用；参数面板由 schema 驱动生成 | 原生 DOM：零依赖但二期要整体重写，放弃 |
| 状态 | zustand | React Flow 内部就是 zustand，二期接入时是同一套模型；不依赖 React 也能在 Worker 侧或测试里直接用 | Redux Toolkit |
| 引擎 | 纯 TypeScript，在 Web Worker 里运行 | 与 UI 完全解耦，可单测，不阻塞界面 | |
| GPU | WebGL 2 | 有序、半调、噪声、图案、特效、上采样这些逐像素独立的阶段走 GPU；误差扩散、曲线扫描、DBS 天生串行，只能 CPU | WebGPU 后续可加 |
| 视频解码 | `<video>` + `requestVideoFrameCallback`，WebCodecs `VideoDecoder` 备用 | 覆盖 mp4/webm/mov；GIF 动图用 `ImageDecoder` | |
| 视频编码 | WebCodecs `VideoEncoder`(avc1) + `mp4-muxer` | 硬件 H.264，`mp4-muxer` 是唯一需要引入的运行时第三方库，MIT 协议，约 30KB | |
| 测试 | vitest 跑引擎单测；Playwright + Chromium 截图验收 UI | 沙盒内可执行 | |
| 打包 | electron-builder 出 dmg | 需在你的 Mac 上执行 `npm run dist`，沙盒没有 macOS | |

## 3. 目录结构

```
dither-studio/
├─ frontend/               Vite + React 应用，目录名与 SkillForge 应用布局一致
│  ├─ src/
│  │  ├─ platform/         平台接口 + electron / web 两套实现，二期加 skillforge
│  │  ├─ engine/           抖动引擎，纯函数，无 DOM
│  │  │  ├─ pipeline.ts    流水线编排
│  │  │  ├─ preprocess/    影调与预处理
│  │  │  ├─ dither/        算法族，每族一个文件，统一注册表
│  │  │  ├─ color/         灰度公式、调色板、Tint、Accent
│  │  │  ├─ render/        网格渲染：点形状、融合、间距、背景
│  │  │  ├─ effects/       后处理特效栈
│  │  │  ├─ gpu/           WebGL 路径
│  │  │  └─ worker.ts
│  │  ├─ params/           参数 schema + 解读文案，PRD 每个参数一条记录
│  │  ├─ state/            zustand store、撤销重做、预设
│  │  ├─ ui/               React 组件，根组件 <DitherStudio>
│  │  │  ├─ panel/         参数面板：预设模块、可折叠分节、按 schema 生成控件
│  │  │  ├─ canvas/        预览画布与坑位网格
│  │  │  ├─ export/        导出与复制
│  │  │  └─ primitives/    按钮、下拉、滑块、Tab 等设计系统组件
│  │  ├─ app/              入口：electron.tsx、web.tsx，二期加 platform.tsx
│  │  └─ styles/           tokens.css + 组件类
│  ├─ index.html
│  ├─ package.json
│  └─ vite.config.ts       base 由 VITE_BASE 注入
├─ electron/               主进程、preload（本地能力实现）
├─ assets/icon/            应用图标：svg 母版、icns、ico、各尺寸 png，生成脚本同目录
├─ design-system/          设计系统原件
├─ docs/                   PRD、DESIGN、DEV_PLAN、PLATFORM_NOTES
├─ tests/                  引擎单测、UI 截图
└─ package.json            根：Electron 开发与打包脚本，workspace 引用 frontend
```

二期只需在根目录加 `manifest.yaml`，`frontend/` 原样就是平台要的前端模块。

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

接口的分组按 SkillForge 的能力划分：`storage` 对应平台的用户数据 KV，`files` 对应用户文件存储，可选的 `ai` 对应 Agent 对话。二期的 skillforge 实现只是把这三组各自接到平台 API 上。

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

抖动只在最终输出分辨率上计算，禁止"大图渲染再缩小"。预览缩放是引擎入参而不是 canvas/CSS 变换：
预览要算 `dither(W×z, H×z)`，不是 `resize(dither(W,H), z)`；预览路径只允许整数最近邻放大，任何情况下不得降采样。
导出尺寸若不是画布尺寸的整数倍，同样在导出尺寸上重算整条流水线。约束的推导与判定规则见 `docs/PREVIEW_SCALING.md`。

### 4.3 参数 schema

PRD 里的每个参数是一条记录：`{ id, group, label, type, min, max, step, default, options, visibleWhen, advanced, hint }`。参数面板、预设序列化、撤销重做、自动调整全部从这张表推导。新增参数只加一条记录。

每条记录另有一条解读文案，放在 `params/help.ts`，按 `id` 对齐：`{ summary, options?, tip? }`。参数标签的解读浮层、下拉选项行的逐值解读都从它生成；没有文案就退回 `hint`，两者都没有则不弹。新增参数要同时加 schema 记录和解读文案，`tests/engine/help.test.ts` 会拦下漏写、多写和对不上的选项。写作规范见 `docs/PARAM_HELP.md`。

界面分节与 schema 分组是两回事：`group` 是数据归属（预设的 `exposes` 按它生效），左栏的分节在 `ui/panel/sections.ts` 里定义，一节可以收多个分组（「基础」= `dither` + `pixel`），个别参数还能按名单跨节提前（`color.mode` 归到「基础」）。改界面分组不动 schema，也不影响已存的用户预设。

### 4.4 状态与渲染

- 单一 `params` 对象，不可变更新，订阅者是画布渲染器。
- 撤销栈存参数快照，滑块拖动过程合并成一次记录。快捷键 Cmd+Z / Shift+Cmd+Z。
- 渲染调度：参数变化后 16ms 内合并，取消上一次未完成的 Worker 任务。
- 预览 canvas 按 devicePixelRatio 开 backing store（`canvas.width = cssW * dpr`），`image-rendering: pixelated` 仅在整数倍放大时启用。
- 有效颗粒尺寸 `E = 像素尺寸 × 预览缩放 × dpr` 必须是 ≥1 的整数，UI 层负责保证，见 `docs/PREVIEW_SCALING.md`。
- 多媒体坑位：`slots[]` 各自持有源媒体，共用同一套 `params`。1 个坑位单画布，4 个坑位 2×2 网格。

### 4.5 视频

- 预览：逐帧送入流水线，慢算法自动降到预览分辨率。
- 导出：按 60fps 时间线取帧，源视频帧率不足时重复帧，GIF 按各帧延时重采样。编码质量中、高、超高对应三档码率。

### 4.6 二期作为 SkillForge 应用发布

二期形态已按平台的发布技能仓库核实：Dither Studio 是 SkillForge 上的一个应用，前端是独立整页应用，由平台静态托管，不是嵌进平台 React 树的组件。React Flow 是平台自身的技术栈，与应用无关。细节见 `docs/PLATFORM_NOTES.md`。一期按以下标准写：

- 目录：Vite 应用放在 `frontend/`，与平台应用布局一致。二期在根目录加 `manifest.yaml` 即可发布。
- 构建目标：`base` 由 `VITE_BASE` 注入。Electron 用 `./`，独立 web 用 `/`，平台用 `/skillforge/apps/dither-studio/static/`。
- 入口拆分：`src/app/electron.tsx` 和 `src/app/web.tsx` 只做装配。二期加 `src/app/platform.tsx`，负责从 URL 读取 `X-User-Id`、认证失败页、带请求头的 `apiFetch`，并构造 `Platform` 接口的平台实现。
- 平台接口是二期的接缝：一期由 Electron 实现文件读写、本地存储、剪贴板；二期 `storage` 接用户数据 KV，`files` 接用户文件存储，可选的 `ai` 接 Agent 对话。界面与引擎不改。
- 资源体积：字体、蓝噪声纹理等随包资源计入平台 100MB 发布包上限。Electron 打包产物放 `release/` 并 gitignore，二期发布前用脚本把 `manifest.yaml` 和 `frontend/` 复制到干净目录再发布。
- 不引入 React Flow。引擎保持固定流水线。

## 5. 里程碑

| 阶段 | 内容 | 验收 |
|---|---|---|
| M0 脚手架 | Electron + Vite + React + TS 工程，Vite 应用置于 `frontend/`；`VITE_BASE` 三个构建目标；tokens.css 接入；platform 接口与两套实现；zustand store 骨架；vitest 与 Playwright 配置；CI 脚本 | `npm run dev` 能起窗口，`npm test` 通过 |
| M1 端到端 MVP | 打开图片、拖拽；像素化；固定阈值、Bayer 4×4、Floyd–Steinberg 三个算法；1-bit 黑白；画布缩放档位（按每颗粒屏幕像素数，见 `docs/PREVIEW_SCALING.md`）；导出 PNG、复制 PNG；UI 骨架按 home 画板：顶栏、左参数面板、右预览 | Playwright 截图与设计稿比对；三个算法单测快照；各缩放档位下预览无摩尔纹 |
| M2 算法全量 | 阈值 3、噪声 4、有序 13、半调 10、误差扩散 14 + 自定义核、曲线 4、点扩散与 DBS、图案 9，各族参数齐全 | 每个算法一个确定性输出快照测试 |
| M3 影调与像素化 | 预处理全部 12 项；降采样 4 种方法；网格偏移；像素尺寸按输入分辨率自适应默认 | 单测 + 截图 |
| M4 颜色系统 | 5 种颜色模式；灰阶级数；深度错配开关；13 组预设调色板；Tint 双色与色带；Accent 层全部参数 | 单测 + 截图 |
| M5 网格渲染 | 点融合 metaball；欧几里得、圆方、反向网点；横纵网格间距；连线背景、网格点背景 | 截图 |
| M6 特效栈 | 扫描线 CRT、胶片颗粒、JPEG glitch、块位移、行位移、像素排序、波形、桶形、散射；可堆叠、可排序 | 截图 |
| M7 视频与 GPU | 视频与 GIF 动图输入；逐帧预览；MP4 H.264 导出三档质量；WebGL 路径与 GPU 开关；HEIC 转码 | 导出文件可在 QuickTime 播放 |
| M8 预设与体验 | 内置预设 7 个起；用户预设保存、重命名、删除；撤销重做与快捷键；浅深主题；全局设置：坑位 1 或 4、GPU 开关；4 坑位预览 | 截图 + 预设持久化测试 |
| M9 发布 | electron-builder 打 dmg，图标用 `assets/icon/icon.icns`；独立 web 构建目标；平台构建目标（base 为平台路径）与打包脚本骨架，不实际发布；README | 你本机 `npm run dist` 出包并能打开；平台构建产物在本地静态服务器下能打开 |
| M10 参数解读与左栏重构 | 每个参数、每个选项、每种特效都有解读浮层；左栏去掉分组 tab，改成预设模块 + 可折叠分节，算法族那一排并入「基础」 | 文案与 schema 一致性单测；解读浮层与分节的 Playwright 用例；刷新截图基线 |

每个里程碑单独提交并推送到分支，M1 完成后你就能在本机跑起来看效果。

### 5.1 需要你在 Mac 上做的验证

1. `npm install && npm run dev` 起窗口，打开一张 HEIC 确认 sips 转码。
2. 打开一段 mp4，导出视频，确认对话框显示 H.264 且 QuickTime 能播放；导出后点「复制文件」到 Finder 粘贴。
3. `npm run dist` 出 dmg，安装后打开；未签名包需在系统设置里允许。
4. 设置里切换深色主题，对照 Figma 校正 `frontend/src/styles/theme.css` 的色值。

## 6. 需要你确认的事项

| # | 事项 | 我的建议 |
|---|---|---|
| 1 | 壳层用 Electron 还是 Tauri | Electron，理由见第 2 节 |
| 2 | 画布默认缩放。PRD 写 10%，1000×600 的 10% 只有 100×60 像素，且非整数倍缩放会产生摩尔纹格子（分析见 `docs/PREVIEW_SCALING.md`） | 缩放档位由百分比改为"每颗粒 N 个屏幕像素"（1×/2×/4×/8×）加"适应窗口"，从交互上排除非整数组合；若坚持保留百分比档位，则在有效颗粒尺寸非整数时自动吸附像素尺寸并提示 |
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
| 13 | 二期在平台上的形态 | 已确认并按发布技能仓库核实：SkillForge 应用，前端整页托管，见 4.6 与 `docs/PLATFORM_NOTES.md` |
| 14 | 线性空间抖动。PRD 默认 BT.709 线性空间，物理上正确（抖动后平均亮度与原图一致），但比常见工具的 gamma 空间结果整体偏暗 | 默认线性，影调分区加"线性空间"开关可关掉；M3 的亮度 / 中间调再补偿。你看效果后决定默认值 |
| 15 | Ostromoukhov 系数表只重建了前 44 级，其后按论文趋势插值到中灰；Zhou–Fang 的阈值调制曲线为近似；libdither 的非矩形 / 中心白点 / 对角矩阵与 ImageMagick 圆点按描述重建 | 视觉上可用；若你有原始表格可直接替换 `errorDiffusion.ts` 里的 `OSTRO_KEY` |
| 16 | 沙盒 Chromium 没有 H.264 编码器，导出验证走的是 VP9 / WebM 路径；macOS Electron 上 WebCodecs 用 VideoToolbox，预期能出 MP4，需你本机确认 QuickTime 可播放 | 若 H.264 不可用会自动降级 WebM 并在对话框里标出编码器 |
| 17 | 应用图标配色：图标沿用原图的暖黑 `#1D1A16` / 暖灰 `#DBD9D5`，与设计系统的墨色 `#11192D`、页面底色 `#F9F9F9` 不是一套 | 独立应用图标保留暖色，界面内的图形走 `currentColor` 自动落到墨色；想统一改 `assets/icon/build-icons.py` 顶部两个常量重跑 |

## 7. 风险

- 视频导出依赖 WebCodecs 的 H.264 编码。Electron 内置 Chromium 在 macOS 上有硬件编码，可行；web 端 Safari 支持有限，届时降级为 WebM。
- 性能。画布 1000×600、像素尺寸 1 时误差扩散约 60 万像素，单帧 20 到 40ms，可接受。4 坑位加视频加慢算法会卡，靠预览降分辨率兜底。
- 沙盒里无法执行 macOS 打包，M9 需要你本机执行并反馈。
- 设计稿目前只有 home 画板一页。弹窗、导出面板、设置页需要新的 Figma 画板，你给带 node-id 的链接我用 MCP 读取。
- 二期平台限制：上传请求体上限约 50MB，发布包上限 100MB。视频源文件上传到平台可能需要前端压缩或分片，二期评估，一期不受影响。

## 8. 状态

| 阶段 | 状态 |
|---|---|
| M0 | 已完成：`frontend/` Vite + React 18 + TS；`VITE_BASE` 三目标；`platform` 接口与 electron / web 实现；zustand store；vitest + Playwright；CI；Electron 44 剪贴板已用 W3C 风格异步 API |
| M1 | 已完成：打开 / 拖拽图片；像素化（box / bilinear / lanczos / nearest 与网格偏移已一并实现）；固定阈值、Bayer 2–32 与 3×3、Floyd–Steinberg；1-bit Tint；缩放 5 档；导出 / 复制 PNG；Worker 流水线分阶段缓存；Inter 与 Roboto Mono 随包；Playwright 5 个用例 + 4 张基线截图，引擎 50 个单测 |
| M2 | 已完成：阈值 3（固定 / Otsu / 自适应）、噪声 4（蓝噪声离线 void-and-cluster 128×128 / 白 / IGN / Perlin）、有序 14、半调 10（含增益、融合度、反向）、误差扩散 14（含自定义核文本、扫描方向、误差截断、Ostromoukhov / Zhou–Fang 变系数）、曲线 4（Hilbert / Peano / Gosper / FASS + Riemersma 记忆与衰减比）、点扩散 Knuth / Lippens 与 DBS、图案 9；61 个算法各有 ASCII 快照，152 个单测；Playwright 逐族切换用例 |
| M3 | 已完成：影调链 13 项（自动色阶 + 轻对比锐化、亮度、对比度、阴影 / 中间调 / 高光曲线、饱和度、三次盒式逼近的高斯模糊、USM 锐化、双边去噪、四种噪点、Sobel 描边、反相、阈值偏置）；降采样 4 种与网格偏移已在 M1 落地；像素尺寸按输入长边 2 / 3 / 4 自适应，用户手动改过即不再覆盖；影调阶段独立缓存键 |
| M4 | 已完成：单色 / 灰阶 / Tint（双色 + 色带站点）/ Palette / Channels（RGB、CMYK）五种模式；灰阶级数 2–16；Palette 走真彩最近色量化（阈值场、误差扩散、曲线、点扩散有三通道实现，其余回退亮度路径），深度错配开关按索引回绕；预设调色板 17 组（含灰阶 4/8/16 与自定义列表）；Accent 层：1–6 色带权重、密度、5 种放置规则、目标范围、最小间距、连锁、种子；面板加色板预览 |
| M5 | 已完成：网格渲染器替换最近邻放大（默认参数仍走最近邻快路径）；欧几里得 / 圆方网点、反向网点、网点大小、随明暗缩放；metaball 点融合（Wyvill 核，融合半径可调）；横纵间距；连线背景（行 / 列、粗细、颜色）与网格点背景（圆 / 方 / 菱形 / 十字、大小、颜色）；渲染阶段独立缓存 |
| M6 | 已完成：特效栈以 `effects.stack` JSON 参数承载（可随预设序列化、可撤销），面板专用编辑器支持添加 / 启用 / 上下移 / 删除；9 种特效：扫描线 CRT（线间距、暗线、荧光点、屏幕曲率）、胶片颗粒、JPEG 损坏、块位移、扫描行位移（含 RGB 分离）、像素排序（横 / 纵、亮度区间、降序）、波形、桶形 / 枕形、像素散射；全部确定性（种子）并有独立缓存 |
| M7 | 已完成：视频（`<video>` + requestVideoFrameCallback，Worker 忙时丢帧）与 GIF 动图（WebCodecs ImageDecoder 逐帧）输入；播放 / 暂停 / 进度条；慢算法按上一帧耗时自动降到 50% / 25% 预览分辨率（格子数不变）；导出按 60 fps 时间线逐帧渲染 + WebCodecs 编码，优先 H.264 进 MP4（mp4-muxer），平台没有 H.264 编码器时降级 VP9 / VP8 进 WebM（webm-muxer），中 / 高 / 超高三档码率，可保存或复制为文件；WebGL2 路径覆盖有序抖动与网格渲染，设置里可关，失败自动回退 CPU；HEIC 经主进程 sips 转码（M0 已实现，需在 macOS 验证） |
| M8 | 已完成：内置预设 10 个（Game Boy、Mac Classic、Newspaper、CRT、Blueprint、Risograph、Obra Dinn、Pixel Art、Zine、Dot Matrix）+「默认」；预设模块置于参数模块上方（不再拆成两个 tab）：先选一套方案，参数面板只露出这套方案具备的参数（每个内置预设声明 `exposes`），在它基础上微调后可起名存为我的预设（记住来源预设与结果缩略图），新预设出现在预设卡片和「历史」页；「历史」页列出保存过的所有方案（缩略图、时间、来源、算法 / 颜色摘要），可应用、更新、重命名、删除；经 `platform.storage` 持久化（Electron JSON 文件 / web localStorage）；撤销重做（同一参数 800ms 内合并、上限 100 步）与快捷键 Cmd+Z / Shift+Cmd+Z / Cmd+O / Cmd+S / Cmd+C / 空格；浅 / 深 / 跟随系统主题（`theme.css` 覆盖令牌）；设置弹层（坑位 1 或 4、GPU、主题）并持久化；4 坑位 2×2 预览各自拖拽与播放 |
| UI 调整（2026-09） | 已完成：像素尺寸范围 1–16、默认 4，去掉按输入分辨率自动建议；默认算法族「有序」、算法 Bayer 2×2、颜色模式「单色」；单色 / 灰阶 / Tint 共用「暗色 / 亮色」两端（引擎 `buildLevelPalette` 的 mono / gray 走两端插值），颜色分节的色板改为可编辑色块——点开有系统取色器与可直接输入的十六进制色值，Tint 中间级逐级可调（灰阶改中间级自动转 Tint），Palette 每一色可改、可增删（改内置调色板转「自定义」）；「画布」分节移出左栏，与缩放合并进预览区右上角的「画布」菜单（尺寸输入、常用尺寸、原图尺寸、适配）；特效的 9 个选项以芯片全部露出、点一下添加；删掉「打开 / 复制 PNG / 撤销 / 重做」按钮，只保留快捷键（⌘C 复制当前坑位的当前帧，设置菜单列出全部快捷键，新增 ⌘⇧E 导出视频）；设置图标换成几何生成的 6 齿齿轮（`scripts/gen-gear-icon.mjs`）。这一版原本还把左栏分区 tab 改成锚点式，与 M10 的可折叠分节是同一问题的两种答案，合并时保留了可折叠分节 |
| M9 | 已完成（沙盒可做的部分）：应用图标与应用名 Dither Studio —— 图标母版与全套产物在 `assets/icon/`（SVG 母版 + `build-icons.py`，出 icns / ico / 各尺寸 png，macOS 本体按 Apple 图标网格留白），electron-builder 用 `assets/icon/icon.icns`，前端 favicon 走 `frontend/public/icon/`，应用内标志同一几何，productName / 窗口标题 / `app.setName` / 原生菜单 / 平台 manifest 一致；electron-builder 配置（dmg、`frontend/dist` asarUnpack），Linux 上以 `--dir` 打包并冒烟通过；独立 web 目标；平台目标 + `scripts/check-platform-build.mjs`（构建后按平台 base 路径静态托管并无头渲染一次）已进 CI；`platform/manifest.yaml` 模板与 `scripts/package-platform.mjs` 打包骨架；README；`.github/workflows/release-macos.yml` 在 GitHub 的 macOS runner 上打 arm64 / x64 两个未签名 dmg（只在打 `v*` tag 或手动运行时触发，产物见 Actions artifact 或 Release；日常推 main 不出包）。待你本机：`npm run dist` 出 dmg 并打开 |
| M10 | 已完成：参数解读浮层——停在参数标签上 400ms 弹出「一句话 + 各值解读 + 提示」，贴控件外侧不遮控件，键盘 `?` / `F1` 触发、`Esc` 收起，触屏点按展开；选项 >8 的下拉（算法、调色板、Bayer 矩阵）改由下拉选项行逐条解读，展开下拉时属性浮层让位；文案 95 条参数 + 9 种特效全覆盖，放在 `params/help.ts`，一致性检查进单测。左栏重构：删掉分组 tab，改成整栏一列的可折叠分节（默认只展开「基础」，收起时标题右侧显示当前值摘要），原本浮在 tab 之上的快捷参数整排并入「基础」，`color.mode` 也跟着过去，「颜色」节只留该模式的细节 |
| 布局调整（2026-09） | 已完成：macOS 隐藏系统标题栏（标题文字与分隔线一并去掉），三个圆点浮在一条透明可拖动区上；删掉应用内顶栏，「设置」挪到左栏操作行、「导出视频」挪到预览区「画布」菜单右侧；整窗 26px 大圆角（`--tda-radius-window`）；左右分栏可拖拽（宽度随设置持久化，双击复位），左栏为容器查询容器，参数栅格按栏宽在一排三 / 二 / 一间自适应；预览头去掉进度条右侧的时间与分辨率 / 耗时 / GPU 小字（渲染细节改挂在坑位 `data-*` 上）；全部滚动条隐藏；拖文件不再盖全窗遮罩，改为坑位自己标成可放置、悬停坑位高亮；修掉每次拖入素材先弹「渲染失败：坑位没有源媒体」的竞态（`RenderClient` 在源帧送到 Worker 之前压住渲染请求） |
| 分隔线与导出入口（2026-09） | 已完成：加回两条分隔线——macOS 透明标题条底部 1px（高度为 0 的平台不画，免得线落进整窗大圆角的裁剪区里两头缺一截），左右分栏中间 1px（`.pane-splitter` 的宽度从 1px 改成 9px：全局 `box-sizing: border-box` 下 1px 减去两侧各 4px 命中区 padding，content-box 被压成 0，`background-clip: content-box` 就什么也没画出来；外扩 margin 不变，布局上仍只占 1px）。导出收成一个按钮：预览头「画布」菜单右侧那个按当前坑位的媒体类型换文案与去处——图片「导出图片」直接存 PNG，视频 / GIF「导出视频」开对话框；左栏操作行的「导出 PNG」删掉，只剩页签与「设置」 |
| 选中态与保存预设（2026-09） | 已完成：选中态不再用品牌橙——预设卡片、历史条目的描边与「使用中」标签都改 `text-primary` 墨色（`brand-secondary` 的浅橙底换 `control-strong`），`app.css` 里已无 brand-* 引用。保存预设从预设模块里那一行输入框改到左栏操作行：「设置」右边依次是「还原」（只有图标，没微调过时置灰）与「保存预设」，后者点开浮层，名称预填成「当前方案 副本」（重名往后排号）并全选，回车即存，当前方案本身是我的预设时浮层里还能覆盖更新。预设卡片最多露三行，其余折起（「还有 N 个 / 收起」）——列数由容器查询决定，行数靠读回 `grid-template-columns` 的轨道数；我的预设改排在内置方案前面（内置 11 套，排在后面会总落在折叠线以下），选中的那张被折在下面时整组强制展开 |
| 面板细节（2026-09） | 已完成：预设标题去掉星号图标；「画布」菜单里六个常用尺寸芯片删掉，只留宽高两个输入框；`canvas.fit` 默认值 `contain` 改 `cover`（默认铺满裁切，不再留白）；左栏分节默认全部展开（仍可逐节收起，摘要只在收起时出现），节与节之间的 1px 分割线去掉；「颜色」分节挪到「基础」与「影调」之间——颜色模式就在「基础」那一排里选，细节挨着它才接得上；取色层加 HSB 输入并作为默认模式（HSB / HEX 两档切换，选择在会话内记住），换算放 `ui/primitives/color.ts`，H / S / B 取整导致的往返误差实测 ≤ 3/255，面板以 HSB 状态为准所以不会反复漂移 |
| 分节重置 / 视频裁剪 / 预览圆角（2026-09） | 已完成：每个参数模块（含预设）标题行右端加「重置」图标按钮，把这一节退回当前方案本身的值（`presetReferenceParams`，与「还原」同一把尺子，范围缩到一节），按整份 schema 算归属，连没露出来、当前条件下不可见的参数一起退；这一节没改过就置灰，预设模块的「重置」= 退回「默认」预设。「原图」页的视频卡片下加固定 3 秒的裁剪条（`TRIM_SECONDS`）：拖窗口挑哪三秒，方向键 0.1 / Shift 1 秒微调，Home / End 到两端；起点存在播放状态里（`PlaybackEntry.trimStart`，不进撤销栈也不进预设），播放在窗口内循环，顶部进度条 min / max 跟着窗口走，`exportVideo` 接 `trim` 只编码这一段（3 秒 × 60 fps = 180 帧），视频短于 3 秒时窗口就是整段。预览画布加按宽度 7.2% 的圆角（100px → 7.2、500px → 36），只是 DOM `border-radius`，导出不带 |
| 素材编辑 / 默认存桌面（2026-09） | 已完成：「原图」页素材卡片加编辑条——旋转 90°、左右 / 上下镜像、画面裁剪缩放 1×–4×（等比，放大多少等比裁掉多少，放大后拖预览挪裁剪窗口）。状态放 `ui/media/sourceEdit.ts`，按坑位存、不进撤销栈也不进预设，换素材即清空；变换在送进 Worker 之前烤进源帧（`editedBitmap`），所以结果预览、PNG 与视频导出都自动带上，`exportVideo` 也接 `edit`。镜像作用在旋转之后的画面上（画布变换里 scale 写在 rotate 前面），UI 用例用四象限彩图逐角验证方向。Electron 保存对话框的默认路径从「图片」改成「桌面」 |
