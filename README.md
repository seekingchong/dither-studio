# Dither Studio

抖动艺术工具。一期是 macOS 客户端（Electron 壳 + web 前端），同一份前端可发布独立 web 与 SkillForge 平台应用。

- 产品需求：`docs/PRD.md`
- 设计规范：`docs/DESIGN.md`，设计令牌 `design-system/tokens.css`
- 开发计划与进度：`docs/DEV_PLAN.md`
- 平台对接：`docs/PLATFORM_NOTES.md`
- 参数解读文案：`docs/PARAM_HELP.md`

## 功能

- 输入：PNG / JPG / WebP / GIF（含动图）/ HEIC（macOS 经 sips 转码）/ MP4 / WebM / MOV，拖拽或打开；1 或 4 个媒体坑位
- 像素化：像素尺寸 1–64（按输入分辨率自适应默认）、box / 双线性 / Lanczos / 最近邻、网格偏移
- 影调：自动色阶、亮度、对比度、阴影 / 中间调 / 高光、饱和度、模糊、锐化、去噪、噪点、描边、反相、阈值偏置、灰度公式、线性 / gamma 空间
- 抖动：阈值 3、噪声 4、有序 14、半调 10、误差扩散 14（含自定义核）、曲线扫描 4、点扩散 2 + DBS、图案 9
- 颜色：单色 / 灰阶 / Tint 色带 / Palette 真彩量化（17 组预设 + 自定义、深度错配）/ RGB · CMYK 分通道；Accent 强调色层
- 网格：欧几里得 / 圆方网点、反向、metaball 点融合、横纵间距、连线与网格点背景
- 特效栈：扫描线 CRT、胶片颗粒、JPEG 损坏、块位移、扫描行位移、像素排序、波形、桶形、像素散射，可堆叠排序
- 视频：逐帧预览（慢算法自动降预览分辨率）、60 fps 导出 H.264 MP4（无 H.264 编码器时降级 VP9 WebM）、三档码率
- 体验：内置预设 10 个、用户预设、撤销重做与快捷键、浅 / 深主题、GPU（WebGL2）开关
- 参数解读：停在任一参数标签上弹出「这是什么 / 各个值什么意思 / 什么时候选」，下拉里每个选项也逐条解释

## 环境

Node 22+，npm 10+。首次安装会下载 Electron 二进制。

```sh
npm install
```

## 开发

```sh
npm run dev        # 起 Vite dev server + Electron 窗口（热更新）
npm run dev:web    # 只起 Vite dev server，浏览器打开 http://127.0.0.1:5173/
```

## 测试

```sh
npm run typecheck  # electron / frontend / tests 三套 tsc
npm test           # vitest 引擎与状态单测（tests/engine）
npm run test:ui    # Playwright 截图与交互验收（tests/ui），基线在 tests/ui/__screenshots__
npm run check:platform   # 构建平台目标并在平台 base 路径下无头打开验证
```

首次在新平台跑 `test:ui` 会生成该平台的截图基线；改了界面后用 `npx playwright test --update-snapshots` 更新。

## 构建与发布

```sh
npm run build                     # Electron 目标：electron/dist + frontend/dist（base ./）
npm run dist                      # macOS 上打 dmg，输出到 release/（需在 Mac 上执行）
npm run build:frontend:web        # 独立 web（base /），把 frontend/dist 放到任意静态服务器根目录
npm run build:frontend:platform   # SkillForge 平台（base /skillforge/apps/dither-studio/static/）
npm run package:platform          # 组装 release/platform/dither-studio/{manifest.yaml, frontend/}，加 --build 自检构建
```

`npm run dist` 使用 `package.json` 里的 `build` 配置：`build/icon.png` 会转成 icns，`frontend/dist` 以 `asarUnpack` 方式放在包外以便 Worker 与字体按文件加载。未签名的包首次打开需在「系统设置 → 隐私与安全性」里允许。

平台发布：`platform/manifest.yaml` 是清单模板，`npm run package:platform` 把它和 `frontend/` 源码复制到干净目录；平台发布脚本会在该目录执行 `npm install && npm run build:platform`。二期接入 `X-User-Id` 引导与平台 API 时加 `src/app/platform.tsx`。

## 目录

```
frontend/   Vite + React 应用（src/engine 引擎、src/params 参数表、src/ui 界面、src/platform 平台接口、src/state 状态）
electron/   主进程与 preload
scripts/    dev / build-electron / sync-tokens / gen-bluenoise / package-platform / check-platform-build
platform/   SkillForge 清单模板
build/      打包资源（图标）
tests/      engine 单测、ui 截图
```

`design-system/tokens.css` 是令牌原件，改动后运行 `npm run sync-tokens` 同步到 `frontend/src/styles/tokens.css`。
