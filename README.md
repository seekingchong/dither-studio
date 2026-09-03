# Dither Studio

抖动艺术工具。一期是 macOS 客户端（Electron 壳 + web 前端），同一份前端可发布独立 web 与 SkillForge 平台应用。

- 产品需求：`docs/PRD.md`
- 设计规范：`docs/DESIGN.md`，设计令牌 `design-system/tokens.css`
- 开发计划与进度：`docs/DEV_PLAN.md`
- 平台对接：`docs/PLATFORM_NOTES.md`

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
npm test           # vitest 引擎单测（tests/engine）
npm run test:ui    # Playwright 截图与交互验收（tests/ui），基线在 tests/ui/__screenshots__
```

首次在新平台跑 `test:ui` 会生成该平台的截图基线；改了界面后用 `npx playwright test --update-snapshots` 更新。

## 构建

```sh
npm run build                     # Electron 目标：electron/dist + frontend/dist（base ./）
npm run build:frontend:web        # 独立 web（base /）
npm run build:frontend:platform   # SkillForge 平台（base /skillforge/apps/dither-studio/static/）
npm run dist                      # macOS 上打 dmg，输出到 release/
```

## 目录

```
frontend/   Vite + React 应用（src/engine 引擎、src/params 参数表、src/ui 界面、src/platform 平台接口）
electron/   主进程与 preload
scripts/    dev / build-electron / sync-tokens
tests/      engine 单测、ui 截图
```

`design-system/tokens.css` 是令牌原件，改动后运行 `npm run sync-tokens` 同步到 `frontend/src/styles/tokens.css`。
