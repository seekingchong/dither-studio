import { contextBridge, ipcRenderer } from 'electron';
import type { DitherBridge } from '@/platform/bridge';

const bridge: DitherBridge = {
  platform: process.platform as DitherBridge['platform'],
  files: {
    openMedia: () => ipcRenderer.invoke('files:openMedia'),
    save: (bytes, name, mime) => ipcRenderer.invoke('files:save', bytes, name, mime),
    read: (path) => ipcRenderer.invoke('files:read', path),
    reveal: (path) => ipcRenderer.invoke('files:reveal', path),
  },
  storage: {
    get: (key) => ipcRenderer.invoke('storage:get', key),
    set: (key, value) => ipcRenderer.invoke('storage:set', key, value),
    remove: (key) => ipcRenderer.invoke('storage:remove', key),
  },
  clipboard: {
    writeImage: (png) => ipcRenderer.invoke('clipboard:writeImage', png),
    writeFile: (path) => ipcRenderer.invoke('clipboard:writeFile', path),
  },
  media: {
    convertHeic: (bytes) => ipcRenderer.invoke('media:convertHeic', bytes),
  },
};

contextBridge.exposeInMainWorld('ditherStudio', bridge);
