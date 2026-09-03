import { createElectronPlatform, createWebPlatform, getBridge } from '@/platform';
import { mount } from './mount';

// Electron 目标：preload 注入了 window.ditherStudio；若在普通浏览器里打开该构建，回退到 web 实现。
const bridge = getBridge();
mount(bridge ? createElectronPlatform(bridge) : createWebPlatform());
