import { create } from 'zustand';

interface UiState {
  exportVideoOpen: boolean;
  setExportVideoOpen(open: boolean): void;
}

/** 跨组件的界面状态（不进撤销栈、不持久化） */
export const useUiStore = create<UiState>((set) => ({
  exportVideoOpen: false,
  setExportVideoOpen: (exportVideoOpen) => set({ exportVideoOpen }),
}));
