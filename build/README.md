# 打包资源

- `icon.svg`：应用图标源文件，几何与色值来自设计导出的「APP icon.svg」（512 画布、底色 #D7D6D4、两个 176×176 圆角 48 的 #1D1711 方块位于 (80,80) 与 (256,256)，在画布中心对角相接）。文件里的 `viewBox` 未改动，只把 `width`/`height` 设为 1024 以便直接渲染 1024×1024 的 PNG。
- `icon.png`：由 `npm run gen:icon` 从 `icon.svg` 渲染，1024×1024。electron-builder 在 macOS 上会自动转成 `.icns`。
- 换图标只替换 `icon.svg`（保持满幅方形图稿），再运行 `npm run gen:icon`。
- 图稿是满幅方形。macOS Dock 不会自动加圆角；若要系统惯例的圆角外形，给底色矩形加 `rx="92"`（512 画布下约 18%）即可。
