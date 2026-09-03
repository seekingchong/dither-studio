# 打包资源

`assets/icon/` 是图标母版目录（SVG 母版 + 生成脚本 + 全套产物），改图标去那里改，不要改这里。

- `icon.png`：1024×1024，从 `assets/icon/mac/icon-1024.png` 复制而来，是 electron-builder 在
  `buildResources` 目录下的兜底图标。
- macOS 打包实际用的是 `package.json` 里 `build.mac.icon` 指向的 `assets/icon/icon.icns`
  （含 16→1024 共 10 档，本体按 Apple 图标网格留白）。

重新生成全套：`python3 assets/icon/build-icons.py`，然后 `cp assets/icon/mac/icon-1024.png build/icon.png`。
