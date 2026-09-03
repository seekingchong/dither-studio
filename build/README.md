# 打包资源

- `icon.svg`：应用图标源文件，几何与色值来自设计导出的「APP icon-3.svg」：512 画布、底色 #D7D6D4 且圆角 114（约 22%，四角透明，符合 macOS 图标惯例）、两个 176×176 圆角 48 的 #1D1711 方块位于 (80,80) 与 (256,256)，在画布中心对角相接。文件里的 `viewBox` 未改动，只把 `width`/`height` 设为 1024 以便直接渲染 1024×1024 的 PNG。
- `icon.png`：由 `npm run gen:icon` 从 `icon.svg` 渲染，1024×1024 带透明通道。electron-builder 在 macOS 上会自动转成 `.icns`。
- 换图标只替换 `icon.svg`，再运行 `npm run gen:icon`。图稿若带圆角，渲染脚本的 `omitBackground` 会保留四角透明，不要去掉。
