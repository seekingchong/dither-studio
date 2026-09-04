import { PARAM_SCHEMA } from './schema';

/**
 * 参数解读：鼠标停在参数标签上弹出的浮层内容。
 *
 * 写作规范（改文案前先读一遍）：
 * - summary 必有，一句话说清它改变画面里的什么，用眼睛看得见的词，别写"用于设置 XX"。
 * - options 只在该参数是枚举时写，逐个值说清"长什么样 + 什么时候选"，键是 schema 里的 option value。
 *   选项 ≤ INLINE_OPTIONS_MAX 个时整表列在属性浮层里；更多的只在下拉展开后逐行显示。
 * - tip 可选，一条，写默认值、常见坑或要和谁一起调。
 * - 不讲数学。可以说"高质量重采样"，不要说"加窗 sinc 卷积"。
 * - 文案可以随标签改，id 不能改：它是 schema 主键，也是 docs/PARAM_HELP.md 的锚点。
 */
export interface ParamHelp {
  summary: string;
  /** option value → 解读 */
  options?: Readonly<Record<string, string>>;
  tip?: string;
}

/** 选项多于这个数就不在属性浮层里列表，改由下拉的选项行逐条解读 */
export const INLINE_OPTIONS_MAX = 8;

export const PARAM_HELP: Readonly<Record<string, ParamHelp>> = {
  // ---------- 画布 ----------
  'canvas.width': {
    summary: '画布宽度，也是导出宽度，与原图分辨率无关。16–8192px，默认 1000。',
    tip: '放大画布不会让颗粒变细，颗粒粗细只由像素尺寸决定。',
  },
  'canvas.height': {
    summary: '画布高度，也是导出高度。16–8192px，默认 600。',
  },
  'canvas.fit': {
    summary: '源图怎么放进画布。',
    options: {
      contain: '完整放进去，比例不同会留边',
      cover: '铺满画布，超出的部分裁掉',
      fill: '拉伸铺满，会变形',
      native: '按原始像素摆放，不缩放',
    },
  },

  // ---------- 像素化 ----------
  'pixel.size': {
    summary: '降采样倍率，决定颗粒粗细。填 4 就是每 4×4 个原像素合成一个抖动点。1–64，默认 4。',
    tip: '这是颗粒粗细的唯一来源，下面的降采样和偏移都不改变粗细。',
  },
  'pixel.method': {
    summary: '缩小时，一格里那些原像素怎么合成一个值。',
    options: {
      box: '格内取平均。最稳最干净，照片的安全选择',
      bilinear: '加权插值，比 Box 略软，倍率大时容易糊',
      lanczos: '高质量重采样，保边最好、细节最多，高对比边缘可能有轻微光晕',
      nearest: '只取一个像素，其余全丢。最锐，但会丢细节、视频会闪',
    },
    tip: '照片用 Box 或 Lanczos，像素图和线稿用最近邻，视频求稳用 Box。',
  },
  'pixel.offsetX': {
    summary: '像素网格相对原图左右挪多少，挪的是不足一格的相位。0–63，默认 0。',
    tip: '用来让细节不被网格劈成两半，也能错开画面自身纹理造成的摩尔纹。',
  },
  'pixel.offsetY': {
    summary: '像素网格上下挪多少，同样是不足一格的相位。0–63，默认 0。',
  },

  // ---------- 影调 ----------
  'tone.threshold': {
    summary: '量化前给亮度加的固定偏置，等于整体调节黑白点的比例。0–255，默认 128。',
    tip: '1-bit 下最重要的创意滑块，也用来补偿有序抖动整体偏亮。',
  },
  'tone.invert': {
    summary: '明暗对调。白底黑点变成黑底白点，气质完全不同。',
  },
  'tone.auto': {
    summary: '按直方图自动拉伸色阶，并加一点对比和锐化，让抖动纹理更干净。',
    tip: '先打开看效果，再手动微调下面的参数。',
  },
  'tone.brightness': {
    summary: '整体提亮或压暗。−100 到 100，默认 0。',
    tip: '抖动只认亮度，这一档直接决定画面里黑白点的多少。',
  },
  'tone.contrast': {
    summary: '拉开明暗差距。往上层次变少但更有力，往下灰度更连续、颗粒更均匀。',
  },
  'tone.shadows': {
    summary: '只动最暗的一段。往上提能救回暗部细节，往下压能让黑更实。',
  },
  'tone.midtones': {
    summary: '只动不亮不暗的那一段。人脸、皮肤、墙面主要落在这里。',
    tip: '画面"脏不脏"多半是这一档的事。',
  },
  'tone.highlights': {
    summary: '只动最亮的一段。抖动前压一点，能避免亮部大片全白丢结构。',
  },
  'tone.saturation': {
    summary: '颜色的浓淡。单色和灰阶模式下看不出来，Palette 和 Channels 下明显。',
  },
  'tone.blur': {
    summary: '抖动前先做高斯模糊，压掉高频细节让颗粒更干净。0–100px，默认 0。',
  },
  'tone.sharpen': {
    summary: '加强边缘，让 1-bit 输出仍保得住结构。过量会在边上镶一圈黑白边。',
  },
  'tone.denoise': {
    summary: '抹掉照片本身的噪点。不去的话相机噪点会被抖动放大成满屏杂点。',
  },
  'tone.noise': {
    summary: '主动加噪点。少量噪点能打散有序网格的规律，让渐变不出色带。',
  },
  'tone.noiseType': {
    summary: '加什么样的噪点。',
    options: {
      gaussian: '中间多两头少，最自然，像胶片',
      uniform: '各档一样多，颗粒更均匀更平',
      blue: '分布均匀但无规律，最不显脏',
      'salt-pepper': '零星纯黑纯白点，故障和老照片感',
    },
  },
  'tone.noiseSeed': {
    summary: '决定这次噪点的具体样子。同一个种子每次出图完全一样。',
    tip: '视频里换种子会让画面逐帧闪烁，要稳定就锁死。',
  },
  'tone.outline': {
    summary: '抖动前把边缘单独提出来叠成线条，让主体轮廓在颗粒里不被吃掉。',
  },
  'tone.outlineThreshold': {
    summary: '多强的边缘才算数。调高只留主要轮廓，调低连细纹理也描。',
  },
  'tone.bg.enabled': {
    summary: '把干净的背景换成一片规则的点，前景和高光原样保留，深底浅底都行。',
    tip: '背景要和画面边缘相连、颜色单一，淡渐变和轻微光影没关系。',
  },
  'tone.bg.density': {
    summary: '背景里带点的格子比例。0–100%，默认 25。',
    tip: 'Bayer 2×2 只有 0 / 25 / 50 / 75 / 100 五档，矩阵越大档位越细。',
  },
  'tone.bg.polarity': {
    summary: '背景上的点是暗点还是亮点。',
    options: {
      auto: '按背景亮度自动：亮底放暗点，暗底放亮点',
      light: '亮底暗点：背景当作纸色，点用墨色',
      dark: '暗底亮点：背景当作墨色，点用纸色',
    },
    tip: '中灰背景自动判断可能摇摆，锁定一个就稳了。',
  },
  'tone.bg.strength': {
    summary: '背景被铺平的程度。100 完全平坦、点最规则，低一些保留原有渐变和影子。0–100%。',
  },
  'tone.bg.margin': {
    summary: '前景四周留几格不放点，主体边缘更干净。0–8 格，默认 0。',
  },
  'tone.bg.reference': {
    summary: '背景是什么颜色，用来判断哪些格子算背景。',
    options: {
      auto: '每帧取画面边缘的中位色，干净背景下够稳',
      manual: '手动指定，视频里背景闪动时更稳',
    },
  },
  'tone.bg.color': {
    summary: '手动指定的背景颜色，按原片里的颜色选。',
  },
  'tone.bg.tolerance': {
    summary: '与背景色差多少以内还算背景。0–100%，默认 30。',
    tip: '主体和背景颜色接近时调小，背景渐变大时调大。',
  },
  'tone.bg.smooth': {
    summary: '相邻格子之间允许的颜色跳变，决定蒙版能否顺着渐变生长。默认 6。',
    tip: '主体边缘柔和、被误算成背景时调小。',
  },
  'tone.bg.scope': {
    summary: '哪些格子算背景。',
    options: {
      connected: '与画面边缘相连的同色区域，主体上的同色高光不算',
      all: '全图同色都算，能盖到主体镂空处，但高光也会中招',
    },
  },
  'tone.linear': {
    summary: '在线性光里量化，抖动后的平均亮度与原图一致；关掉则在 gamma 空间量化，中间调更亮。',
    tip: '想还原老软件那种偏亮的味道就关掉它。',
  },
  'tone.grayFormula': {
    summary: '彩色怎么折算成一个亮度值——各公式对红绿蓝的重视程度不同。',
    options: {
      bt709: '现代标准，最接近人眼感受。默认',
      bt601: '老电视标准，红和绿更重，肤色更亮',
      average: '三通道简单平均，蓝色会偏亮',
      red: '只看红通道，像加了红滤镜的黑白片',
      green: '只看绿通道，细节通常最扎实',
      blue: '只看蓝通道，噪点最多、最粗糙',
      max: '取最亮的通道，饱和色全部变亮',
    },
  },

  // ---------- 抖动算法 ----------
  'dither.family': {
    summary: '用什么手法把连续的灰度变成有限的几种颜色——整张图风格的最大来源。',
    options: {
      threshold: '一刀切黑白，最硬、最干净，细节最少',
      noise: '用随机噪声当分界线，颗粒自然、无规律',
      ordered: '固定网格反复平铺，规律感强，复古电脑味',
      halftone: '印刷网点，暗处点大亮处点小',
      'error-diffusion': '把误差推给邻居，细节保留最好，最常用',
      curve: '误差沿填充曲线走，颗粒没有方向感',
      search: '反复求最优点位，质量最高、最慢',
      pattern: '用棋盘、线条等现成图案代替网点',
    },
    tip: '不知道选什么就用误差扩散 + Floyd–Steinberg。',
  },
  'dither.threshold.method': {
    summary: '这条黑白分界线怎么定。',
    options: {
      fixed: '全图用同一个阈值，最硬最可控',
      otsu: '自动找一条让黑白分得最开的线，曝光不均时省心',
      adaptive: '跟周围的平均亮度比，能救大光比暗部，平坦区会长噪点',
    },
  },
  'dither.threshold.radius': {
    summary: '自适应阈值参考多大范围的邻居。小则贴合局部细节，大则接近固定阈值。',
  },
  'dither.threshold.offset': {
    summary: '在局部平均值上再加一点偏置。往正调更黑，往负调更白。',
  },
  'dither.noise.type': {
    summary: '拿什么噪声当分界线，决定颗粒的"随机质感"。',
    options: {
      blue: '随机但分布均匀，最不显规律，像高级砂纸。静态图首选',
      white: '纯随机，颗粒扎堆，脏、糙、老电视味',
      ign: '廉价的近似蓝噪声，逐帧稳定，视频不闪',
      perlin: '自带云雾状起伏，出来是有机斑块而不是均匀砂粒',
    },
  },
  'dither.noise.amplitude': {
    summary: '噪声的强弱。0–200%，默认 100。太小接近固定阈值，太大画面发糊发脏。',
  },
  'dither.noise.scale': {
    summary: '噪声颗粒的大小。数值越大斑块越粗、越有云雾感。',
  },
  'dither.noise.seed': {
    summary: '决定这次随机的具体样子。同一个种子每次出图完全一样。',
    tip: '做视频时锁死种子，否则画面会逐帧闪。',
  },
  'dither.ordered.matrix': {
    summary: '平铺的那张阈值网格长什么样。格子越大层次越多、规律越弱。',
    options: {
      bayer2: '格子最粗，层次最少，最强的复古电脑味',
      bayer3: '奇数格，纹理比 2×2 更碎、更不规则',
      bayer4: '粗细适中，规律仍清晰可见',
      bayer8: '万金油，层次够多、规律不刺眼',
      bayer16: '网格更细，接近连续调',
      bayer32: '层次最多，规律几乎看不见',
      cluster4: '同格的点抱团成大点，报纸印刷感',
      cluster8: '团更大更稀，抗油墨扩散，适合真要印的稿',
      nonrect: '打破正方网格，出斜向纹理',
      centerwhite: '每格中心留白，暗部像撒了细亮点',
      diagonal: '强烈的对角线纹理',
      circle5: '圆形聚簇点，最接近传统印刷网点',
      circle6: '圆点更大一档，网点感更重',
      circle7: '最大的圆点，层次最少最粗犷',
    },
  },
  'dither.ordered.scale': {
    summary: '把网格整体放大几倍。1 是原始大小，放大后格子肉眼可见，像素味更重。',
  },
  'dither.ordered.angle': {
    summary: '把网格整体旋转。0–180°，默认 0。',
    tip: '转 15–45° 能避开画面自身横竖纹理造成的摩尔纹。',
  },
  'dither.ordered.offsetX': {
    summary: '网格左右平移，用来错开网点和主体的位置关系。',
  },
  'dither.ordered.offsetY': {
    summary: '网格上下平移，多张图想让网格不同相时用。',
  },
  'dither.halftone.shape': {
    summary: '每一个印刷网点的轮廓。',
    options: {
      round: '最经典的印刷网点，暗部圆点变大',
      euclidean: '亮部圆点、暗部翻成圆孔，中间调最平滑',
      line: '网点拉成线条，铜版画、丝网感',
      diamond: '45° 尖角，颗粒锐利',
      cosine: '波浪形起伏，柔和',
      square: '硬边方块，像素感最强',
      ellipse: '拉长的网点，方向性强',
      cross: '网点带四条臂，暗部会连成网',
      star: '尖角向外，暗部纹理最花',
      hexagon: '蜂窝排布，横竖规律最弱',
    },
  },
  'dither.halftone.period': {
    summary: '两个网点之间的距离，也就是网线的粗细。越大网点越大越稀，报纸感越强。',
  },
  'dither.halftone.angle': {
    summary: '整片网点的倾斜角。默认 45°，传统印刷用这个角度最不刺眼。',
  },
  'dither.halftone.gain': {
    summary: '模拟油墨在纸上晕开，网点整体变胖。往上调整体变暗变糊。',
    tip: '做印刷味的关键一档，配合网点周期一起调。',
  },
  'dither.halftone.gooey': {
    summary: '相邻网点靠近时是否粘成一团。0 是各是各的，往上调会连成有机的流动形状。',
  },
  'dither.halftone.invert': {
    summary: '把网点和空白对调，暗部变成挖空的孔。',
  },
  'dither.ed.kernel': {
    summary: '误差按什么比例分给邻居——同族之间差在颗粒粗细、拖尾纹路和速度。',
    options: {
      'floyd-steinberg': '最常用，细节保留好、颗粒细。不知道选什么就选它',
      atkinson: '只扩散四分之三误差，对比更强、亮部更白，经典 Mac 味',
      jjn: '扩散范围大，最平滑，但慢、边缘偏虚',
      stucki: 'JJN 的清晰版，平滑又不糊',
      burkes: 'Stucki 去掉一行，更快，风格接近',
      sierra3: '平滑度接近 Stucki，速度略快',
      sierra2: '更快，颗粒略粗',
      'sierra-lite': '最简最快，颗粒最粗',
      'stevenson-arce': '菱形排布，颗粒像细密斜纹',
      'false-fs': '只有三个方向，会留明显拖尾，故意的粗糙感',
      ostromoukhov: '系数随亮度变，专治亮暗两头的"蠕虫"纹路',
      'zhou-fang': '变系数加抖动，极亮极暗最干净',
      'shiau-fan': '压住向右下的拖尾，边缘更利落',
      custom: '自己填扩散比例表，纹理完全自定',
    },
  },
  'dither.ed.strength': {
    summary: '有多少误差被推给邻居。0–100%，默认 100。',
    tip: '往下调颗粒变碎、对比变强，一路调到 0 就等于纯阈值。',
  },
  'dither.ed.serpentine': {
    summary: '一行往右、下一行往左地走，消掉误差扩散常见的斜向拖尾条纹。',
    tip: '一般保持开启，除非你就是要那条纹路。',
  },
  'dither.ed.clamp': {
    summary: '单个像素允许携带的最大误差，100% 为不截断。',
    tip: '调低能压掉极亮极暗处成串的"蠕虫"纹路。',
  },
  'dither.ed.direction': {
    summary: '从哪个角开始扫。误差顺着扫描方向流，换方向就换了拖尾的朝向。',
    options: {
      ltr: '从左上开始逐行向右，最常规',
      rtl: '从右上开始逐行向左，拖尾镜像',
      ttb: '按列从上往下，拖尾变成竖向',
      btt: '按列从下往上，暗部堆在上方',
    },
  },
  'dither.ed.custom': {
    summary: '自己填误差分给邻居的比例表：X 标记当前像素，每行一排，末尾可写 /16 指定除数。',
    tip: '改这个等于发明一个新算法，纹理完全自定。',
  },
  'dither.ed.seed': {
    summary: 'Zhou–Fang 的抖动种子。同一个种子结果可复现。',
  },
  'dither.curve.type': {
    summary: '误差沿哪条填充曲线传播，决定颗粒的走向。',
    options: {
      hilbert: '希尔伯特曲线，颗粒各向同性、没有扫描方向感',
      peano: '走向更竖直，纹理成条',
      gosper: '六边形味的走向，颗粒最有机',
      fass: '折返更密，颗粒最细碎',
    },
  },
  'dither.curve.history': {
    summary: '记住最近多少个像素的误差。记得越久越平滑，越短颗粒越硬。',
  },
  'dither.curve.ratio': {
    summary: '最新误差与最旧误差的权重比。比值越大，越只看眼前。',
  },
  'dither.curve.strength': {
    summary: '有多少误差沿曲线传下去。往下调对比更强、颗粒更碎。',
  },
  'dither.search.method': {
    summary: '按什么策略挑点位。',
    options: {
      knuth: '按重要性顺序落点，介于有序和误差扩散之间',
      lippens: 'Knuth 的改良排序，暗部更均匀',
      dbs: '反复搜索最优点位，质量最高、最慢，适合定稿导出',
    },
  },
  'dither.search.strength': {
    summary: '点扩散时有多少误差参与分配。往下调颗粒更碎。',
  },
  'dither.search.iterations': {
    summary: 'DBS 反复优化几轮。每多一轮更干净，也更慢。',
    tip: '预览用 1–2 轮，导出前再调高。',
  },
  'dither.search.sigma': {
    summary: 'DBS 判断"看起来像不像"时用的视觉模糊半径。大则更看整体，小则更抠细节。',
  },
  'dither.pattern.type': {
    summary: '用哪种现成图案代替网点——图案本身就是风格。',
    options: {
      checker: '两色交错，50% 灰最标准',
      hlines: '横向线条，像百叶窗',
      vlines: '竖向线条',
      diagonal: '45° 线条，动感最强',
      cross: '双向线条，像素描的排线',
      brick: '错缝排布，有砌体感',
      spiral: '从中心旋出，暗部收紧',
      hexagon: '蜂窝平铺，横竖规律最弱',
      sine: '波纹起伏，水波和干扰条纹感',
    },
  },
  'dither.pattern.scale': {
    summary: '图案本身多大。越大越像装饰底纹，越小越接近普通网点。',
  },
  'dither.pattern.angle': {
    summary: '把图案整体旋转。斜一点通常比正着好看，也更不容易和画面撞纹。',
  },

  // ---------- 网格渲染 ----------
  'grid.dot': {
    summary: '每个像素格最终画成什么形状。',
    options: {
      square: '实心方块，就是普通像素，最快',
      euclidean: '亮部实心点、暗部空心孔，过渡最自然',
      roundsquare: '亮部圆、暗部方，兼顾柔和与硬朗',
    },
    tip: '像素尺寸越大，形状差异越明显。',
  },
  'grid.invert': {
    summary: '背景改用墨色、网点画亮格子，整体变成黑底白点。',
  },
  'grid.dotSize': {
    summary: '网点相对格子的大小。10–150%，超过 100% 会连成片。',
  },
  'grid.dotTone': {
    summary: '让网点大小跟着明暗变化：暗处点大、亮处点小，更接近真实网版。',
  },
  'grid.metaball': {
    summary: '相邻网点靠近时粘连成一坨，画面从颗粒感变成液体般的有机形状。',
  },
  'grid.metaballRadius': {
    summary: '粘连的作用范围。越大粘得越远，成片的 blob 越多。',
  },
  'grid.gapX': {
    summary: '每一列之间额外留多少空。往上调点会分开、露出背景，像穿孔卡片。',
  },
  'grid.gapY': {
    summary: '每一行之间额外留多少空。和横向间距分开调可以做出横纹或竖纹。',
  },
  'grid.background': {
    summary: '网点下面垫什么。',
    options: {
      none: '不垫，保持纯净',
      lines: '每行或每列一根线，像五线谱、织物、扫描线',
      dots: '每格一个固定图形，和主网点形成双层网格',
    },
    tip: '要看出效果，先把网格间距调开。',
  },
  'grid.lineDirection': {
    summary: '背景线是横着铺还是竖着铺。',
    options: { row: '每行一根，画面偏平静', col: '每列一根，画面偏挺拔' },
  },
  'grid.lineWidth': {
    summary: '背景线的粗细。细线是暗示，粗线会和网点争主次。',
  },
  'grid.bgDotShape': {
    summary: '每个格子里垫的那个图形长什么样。',
    options: { circle: '圆，最柔和', square: '方，和像素同调', diamond: '菱形，斜向感', cross: '十字，像坐标网' },
  },
  'grid.bgDotSize': {
    summary: '垫底图形相对格子的大小。超过网格间距就会连成一片。',
  },
  'grid.bgColor': {
    summary: '背景线或背景图形的颜色。通常取比主色浅一档，别抢眼。',
  },

  // ---------- 特效 ----------
  'effects.stack': {
    summary: '抖动完成后叠加的后处理，按列表顺序依次应用，可加多个、调顺序、临时关掉。',
    tip: '顺序会影响结果：先扭曲再加颗粒，和反过来完全不同。',
  },

  // ---------- 颜色 ----------
  'color.mode': {
    summary: '最终用几种、哪几种颜色来表现画面。',
    options: {
      mono: '纯黑白两色，最硬核的 1-bit',
      gray: '2–16 级灰，层次更多但仍有颗粒',
      tint: '双色调，自定深浅两色。默认（黑白即 1-bit）',
      palette: '量化到一套指定色板，复古机器味',
      channels: 'RGB 或 CMYK 分通道各抖各的，出彩色噪点和套印错位感',
    },
  },
  'color.levels': {
    summary: '把亮度分成几级。2 就是纯黑白，越多层次越细、颗粒越少。',
  },
  'color.tint.dark': {
    summary: '代表暗部的颜色，默认黑。',
  },
  'color.tint.light': {
    summary: '代表亮部的颜色，默认白。',
    tip: '改成米色或纸色就有印刷品的味道。',
  },
  'color.tint.stops': {
    summary: '在暗色和亮色之间插入中间色站点，做成一条渐变映射。',
    tip: '用来做三色、四色的分层配色，留空就是纯双色。',
  },
  'color.palette.preset': {
    summary: '量化到哪一套颜色。选「自定义」可以自己填色号。',
    options: {
      gameboy: '四级绿，初代掌机屏',
      'gameboy-pocket': '四级灰，Pocket 屏',
      cga0: '早期 PC 四色：青、洋红、白',
      cga1: '早期 PC 四色：绿、红、黄',
      ega: 'DOS 时代 16 色，饱和度高',
      c64: 'C64 16 色，偏灰偏柔',
      zx: 'ZX Spectrum 高饱和 15 色，色块感强',
      nes: '红白机调色板，饱和度中等',
      pico8: '现代复古 16 色，配色最讨好',
      db16: '为像素画设计的 16 色，过渡最顺',
      db32: 'DB16 的 32 色版，层次更细',
      apple2: 'Apple II 六色，偏紫绿',
      mac: '纯黑白两色',
      websafe: '216 色，早期网页味',
      gray4: '四级灰，无彩色',
      gray8: '八级灰，过渡更顺',
      gray16: '十六级灰，接近连续调',
      custom: '自己填一串色号',
    },
  },
  'color.palette.custom': {
    summary: '自己的调色板，写 #RRGGBB 列表、空格分隔。',
  },
  'color.mismatch': {
    summary: '先按 N 级亮度抖动，再按索引映射到调色板，N 与色数不同时产生颜色故障。',
    tip: '想要"坏掉的好看"就开它，配合下面的亮度级数 N 调。',
  },
  'color.palette.levels': {
    summary: '错配时先分成几级亮度。和调色板色数差得越远，颜色越乱。',
  },
  'color.channels.space': {
    summary: '分通道抖动用哪套通道。',
    options: { rgb: '屏幕三原色，出彩色噪点', cmyk: '印刷四色，出套印错位感' },
  },
  'color.accent.enabled': {
    summary: '在抖好的画面上再撒一层强调色，加一点跳色而不破坏整体结构。',
  },
  'color.accent.colors': {
    summary: '用哪几种强调色，1–6 色，可写 #FF6200:2 给权重。权重高的出现得多。',
  },
  'color.accent.density': {
    summary: '有多少比例的像素被换成强调色。0–100%，默认 10。',
    tip: '从 2–5% 开始试，超过 20% 就不叫强调了。',
  },
  'color.accent.placement': {
    summary: '强调色撒在哪里。',
    options: {
      random: '均匀撒满，最中性',
      bluenoise: '撒得均匀但不成规律，最耐看',
      level: '只落在指定的明暗层，例如只染高光',
      overflow: '落在抖动误差最大的地方，跟着细节走',
      edge: '只落在轮廓上，像描边高光',
    },
  },
  'color.accent.level': {
    summary: '只染第几级灰。0 是最暗的一层，往上走向高光。',
  },
  'color.accent.target': {
    summary: '染前景、染背景，还是全都染。',
    options: { foreground: '只替换墨色部分', background: '只替换留白部分', all: '两边都替换' },
  },
  'color.accent.spacing': {
    summary: '两个强调点之间至少隔多远，防止扎堆成块。',
  },
  'color.accent.chain': {
    summary: '一个强调点旁边继续长出下一个的概率。调高会连成短线，像笔触。',
  },
  'color.accent.seed': {
    summary: '决定这次强调色的具体落点。同一个种子结果可复现。',
  },
};

/** 特效类型的解读，键是 EffectDef.id */
export const EFFECT_HELP: Readonly<Record<string, ParamHelp>> = {
  scanlines: {
    summary: '加横向暗线，可叠荧光三色条纹和屏幕曲率，模拟显像管。',
    tip: '暗线强度别拉满，会吃掉抖动细节。',
  },
  grain: {
    summary: '在成品上再叠一层噪点。和影调里的噪点不同：那个影响点的分布，这个只盖在表面。',
  },
  jpeg: {
    summary: '随机宏块被前一块覆盖并偏色，模拟压缩数据损坏。',
  },
  blockShift: {
    summary: '整块整块地横向推移，经典的数据故障拉丝。',
  },
  rowShift: {
    summary: '按扫描行错位，像信号不同步的电视。',
  },
  pixelSort: {
    summary: '把亮度落在区间内的连续像素按亮度重排，拉出流动的色带。',
  },
  wave: {
    summary: '按正弦波推移像素，画面像水面一样起伏。',
  },
  barrel: {
    summary: '中间鼓、四角收的桶形畸变，配扫描线就是显像管。',
  },
  scatter: {
    summary: '像素随机小幅位移，边缘变毛，颗粒更松散。',
  },
};

export function getParamHelp(id: string): ParamHelp | undefined {
  return PARAM_HELP[id];
}

export function getOptionHelp(paramId: string, value: string): string | undefined {
  return PARAM_HELP[paramId]?.options?.[value];
}

export function getEffectHelp(effectId: string): ParamHelp | undefined {
  return EFFECT_HELP[effectId];
}

/** 缺解读的参数 id，供测试断言"每个参数都能解释自己" */
export function paramsMissingHelp(): string[] {
  return PARAM_SCHEMA.filter((def) => !PARAM_HELP[def.id]).map((def) => def.id);
}

/** 解读里写了但 schema 里没有的选项值，供测试抓文案与 schema 的漂移 */
export function staleHelpOptions(): string[] {
  const stale: string[] = [];
  for (const def of PARAM_SCHEMA) {
    const options = PARAM_HELP[def.id]?.options;
    if (!options) continue;
    if (def.type !== 'select') {
      stale.push(`${def.id}（不是枚举却写了选项解读）`);
      continue;
    }
    const known = new Set(def.options.map((o) => o.value));
    for (const value of Object.keys(options)) if (!known.has(value)) stale.push(`${def.id}.${value}`);
    for (const o of def.options) if (!(o.value in options)) stale.push(`${def.id}.${o.value}（缺解读）`);
  }
  return stale;
}
