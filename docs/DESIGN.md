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
  应用内顶栏已删掉；macOS 的 Electron 窗口留一条 36px 的透明可拖动标题条（只给三个圆点让位），它与下面内容之间保留这条 `border-bottom 1px var(--tda-color-border)`。其它平台标题条高度为 0，不画线。
- 左右两栏都是 `flex: 1 0 0`（各占一半），各自 `padding: 0 46px`。左栏白底；右栏 `--tda-color-background-page`，内容居中、`max-width 720px`、纵向滚动。
  两栏之间那条 1px `var(--tda-color-border)` 现在由可拖拽的 `.pane-splitter` 自己画：`width 9px`（= 1px 线 + 两侧各 4px 命中区）、`padding 0 4px`、`background-clip: content-box`、`margin 0 -4px`，布局上仍只占 1px。宽度必须写成含 padding 的 9px——全局是 `box-sizing: border-box`，写 1px 会把 content-box 压成 0，线就画不出来。
- 左栏顶部操作行 `padding: 20px 0`；下方内容 `padding-top 12px`，大块之间 `gap 48px`，分区之间 `gap 36px`，分区内部 `gap 16px`。

对 Dither Studio 的映射：左栏 = 参数面板，右栏 = 画布预览（原图 / 结果切换 tab 放在 80px 高的 tab 行）。

预览画布的圆角按宽度的 **7.2%** 走（宽 100px → 7.2px，宽 500px → 36px），两个页签都有。它是画布 DOM 上的 `border-radius`，
不动像素，所以导出的 PNG / 视频不带圆角。比例跟着屏幕上的实际宽度算，换缩放档位也是同一个观感。

「原图」页的素材卡片底下有一条编辑条：旋转 90°、左右 / 上下镜像、画面裁剪缩放（1×–4×）。
缩放始终等比——放大多少就等比裁掉多少，画面比例不变；放大后直接拖预览挪裁剪窗口。镜像作用在旋转之后的画面上，
跟看到的方向一致。这些变换在送进流水线之前就烤进源帧，所以结果预览、PNG 与视频导出都自动带上；换素材即清空。

视频素材卡片底下还多一条裁剪条：窗长固定 4 秒，左右拖窗口挑用哪四秒（方向键 0.1 秒 / Shift 1 秒微调，
Home / End 到两端）。预览在这个窗口里循环，顶部进度条的 min / max 也跟着窗口走，导出视频只出这一段。
视频短于 4 秒时窗口就是整段，滑不动。

### 素材进出坑位

三条路进：拖拽、⌘/Ctrl + O 打开、⌘/Ctrl + V 粘贴。粘贴走 `paste` 事件而不是 `navigator.clipboard.read()`——
后者要权限、在 Electron 里还得额外配；前者是用户按下 ⌘V 时浏览器直接给的，不用要权限。
访达里复制的文件落在 `clipboardData.files`，网页上「复制图片」只有 `clipboardData.items`（而且是没名字的 blob，
按 MIME 补一个文件名再往下走），两条都认。焦点在输入框里时不接管，那儿要粘的是文字。

出：鼠标移到坑位上，右上角淡出一个清空按钮（`.slot__remove`，藏着的时候连指点事件一起关掉，
不留看不见却能点的按钮），点一下把 `setSlotMedia(i, null)`，位图与 `<video>` 由 `releaseMedia` 释放，
Worker 那边的源帧和最后一帧由 `RendererProvider` 跟着撤。

### 界面预览

双击任一坑位弹出一扇新窗口，里面是 Figma「书庆」文件画板 `tdc home`（node 45:3223）的静态复刻：
左侧导航条 + 技能库侧栏 + 应用详情卡片 + 会话主区，1728×1080 按原尺寸画好之后整体等比缩放到窗口里，
所以任何窗口大小下都与设计稿逐像素一致。整张界面不接任何交互，唯一活的是卡片封面里的 `video cover` 容器
（设计稿 node 45:3247，98.958×59.375，圆角 7.125）——当前坑位的预览画面逐帧贴在那儿，
视频 / GIF 跟着主窗口一起循环播放，主窗口暂停它也停。

两扇窗在 Electron 里是 file:// 的不透明源，互相读不到对方的 DOM，帧只能靠 `postMessage` 传
（`ImageBitmap` 是可转移对象，过去零拷贝）。方向是「预览窗口来要、主窗口才给」：预览窗口按自己的 rAF
节奏要帧（30 fps），主窗口按它要的尺寸把画布缩好再回传。反过来推不行——主窗口被预览窗口盖住时 rAF 会被
节流，画面就会卡住；主进程那边也给两扇窗都关掉了 `backgroundThrottling`。

设计稿里的图标是导出的 SVG 资源，构建环境访问不到 Figma 的资源域名，所以按项目自己的图标画法
（1.5px 线、currentColor）重画了一遍，外框与内容尺寸对齐设计稿。颜色 / 字体全走 `tokens.css` ——
这张画板与本项目用的是同一套 TDC 设计系统，令牌一一对得上。

左栏自上而下三层，顺序固定：

```
┌─ 操作行 py 20px ── [参数|历史] ………………………… [⚙][↺][💾 保存预设] ─┐
├─ 预设模块 ────────────────────────────────────────────────────────────┤
│  预设卡片 4 列 grid + 起名保存 + 当前方案状态                          │  跨全部参数，常驻最上
├─ 参数分节（无 tab）───────────────────────────────────────────────────┤
│  ⌄ 基础     误差扩散 · Floyd–Steinberg · 像素 4        ← 收起时显示摘要 │
│    说明 + 4 列 grid 控件 + 「更多参数」折叠                            │
│  ⌄ 颜色     Tint · 2 级                     ← 紧跟基础：模式就在上面选 │
│  ⌄ 影调     未调整                                                    │
│  ⌄ 网格 / 特效 …                                                      │
└───────────────────────────────────────────────────────────────────────┘
```

- **导出不在左栏**：导出按钮都在预览头「画布」菜单右侧。主按钮按当前坑位的媒体类型换文案与去处——图片是「导出图片」（直接存 PNG），视频 / GIF 是「导出视频」（开导出对话框）；它左边是「导出帧」，把当前帧存成 SVG 矢量图。左栏操作行只剩页签与「设置」。
- **预设在参数之上**：预设改的是全部参数，不从属于任何一节。它与下面的分节之间靠留白分层，不加分割线。
- **保存预设在操作行**：预设模块里不摆输入框——操作行右端「设置」右边是「还原」（只有图标，没微调过时置灰）与「保存预设」，后者点开一个浮层，名称预填成「当前方案 副本」（重名往后排号）并全选，回车即存；当前方案本身是我的预设时，浮层里还能覆盖更新它。
- **卡片最多三行**：超出的折起来，底下一行「还有 N 个 / 收起」。列数由容器查询决定（3 / 2 / 1 列），所以行数要把 `grid-template-columns` 的计算值读回来数轨道。我的预设排在内置方案前面——内置有 11 套，排在后面的话存下来的方案总落在折叠线以下；选中的那张要是被折在下面则整组强制展开。
- **参数不分 tab**：分组 tab（像素化 / 影调 / 抖动算法 / …）已移除。一次只看得见一组、找参数要来回切，且 tab 行与预设模块叠在一起有两层导航。改成整栏一列、每节可折叠：默认只展开「基础」，其余收起时在标题右侧显示当前值摘要（`未调整`、`Tint · 2 级`），不展开也知道里面是什么。
- **顺序**：基础 → 颜色 → 影调 → 网格 → 特效。颜色模式就在「基础」那一排里选，细节紧挨着它才接得上。
- **「基础」= 算法 + 像素化**：算法族、当前族的算法、颜色模式、像素尺寸、降采样这一排原本是 tab 之上的「快捷参数」，tab 拆掉后整排并入「基础」，顺序不变；后面接当前算法族自己的参数，低频项进「更多参数」。
- 分节标题行高 44px，整行可点，hover `control-subtle`；标题 16/26 SemiBold，摘要 14/22 tertiary 右对齐、超长省略。分节默认全部展开、可逐节收起（摘要只在收起时出现）；节与节之间不画线，靠留白分层。
- 每节标题行最右是 32px 的「重置」图标按钮（预设模块也有），把这一节退回**当前方案本身**的值——不是 schema 默认值，跟操作行的「还原」同一把尺子，只是范围缩到一节。收起时也在，不用先展开；这一节没改过就置灰。预设模块的「重置」= 退回「默认」预设。
- 分区内部仍是 4 列 grid、`gap 16×16`，控件一律 40px 高。

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
按钮组之间 12px。参照页面里橙色 `brand-primary` 只留给"当前选中"或页面里唯一最重要的动作，不做整块按钮底色；Dither Studio 不用这条——见 §4 第 3 条，选中态一律走墨色。

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

左栏操作行的页签是「抖动」「排线」「网点」「历史」：前三个是艺术风格，点它等于切 `style.type`；风格页签下方是该风格的预设卡片与参数分节。

两种：
- 无下划线 tab（顶部"创建/历史/介绍"、右栏"桌面端/移动端"）：16px，`gap 24px`，选中 = Medium + text-primary，未选 = Regular + text-tertiary。
- 下划线 tab（语言 tab）：高 48px，`gap 24px`，选中项 `border-bottom 1px solid var(--tda-color-text-primary)`，文字 16/26 Medium；未选 Regular，颜色仍是 text-primary（只靠字重区分）。

### 3.5 分区标题 + 说明

标题 `Inter 600 16px/24px` text-primary，右侧可跟 16px 图标（gap 12px）；下面一段说明文字 `14/22` text-tertiary，整宽换行；标题与内容 gap 16px。

### 3.6 表格

容器 `background white; border 1px var(--tda-color-border); border-radius 12–16px; overflow hidden`。表头行 40–44px，文字 14/22 text-tertiary，无底色；表头与表体之间 1px 描边线；表体行 44px，单元格 `padding 12px`，文字 14/22 text-primary，**行与行之间没有分割线、没有斑马纹**。数字列用 Inter。

### 3.7 图标

线性图标，16px（行内）/ 18px（顶栏）/ 12px（chevron），颜色跟随文字色。工具内自绘 SVG 即可，`stroke: currentColor; stroke-width 1.5`。

### 3.8 参数解读浮层（ParamHelp）

每一个参数标签都可以解释自己。鼠标停在**标签文字**上，出一个浮层讲清楚「这是什么、各个值什么意思、什么时候选」。文案见 `docs/PARAM_HELP.md` 与 `frontend/src/params/help.ts`，这里只定形态和交互。

**触发与消失**

| 场景 | 行为 |
|---|---|
| 指针停在标签上 | 400ms 后显示；已经有浮层时移到别的标签立即换内容，不再等待 |
| 指针离开 | 150ms 后隐藏；这段时间内移进浮层则保持显示（浮层里的文字可以选中复制） |
| 键盘 | 焦点在控件上按 `?` 或 `F1` 显示，`Esc` 收起 |
| 触屏 / 无 hover 设备 | 点标签展开，再点收起 |
| 下拉展开时停在某个选项行 | 出**选项级**浮层，只讲这一个值，贴着该行右侧；同时属性级浮层让位 |
| 滚动、改窗口大小 | 直接收起（锚点会移位） |

**规则**

- 热区只有标签文字本身，不含整个控件——否则拖滑块时浮层会一直跟着弹。标签 `cursor: help`，hover 时颜色由 `text-tertiary` 提到 `text-secondary`，不加下划线、不加问号图标（面板里几十个问号是噪音）。
- 浮层贴的是**整个控件**的外侧，不是标签，所以永远不会盖住触发它的那个控件。
- 一次只存在一个浮层，全局一份，由 `helpStore` 持有。
- 浮层里不放按钮和链接，纯文本。
- 不用原生 `title`：延迟不可控、样式不可控、触屏没有。

**视觉**

```css
.tda-help {
  width: 300px;                                   /* 选项级 260px */
  padding: var(--tda-spacing-sm) var(--tda-spacing-md);
  background: var(--tda-color-white);
  border: 1px solid var(--tda-color-border);
  border-radius: var(--tda-radius-lg);            /* 18px，浮窗档 */
  box-shadow: var(--tda-shadow-tile), 0 8px 24px rgba(17, 25, 45, 0.08);
  font: 14px/22px;                                /* body-sm */
}
```

- 结构：参数名（Medium，text-primary）→ 一句话（text-secondary）→ 值列表（值名 Medium + 说明 tertiary，同段接排）→ 分割线 + 提示（tertiary）。
- 位置：默认贴控件右侧、`offset 8px`、顶端对齐；右边放不下翻到左侧，再放不下落到下方并夹在视口内。
- 值列表只在选项 ≤8 个时出现；更多的改为一句「展开下拉后停在某一行上」，由选项级浮层逐条解释。
- 动效：80ms 淡入、无位移；`prefers-reduced-motion` 下直接显示。
- 不用深色底的经典 tooltip——这套设计系统里所有浮层都是白底 8% 描边，深色主题下自动跟随令牌。

## 4. 应用到 Dither Art Tool 的约定

1. 页面底色 `background-page`，所有面板/卡片白底；不用深色模式（Figma 只有浅色）。
2. 层级靠透明度墨色（tertiary/disabled/control-*）和留白，不靠彩色和粗线。
3. 不用品牌橙：选中态与主动作都走 `text-primary` 墨色（选中的卡片是墨色描边，主按钮是墨色实心），成功 / 危险色只做语义反馈。
4. 控件统一 40px 高、`radius-md`、8% 描边；hover 用 control-subtle、active 用 control-muted。
5. 字号只用 token 表里的 8 档，工具界面主力是 body-sm (14/22)。
6. 画布预览区放右栏，背景 `background-page`，图片容器用 `radius-xl`(22px) 或 `radius-lg`；像素画布本身用 `image-rendering: pixelated`，这不影响外框风格。
7. 字体不引外链；`tokens.css` 的字体栈已经处理好中西文分工。

## 5. 怎么让 Claude 持续用这套风格

- 本文档在 Project 里，每个会话写 UI 前会先读。
- `tokens.css` 是代码里的唯一样式来源，放在前端根目录，所有组件 `var(--tda-*)`。
- 需要还原某个具体界面（例如弹窗、导出面板）时，把该画板的 Figma 链接（带 node-id）发给 Claude，它会用 `get_design_context` 读精确数值，再映射回 `--tda-*` 变量。
- Figma 里改了 token 后，让 Claude 重新读 `1:20759` 并同步 `tokens.css` 即可。
