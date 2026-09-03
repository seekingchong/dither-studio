// 入口分发：按构建目标装配对应平台实现。electron.tsx / web.tsx 只做装配，不含业务。
const target = import.meta.env.VITE_TARGET ?? 'web';

if (target === 'electron') {
  void import('./electron');
} else {
  void import('./web');
}
