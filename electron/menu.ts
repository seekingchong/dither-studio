import { app, Menu, type MenuItemConstructorOptions } from 'electron';

/** 菜单动作：主进程只转发，由渲染进程按焦点决定是操作文本框还是操作参数 */
export type MenuAction = 'open' | 'export-png' | 'export-video' | 'copy-png' | 'undo' | 'redo' | 'copy';

/**
 * 应用菜单。撤销 / 重做 / 复制不用 Electron 的 role，否则 macOS 会在原生层截走 Cmd+Z / Cmd+C，
 * 页面里的参数撤销与"复制 PNG"就收不到按键。
 */
export function installMenu(send: (action: MenuAction) => void) {
  const isMac = process.platform === 'darwin';
  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about', label: `关于 ${app.name}` },
            { type: 'separator' },
            { role: 'services', label: '服务' },
            { type: 'separator' },
            { role: 'hide', label: `隐藏 ${app.name}` },
            { role: 'hideOthers', label: '隐藏其他' },
            { role: 'unhide', label: '全部显示' },
            { type: 'separator' },
            { role: 'quit', label: `退出 ${app.name}` },
          ],
        },
      ]
    : [];

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: '文件',
      submenu: [
        { label: '打开…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
        { type: 'separator' },
        { label: '导出 PNG…', accelerator: 'CmdOrCtrl+S', click: () => send('export-png') },
        { label: '导出视频…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('export-video') },
        { label: '复制 PNG', accelerator: 'CmdOrCtrl+Shift+C', click: () => send('copy-png') },
        ...(isMac ? [] : ([{ type: 'separator' }, { role: 'quit', label: '退出' }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', click: () => send('undo') },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('redo') },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', click: () => send('copy') },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    { label: '窗口', role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
