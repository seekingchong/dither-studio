// 生成顶栏"设置"齿轮图标的 SVG path（16×16 viewBox，1.5px 描边）。
// 用法：node scripts/gen-gear-icon.mjs → 把输出贴到 frontend/src/ui/primitives/Icon.tsx 的 GEAR_PATH。
// 6 齿：外径 R、齿根 r、齿顶角宽 TOP、齿侧过渡 FLANK；孔径 HOLE。角度从正上方起，让一颗齿正对上方。
const CX = 8;
const CY = 8;
const TEETH = 6;
const R = 7;
const r = 5;
const HOLE = 2.1;
const TOP = 22; // 齿顶所占角度
const FLANK = 8; // 每侧斜面所占角度
const pitch = 360 / TEETH;
const valley = pitch - TOP - FLANK * 2;
const pt = (deg, rad) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CX + rad * Math.cos(a), CY + rad * Math.sin(a)].map((v) => Number(v.toFixed(2)));
};
const points = [];
for (let k = 0; k < TEETH; k++) {
  const start = k * pitch - TOP / 2;
  points.push(pt(start, R));
  points.push(pt(start + TOP, R));
  points.push(pt(start + TOP + FLANK, r));
  points.push(pt(start + TOP + FLANK + valley, r));
}
const outline = `M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
const hole = `M${CX} ${CY - HOLE}a${HOLE} ${HOLE} 0 1 0 0 ${HOLE * 2}a${HOLE} ${HOLE} 0 1 0 0 ${-HOLE * 2}z`;
console.log(outline + hole);
