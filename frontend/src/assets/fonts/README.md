# 随包字体

设计规范要求零外部请求，且 macOS 只自带 PingFang SC 与 SF Pro，因此把西文与代码字体随应用打包：

| 文件 | 字体 | 字重 | 协议 |
|---|---|---|---|
| Inter-Regular.woff2 / Inter-Medium.woff2 / Inter-SemiBold.woff2 | Inter 4.1（rsms/inter，`web/` 目录原件） | 400 / 500 / 600 | SIL OFL 1.1，见 LICENSE-Inter.txt |
| RobotoMono-Regular.woff2 | Roboto Mono v31（Google Fonts 拉丁子集） | 400 | Apache License 2.0 |

中文仍走本机 PingFang SC 字体栈，不随包。字体由 `src/styles/fonts.css` 通过 `@font-face` 声明，Vite 构建时带 hash 输出到 `assets/`。
