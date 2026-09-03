# 设计规范 — TDC Design System（Dither Art Tool 适用版）

> 来源：Figma 文件「TDC-Claude-DS」(fileKey `71MeCXEWS64hrArHt0Vpdz`)
> - Token 规范：画板「元素样式整理」 node `1:20759`
> - 页面参照：画板「home」 node `1:2032`（1920×992，左配置面板 + 右预览的双栏工具页）
> 
> **给 Claude 的指令：写任何 UI 代码前先读本文档。所有样式只允许引用 `tokens.css` 中的 `--tda-*` 变量，禁止裸色值 / 裸字号 / 裸圆角。零外部请求（字体用本机字体栈，不引 CDN / web font）。需要某个具体界面的细节时，用 Figma MCP 读对应 node，不要凭印象画。**

## 1. 整体气质

浅色、留白多、极低对比的灰阶层级。整套 UI 只有一种"墨色" `#11192D`，所有次级文字、描边、填充都是它的不同透明度；唯一的强调色是橙 `#FF6200`，但**极少使用**——参照页面里连主按钮都是墨色实心，而不是橙色。圆角偏大（控件 10–12px，容器 12–18px），描边极淡（8% 墨色），几乎不用阴影。中文 PingFang SC、西文/数字 Inter、代码 Roboto Mono 严格分工。

一句话：**像一张干净的白纸上放了几个圆角控件，层级靠透明度和留白而不是颜色和线条。**

## 2. Token 总表

### 2.1 字体

| 令牌 | 字体 | 用途 | 强制规则 |
|---|---|---|---|
| `tda-font-family-base` | PingFang SC | 所有中文 | 仅用于中文；禁止用于西文、数字 |
| `tda-font-family-latin` | Inter | 所有西文、数字 | 仅用于西文和数字；禁止用于中文 |
| `tda-font-family-code` | Roboto Mono | 所有代码、代码块、行内代码 | 仅用于代码字符串；禁止用于普通段落 |

实现：`tokens.css` 里用本机字体栈（`"Inter", "PingFang SC", -apple-system, …`）实现"西文优先命中 Inter、中文落到 PingFang"的混排，**不引入 web font**。macOS 上两者都自带；web 端若目标机没有 Inter，回退到系统西文即可。

### 2.2 字号（字号 / 行高 / 段距）

| 令牌 | 值 | 用途 | 强制规则 |
|---|---|---|---|
| `tda-typography-title-2xl` | 26 / 40 / – | 文档标题、标签栏字号 | 仅用于页面或文档最高层级标题；禁止用于普通模块，禁止同页大量使用 |
| `tda-typography-heading-xl` | 22 / 34 / – | 栏目标题·特大 | 仅用于 # H1 |
| `tda-typography-heading-lg` | 20 / 30 / – | 栏目标题·大 | 仅用于 ## H2 |
| `tda-typography-heading-md` | 18 / 28 / – | 栏目标题·中 | 仅用于 ### H3 |
| `tda-typography-heading-sm` | 16 / 26 / – | 栏目标题·小 | 仅用于 #### H4 |
| `tda-typography-body-md` | 16 / 26 / 16 | 正文 | 正文、无序/有序列表 |
| `tda-typography-body-sm` | 14 / 22 / 12 | 表格文字、辅助文案 | 表格、辅助文案、说明信息、次要内容 |
| `tda-typography-label` | 12 / 12 / – | 注释说明、行内代码 | 仅用于说明性文案；禁止用于段落或重要信息 |

参照页面实际用量：**14/22 是绝对主力**（控件、表格、说明文字全部是它），16/26–28 用于 tab 和分区标题，32/40 只用于右侧预览区的大标题。工具类界面基本不需要超过 heading-md。

### 2.3 间距

| 令牌 | 值 | 级别 | 用途 |
|---|---|---|---|
| `tda-spacing-2xs` | 4px | 最小元素间距 | 极小控件内部元素之间；禁止用于段落分隔 |
| `tda-spacing-xs` | 8px | 元素间距 | 同一组件内部的元素分组、紧凑信息之间 |
| `tda-spacing-sm` | 12px | 段落间距 | 正文段落之间、正文与辅助说明之间、表格内信息之间 |
| `tda-spacing-md` | 16px | 模块内分组 | 模块内部不同内容组之间——**常规默认间距** |
| `tda-spacing-lg` | 24px | 独立大模块 | 独立内容模块之间的常规分隔 |
| `tda-spacing-xl` | 32px | 独立大模块 | 页面级内容区域、主次内容区之间的强分隔 |
| `tda-spacing-2xl` | 44px | 独立大模块 | 重要模块、页面主结构之间 |

### 2.4 颜色

| 令牌 | 色值 | 用途 | 强制规则 |
|---|---|---|---|
| `tda-color-brand-primary` | `#FF6200` | 主行动点、选中态、品牌强调、重要文字强化 | 仅用于最重要动作；禁止大面积背景；同页不能过多 |
| `tda-color-brand-secondary` | `#FF62001A` | 次级行动点 | 仅用于强化按钮的选中态；禁止普通卡片背景 |
| `tda-color-text-primary` | `#11192D` | 正文、主文字、图标、按钮文字 | 一级文字；禁止用于次要信息 |
| `tda-color-text-secondary` | `#7C889C` | 副标题、次级文案 | 二级文字；仅强调信息，小范围使用 |
| `tda-color-text-tertiary` | `#11192D4C` | 标签、描述、说明性文字 | 三级文字；禁止大段正文 |
| `tda-color-text-disabled` | `#11192D33` | 注脚、置灰文案 | 四级文字；禁止用于可点击文字 |
| `tda-color-control-strong` | `#11192D14` | 卡片底色、轻量按钮按下态 | 较强层级填充 |
| `tda-color-control-muted` | `#11192D0D` | 轻量按钮悬停态、无底按钮按下态 | 中弱层级填充 |
| `tda-color-control-subtle` | `#11192D08` | 轻量按钮底色、无底按钮悬停态 | 最弱层级填充 |
| `tda-color-white` | `#FFFFFF` | 卡片、面板、弹窗、列表背景、文字反色 | 禁止用于页面底色 |
| `tda-color-background-page` | `#F9F9F9` | 页面底色 | 仅用于页面底色 |
| `tda-color-success` | `#53CD72` | 成功、增长、通过 | 仅正向反馈语义 |
| `tda-color-danger` | `#FF0011` | 删除、失败、驳回、下降 | 仅危险操作需二次确认时；禁止常态强调 |
| `tda-color-link` | `#004AB8` | Markdown 链接、代码编辑链接 | 仅用于链接 |

描边：`--tda-color-border` = `#11192D14`（8% 墨色）。Figma 变量「描边」和参照页面实测都是 8%；token 表文字把"描边"写在 control-muted (5%) 下面，属于表内不一致，**以实测 8% 为准**。

### 2.5 圆角

| 令牌 | 值 | 用途 | 强制规则 |
|---|---|---|---|
| `tda-radius-none` | 0 | 分割线、表格边界 | 不得用于按钮、弹窗、卡片 |
| `tda-radius-xs` | 4px | 缩略图内部层、行内代码 | 低频；仅小尺寸/内层元素 |
| `tda-radius-sm` | 8px | 提示、超小按钮 | 低频 |
| `tda-radius-md` | 10px | 按钮、输入框、列表项、图标按钮 | 高频；与 18px 嵌套时保持内外比例 |
| `tda-radius-lg` | 18px | 浮窗、弹窗、模态 | 高频；禁止用于容器预览 |
| `tda-radius-xl` | 22px | 文件预览容器、全屏预览弹窗 | 低频 |
| `tda-radius-full` | 9999px | 头像、圆形按钮、单选多选框 | 仅完全圆角组件 |

注意：参照页面「home」实际把按钮/下拉画成 **12px**、表格容器 12–16px，比 token 表大 2px。**默认按 token 表（md=10 / lg=18）**；如果视觉上想更贴近该页，可整体把 `--tda-radius-md` 改为 12px，但只改变量，不改组件。

## 3. 参照页面「home」的布局与组件写法（node 1:2032）

这一页就是 Dither Art Tool 的骨架原型：**左边参数面板，右边预览画布**。以下数值全部来自 Figma 导出代码，可直接照抄。

### 3.1 页面骨架

```
┌──────────────────────── 顶栏 58px，白底，底边 1px border ────────────────────────┐
│ [18px app icon] 文字系统生成 (14/26 Medium)                        [40px 图标按钮] │
├──────────────────── 左面板 白底，右边 1px border，padding-x 46px ───┬── 右面板 #F9F9F9 ─┤
│ tabs(创建/历史/介绍) …………………………… [新建][保存][● 导出]  py 20px │ 内容列 max-w 720   │
│ 4 列 grid 下拉，gap 16×16                                          │ tab 行 h 80px      │
│ ─ 48px ─                                                           │ 预览块之间 gap 72  │
│ 语言 tabs h 48，选中项 1px 底线                                     │                    │
│ ─ 36px ─                                                           │                    │
│ 分区：标题 16/24 SemiBold + 说明 14/22 tertiary + 表格             │                    │
└────────────────────────────────────────────────────────────────────┴────────────────────┘
```

- 顶栏：`height 58px; padding 0 9px; background white; border-bottom 1px var(--tda-color-border)`。标题块左内距 11px，图标 18×18 与标题间距 8px。右侧图标按钮 40×40、圆角 `radius-md`，无底色。
- 左右两栏都是 `flex: 1 0 0`（各占一半），各自 `padding: 0 46px`。左栏白底、`border-right 1px var(--tda-color-border)`；右栏 `--tda-color-background-page`，内容居中、`max-width 720px`、纵向滚动。
- 左栏顶部操作行 `padding: 20px 0`；下方内容 `padding-top 12px`，大块之间 `gap 48px`，分区之间 `gap 36px`，分区内部 `gap 16px`。

对 Dither Art Tool 的映射：左栏 = 参数面板（算法选择、调色板、尺寸、导出），右栏 = 画布预览（原图 / 结果切换 tab 放在 80px 高的 tab 行）。

### 3.2 按钮

主按钮（参照页面里"导出 Figma / 代码"）——**墨色实心，不是橙色**：
```css
.tda-btn-primary {
  height: var(--tda-control-height);          /* 40px */
  padding: 0 var(--tda-control-padding-x);   /* 16px */
  border-radius: var(--tda-radius-md);
  background: var(--tda-color-text-primary);
  color: var(--tda-color-white);
  font-size: 14px; line-height: 14px; font-weight: 400;
  display: inline-flex; align-items: center; gap: 6px; border: 0;
}
```
次按钮（"新建""保存"）——透明底 + 8% 描边：
```css
.tda-btn-secondary {
  height: var(--tda-control-height);
  padding: 0 var(--tda-control-padding-x);
  border-radius: var(--tda-radius-md);
  background: transparent;
  border: 1px solid var(--tda-color-border);
  color: var(--tda-color-text-primary);
  font-size: 14px; line-height: 14px;
  display: inline-flex; align-items: center; gap: var(--tda-spacing-xs);
}
.tda-btn-secondary:hover  { background: var(--tda-color-control-subtle); }
.tda-btn-secondary:active { background: var(--tda-color-control-muted); }
```
按钮组之间 12px。橙色 `brand-primary` 只留给"当前选中"或页面里唯一最重要的动作（例如选中的算法卡片的描边/文字），不要做整块按钮底色。

### 3.3 下拉 / 输入框（selector）

```css
.tda-select {
  height: var(--tda-control-height);           /* 40px */
  padding: 6px var(--tda-control-padding-x);
  border-radius: var(--tda-radius-md);
  background: var(--tda-color-white);
  border: 1px solid var(--tda-color-border);
  display: flex; align-items: center; gap: var(--tda-spacing-xs);
}
.tda-select__label { width: 58px; flex: none; color: var(--tda-color-text-tertiary); font-size: 14px; line-height: 22px; }
.tda-select__value { flex: 1; min-width: 0; color: var(--tda-color-text-primary); font-size: 14px; line-height: 22px;
                     overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tda-select__chevron { width: 12px; height: 12px; }
```
关键特征：**标签和值在同一行、同一个框里**（"预设模板  通用 ⌄"），标签淡、值深，标签固定 58px 宽。多个控件排成 4 列 grid、`gap 16px 16px`。Dither 工具的参数（算法、色板、缩放、阈值…）都用这个形态，滑块类参数也应保持 40px 高、同样描边和圆角。

### 3.4 Tab

两种：
- 无下划线 tab（顶部"创建/历史/介绍"、右栏"桌面端/移动端"）：16px，`gap 24px`，选中 = Medium + text-primary，未选 = Regular + text-tertiary。
- 下划线 tab（语言 tab）：高 48px，`gap 24px`，选中项 `border-bottom 1px solid var(--tda-color-text-primary)`，文字 16/26 Medium；未选 Regular，颜色仍是 text-primary（只靠字重区分）。

### 3.5 分区标题 + 说明

标题 `Inter 600 16px/24px` text-primary，右侧可跟 16px 图标（gap 12px）；下面一段说明文字 `14/22` text-tertiary，整宽换行；标题与内容 gap 16px。

### 3.6 表格

容器 `background white; border 1px var(--tda-color-border); border-radius 12–16px; overflow hidden`。表头行 40–44px，文字 14/22 text-tertiary，无底色；表头与表体之间 1px 描边线；表体行 44px，单元格 `padding 12px`，文字 14/22 text-primary，**行与行之间没有分割线、没有斑马纹**。数字列用 Inter。

### 3.7 图标

线性图标，16px（行内）/ 18px（顶栏）/ 12px（chevron），颜色跟随文字色。工具内自绘 SVG 即可，`stroke: currentColor; stroke-width 1.5`。

## 4. 应用到 Dither Art Tool 的约定

1. 页面底色 `background-page`，所有面板/卡片白底；不用深色模式（Figma 只有浅色）。
2. 层级靠透明度墨色（tertiary/disabled/control-*）和留白，不靠彩色和粗线。
3. 橙色只做"选中态"和唯一主动作的强调，成功/危险色只做语义反馈。
4. 控件统一 40px 高、`radius-md`、8% 描边；hover 用 control-subtle、active 用 control-muted。
5. 字号只用 token 表里的 8 档，工具界面主力是 body-sm (14/22)。
6. 画布预览区放右栏，背景 `background-page`，图片容器用 `radius-xl`(22px) 或 `radius-lg`；像素画布本身用 `image-rendering: pixelated`，这不影响外框风格。
7. 字体不引外链；`tokens.css` 的字体栈已经处理好中西文分工。

## 5. 怎么让 Claude 持续用这套风格

- 本文档在 Project 里，每个会话写 UI 前会先读。
- `tokens.css` 是代码里的唯一样式来源，放在前端根目录，所有组件 `var(--tda-*)`。
- 需要还原某个具体界面（例如弹窗、导出面板）时，把该画板的 Figma 链接（带 node-id）发给 Claude，它会用 `get_design_context` 读精确数值，再映射回 `--tda-*` 变量。
- Figma 里改了 token 后，让 Claude 重新读 `1:20759` 并同步 `tokens.css` 即可。
