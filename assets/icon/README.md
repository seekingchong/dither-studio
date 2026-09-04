# 应用图标 — Dither Studio

应用名 **Dither Studio**，应用标识（SkillForge / 目录名 / bundle 后缀）`dither-studio`。

图形是两枚圆角方块沿对角错位，恰好是 Bayer 2×2 有序抖动矩阵的一个单元，也是最基础的棋盘图案——
和 PRD 里「有序 / Bayer」「图案 / 棋盘」两族算法同一个形状，不用额外解释就说明了产品在做什么。

## 几何与颜色

母版画布 1024×1024：

| 参数 | 值 | 说明 |
|---|---|---|
| 图形外框 | 704 = 画布 68.75% | 居中，四周各留 160 |
| 单个方块 | 352 × 352 | 外框的一半，两枚在中心点相接 |
| 方块圆角 | 103.84 = 边长 29.5% | 连续感的大圆角 |
| 暖黑 | `#1D1A16` | 方块 |
| 暖灰 | `#DBD9D5` | 底色 |

两处工艺处理：

- **小尺寸光学补偿**：16/32px 时图形放大到画布 84% 并收紧圆角，48–128px 逐档过渡，否则缩到 16px 会糊成一团。见 `build-icons.py` 的 `optical()`。
- **macOS 本体形状**：macOS 不会替应用图标裁圆角，必须自己画。`mac/` 与 `icon.icns` 按 Apple 的图标网格，本体占画布 824/1024，圆角用 n=5 的超椭圆近似系统的连续曲率，四周留白透明。满版方形版本只给 web / Windows / Linux 用。

## 文件清单

| 文件 | 用途 |
|---|---|
| `icon.svg` | 满版方形矢量母版，1024 |
| `icon-mac.svg` | macOS 形状矢量母版（超椭圆本体 + 留白） |
| `favicon.svg` | 32px 几何的矢量 favicon，浏览器标签页 |
| `mark.svg` | 纯图形，透明底 + `currentColor`，界面内用 |
| `icon.icns` | macOS 应用图标，含 16→1024 共 10 档（含 @2x） |
| `icon.ico` | Windows / Linux / 旧式 favicon，16–256 共 7 档 |
| `png/icon-{16…1024}.png` | 满版方形位图 |
| `png/apple-touch-icon-180.png` | iOS 主屏 |
| `png/pwa-{192,512}.png` | PWA 常规图标 |
| `png/pwa-maskable-{192,512}.png` | PWA maskable，图形收进中心 80% 安全圆 |
| `mac/icon-{16…1024}.png` | macOS 各档，`icon.icns` 的来源 |

重新生成：`python3 assets/icon/build-icons.py`（需要 Pillow）。改设计只改脚本顶部的常量，全套产物一起重出。

## 接线方式

**Electron 打包**（根 `package.json`，M0/M9）：

```json
{
  "build": {
    "productName": "Dither Studio",
    "appId": "com.tda.dither-studio",
    "mac": { "icon": "assets/icon/icon.icns", "category": "public.app-category.graphics-design" }
  }
}
```

窗口与菜单里的应用名来自 `productName`；开发态标题栏用 `app.setName('Dither Studio')` 保持一致。

**前端 HTML**（`frontend/index.html`，零外部请求，全部走本地路径）：

```html
<title>Dither Studio</title>
<link rel="icon" href="/assets/icon/favicon.svg" type="image/svg+xml" />
<link rel="alternate icon" href="/assets/icon/icon.ico" sizes="16x16 32x32 48x48" />
<link rel="apple-touch-icon" href="/assets/icon/png/apple-touch-icon-180.png" />
```

图标资源随 Vite 的 `publicDir` 走，路径会跟着 `VITE_BASE` 变（Electron `./`、web `/`、平台 `/skillforge/apps/dither-studio/static/`），HTML 里用 Vite 的相对引用而不是写死 `/`。

**顶栏 18px 图标**（`docs/DESIGN.md` §3.1）：用 `mark.svg`，不要用带底色的方形版。它填 `currentColor`，会自动继承 `--tda-color-text-primary`（`#11192D`），所以界面里的图形是设计系统的墨色，独立应用图标才是暖黑 `#1D1A16`。

```tsx
<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
  <rect x="0.5" y="0.5" width="11.5" height="11.5" rx="3.39" fill="currentColor" />
  <rect x="12" y="12" width="11.5" height="11.5" rx="3.39" fill="currentColor" />
</svg>
```

## 待确认

独立应用图标现在用的是原图的暖黑 / 暖灰，和设计系统的墨色 `#11192D`、页面底色 `#F9F9F9` 是两套色。
界面内的 `mark.svg` 走 `currentColor` 已经统一到墨色；如果希望应用图标也换成设计系统配色，
改 `build-icons.py` 顶部的 `INK` / `BG` 两个常量重跑即可。
