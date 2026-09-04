# Dither Studio

抖动艺术工具。一期是 macOS 客户端（Electron 壳 + web 前端），同一份前端可发布独立 web 与 SkillForge 平台应用。

- 产品需求：`docs/PRD.md`
- 设计规范：`docs/DESIGN.md`，设计令牌 `design-system/tokens.css`
- 开发计划与进度：`docs/DEV_PLAN.md`
- 平台对接：`docs/PLATFORM_NOTES.md`
- 参数解读文案：`docs/PARAM_HELP.md`

## 功能

- 输入：PNG / JPG / WebP / GIF（含动图）/ HEIC（macOS 经 sips 转码）/ MP4 / WebM / MOV，拖拽、打开或⌘/Ctrl + V 粘贴（进当前选中的坑位，多个就依次往后填）；1 或 4 个媒体坑位；鼠标移到坑位上，右上角出现清空按钮，点一下把这个坑位倒空
- 像素化：像素尺寸 1–16（默认 4）、box / 双线性 / Lanczos / 最近邻、网格偏移
- 影调：自动色阶、亮度、对比度、阴影 / 中间调 / 高光、饱和度、模糊、锐化、去噪、噪点、描边、反相、阈值偏置、灰度公式、线性 / gamma 空间；强制背景（把与画面边缘相连的干净背景换成规则的点，主体与高光不动，深底浅底都行）
- 抖动：阈值 3、噪声 4、有序 14、半调 10、误差扩散 14（含自定义核）、曲线扫描 4、点扩散 2 + DBS、图案 9
- 颜色：单色 / 灰阶 / Tint 色带 / Palette 真彩量化（17 组预设 + 自定义、深度错配）/ RGB · CMYK 分通道；每个色块都能点开改色或直接输入色值；Accent 强调色层
- 网格：欧几里得 / 圆方网点、反向、metaball 点融合、横纵间距、连线与网格点背景
- 特效栈：扫描线 CRT、胶片颗粒、JPEG 损坏、块位移、扫描行位移、像素排序、波形、桶形、像素散射，可堆叠排序
- 素材编辑：「原图」页上可旋转 90°、左右 / 上下镜像、等比裁剪缩放（放大后拖预览挪位置），编辑烤进源帧，预览与导出都带上
- 视频：逐帧预览（慢算法自动降预览分辨率）、「原图」页上固定 4 秒的裁剪窗口（拖着挑用哪四秒，不足 4 秒就是整段；预览循环与导出都只认这一段）、60 fps 导出 H.264 MP4（无 H.264 编码器时降级 VP9 WebM）、三档码率
- 导出：PNG、SVG（当前帧的矢量版，同色块合并成 path）、60 fps 视频
- 界面预览：双击坑位弹出一扇新窗口，里面是一整张按 Figma 设计稿 1:1 复刻的静态界面（淘天设计智库 tdc home），当前这份素材放进界面里的 `video cover` 容器，视频 / GIF 在那儿跟着主窗口一起循环播；界面整体按窗口大小等比缩放，除封面外全是死的，Esc 关窗，同一个坑位再双击复用同一扇窗
- 体验：内置预设 10 个、用户预设、撤销重做与快捷键、浅 / 深主题、GPU（WebGL2）开关；默认方案是有序 Bayer 2×2 单色
- 参数解读：停在任一参数标签上弹出「这是什么 / 各个值什么意思 / 什么时候选」，下拉里每个选项也逐条解释
- 界面：无应用内顶栏，macOS 上系统标题栏只留三个圆点、下面一条分隔线；左右分栏可拖拽、中间一条分隔线，左栏参数栅格按栏宽在一排三 / 二 / 一之间自适应；参数分节默认展开、可逐节收起（收起时显示当前值摘要），节间不画线，顺序是基础 → 颜色 → 影调 → 网格 → 特效，每节标题右端有「重置」退回当前方案的值；预览画布按宽度 7.2% 加圆角（只在预览，导出不带）；色块点开的取色层默认 HSB，可切 HEX；预设卡片最多三行、其余折起，「还原」与「保存预设」在左栏操作行（保存点开浮层，名称已预填）；选中态一律墨色描边，不用品牌橙；画布尺寸 / 适配 / 缩放集中在预览区右上角的「画布」菜单，导出按钮在它右侧：主按钮按素材类型在「导出图片」（存 PNG）与「导出视频」（开对话框）之间切，左边是「导出帧」（当前帧存成 SVG 矢量图），左栏不再放导出按钮；打开、复制当前帧 PNG、撤销、重做只走快捷键（⌘/Ctrl + O / C / Z / ⇧Z，左栏「设置」里有一览），面板上不放这些按钮

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

`npm run dist` 使用 `package.json` 里的 `build` 配置：应用图标取 `assets/icon/icon.icns`（母版与生成脚本在 `assets/icon/`），`frontend/dist` 以 `asarUnpack` 方式放在包外以便 Worker 与字体按文件加载。未签名的包首次打开需在「系统设置 → 隐私与安全性」里允许。

## 下载安装包

不想在本机装 Node 就用 GitHub Actions 打好的包：`.github/workflows/release-macos.yml` 在
GitHub 的 macOS runner 上跑，产出 `Dither-Studio-<版本>-arm64.dmg`（Apple 芯片）和
`-x64.dmg`（Intel）两个安装包。**只在打 `v*` tag 或在 Actions 页手动运行时才会出包**，
日常推 `main` 不打包；需要安装包时再手动触发一次即可。

两种取包方式：

- **Actions artifact**：仓库 → Actions → 左侧 `Release macOS` → 点一次绿勾的运行 →
  页面底部 Artifacts → `dither-studio-macos-dmg`（下载下来是 zip，解压得到两个 dmg 和
  `SHA256SUMS.txt`）。保留 30 天。
- **GitHub Release**：推一个 `v` 开头的 tag（`git tag v0.1.0 && git push origin v0.1.0`），
  流水线会建 Release 并把 dmg 挂上去，之后从 Releases 页面直接下载，长期有效。

包是**未签名未公证**的（没有 Apple 开发者证书）。安装：打开 dmg，把 Dither Studio 拖进
「应用程序」；首次打开会被 Gatekeeper 拦下，去「系统设置 → 隐私与安全性」，在下方点
「仍要打开」即可。如果连那一项都没出现，终端执行一次
`xattr -dr com.apple.quarantine "/Applications/Dither Studio.app"`。

有 Node 22 的话本机 `npm install && npm run dist` 一样出包，产物在 `release/`。

平台发布：`platform/manifest.yaml` 是清单模板，`npm run package:platform` 把它和 `frontend/` 源码复制到干净目录；平台发布脚本会在该目录执行 `npm install && npm run build:platform`。二期接入 `X-User-Id` 引导与平台 API 时加 `src/app/platform.tsx`。

## 目录

```
frontend/   Vite + React 应用（src/engine 引擎、src/params 参数表、src/ui 界面、src/ui/interface-preview 界面预览窗口、src/platform 平台接口、src/state 状态）
electron/   主进程与 preload
scripts/    dev / build-electron / sync-tokens / gen-bluenoise / package-platform / check-platform-build
platform/   SkillForge 清单模板
assets/     应用图标母版与各平台产物
build/      打包资源（electron-builder buildResources）
tests/      engine 单测、ui 截图
```

`design-system/tokens.css` 是令牌原件，改动后运行 `npm run sync-tokens` 同步到 `frontend/src/styles/tokens.css`。
