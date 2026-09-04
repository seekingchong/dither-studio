import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FAMILY_PARAM } from '@/engine';
import { PARAM_SCHEMA, getParamDef, hasParam, isParamVisible, type ParamDef, type ParamGroup } from '@/params';
import { isAnimated, isParamExposed, resolveBase, useStudioStore } from '@/state';
import { ExportVideoDialog } from '@/ui/export/ExportVideoDialog';
import { useExport } from '@/ui/export/useExport';
import { useOpenMedia } from '@/ui/media/useOpenMedia';
import { Button, IconButton, Tabs } from '@/ui/primitives';
import { useUiStore } from '@/ui/state/uiStore';
import { ColorPreview } from './ColorPreview';
import { EffectsEditor } from './EffectsEditor';
import { GROUPS, QUICK_PARAMS } from './groups';
import { HistoryPane } from './HistoryPane';
import { ParamControl } from './ParamControl';
import { PresetPicker } from './PresetPicker';

type PaneTab = 'params' | 'history';

/**
 * 左栏。「参数」页 = 预设模块（选一套方案）+ 在这套方案范围内微调的参数；
 * 「历史」页 = 保存过的所有方案。
 */
export function ParamPane() {
  const params = useStudioStore((s) => s.params);
  // 当前方案的来源预设决定参数面板露出哪些分组 / 参数
  const exposes = useStudioStore(useShallow((s) => resolveBase(s.presetId, s.presets).exposes));
  const [paneTab, setPaneTab] = useState<PaneTab>('params');
  const [group, setGroup] = useState<ParamGroup>('pixel');
  const { openDialog } = useOpenMedia();
  const { canExport, exportPng, copyPng } = useExport();
  const animated = useStudioStore((s) => isAnimated(s.slots[s.view.activeSlot]?.media));
  const { videoDialog, setVideoDialog } = useUiStore(useShallow((s) => ({ videoDialog: s.exportVideoOpen, setVideoDialog: s.setExportVideoOpen })));
  const { canUndo, canRedo, undo, redo } = useStudioStore(
    useShallow((s) => ({ canUndo: s.history.past.length > 0, canRedo: s.history.future.length > 0, undo: s.undo, redo: s.redo })),
  );

  const family = String(params['dither.family']) as keyof typeof FAMILY_PARAM;
  const algorithmParamId = FAMILY_PARAM[family];

  const quickDefs = useMemo(() => {
    const ids = [...QUICK_PARAMS];
    if (algorithmParamId && hasParam(algorithmParamId)) ids.splice(1, 0, algorithmParamId);
    return ids.map((id) => getParamDef(id));
  }, [algorithmParamId]);

  const quickIds = useMemo(() => new Set(quickDefs.map((d) => d.id)), [quickDefs]);

  const groupDefs = useMemo(() => {
    const map = new Map<ParamGroup, { basic: ParamDef[]; advanced: ParamDef[] }>();
    for (const def of PARAM_SCHEMA) {
      if (quickIds.has(def.id) || !isParamExposed(def, exposes) || !isParamVisible(def, params)) continue;
      const entry = map.get(def.group) ?? { basic: [], advanced: [] };
      (def.advanced ? entry.advanced : entry.basic).push(def);
      map.set(def.group, entry);
    }
    return map;
  }, [params, quickIds, exposes]);

  const groupTabs = GROUPS.filter((g) => groupDefs.has(g.id)).map((g) => ({ id: g.id, label: g.label }));
  const activeGroup = groupDefs.has(group) ? group : groupTabs[0]?.id;
  const meta = GROUPS.find((g) => g.id === activeGroup);
  const current = activeGroup ? groupDefs.get(activeGroup) : undefined;

  return (
    <section className="pane pane--params" aria-label="参数面板">
      <div className="pane-actions">
        <Tabs
          items={[
            { id: 'params', label: '参数' },
            { id: 'history', label: '历史' },
          ]}
          value={paneTab}
          onChange={setPaneTab}
        />
        <div className="btn-group">
          <IconButton icon="undo" label="撤销" disabled={!canUndo} onClick={undo} />
          <IconButton icon="redo" label="重做" disabled={!canRedo} onClick={redo} />
          <Button variant="secondary" icon="folder" onClick={() => void openDialog()}>
            打开
          </Button>
          <Button variant="secondary" icon="copy" disabled={!canExport} onClick={() => void copyPng()}>
            复制 PNG
          </Button>
          <Button variant={animated ? 'secondary' : 'primary'} icon="download" disabled={!canExport} onClick={() => void exportPng()}>
            导出 PNG
          </Button>
          {animated && (
            <Button variant="primary" icon="film" disabled={!canExport} onClick={() => setVideoDialog(true)}>
              导出视频
            </Button>
          )}
        </div>
      </div>
      <ExportVideoDialog open={videoDialog} onClose={() => setVideoDialog(false)} />

      <div className="pane-content">
        {paneTab === 'history' && <HistoryPane onApplied={() => setPaneTab('params')} />}
        {paneTab === 'params' && (
          <>
            <PresetPicker />

            <div className="sections" data-testid="params-module">
              <div className="param-grid" data-testid="quick-params">
                {quickDefs.map((def) => (
                  <ParamControl key={def.id} def={def} label={def.id === algorithmParamId ? '算法' : undefined} />
                ))}
              </div>
              {activeGroup && <Tabs variant="underline" items={groupTabs} value={activeGroup} onChange={setGroup} />}
              {meta && current && (
                <section className="section" data-group={meta.id}>
                  <h3 className="section__title">{meta.label}</h3>
                  <p className="section__hint">{meta.hint}</p>
                  {meta.id === 'color' && <ColorPreview />}
                  {meta.id === 'effects' && <EffectsEditor />}
                  {meta.id !== 'effects' && current.basic.length > 0 && (
                    <div className="param-grid">
                      {current.basic.map((def) => (
                        <ParamControl key={def.id} def={def} />
                      ))}
                    </div>
                  )}
                  {current.advanced.length > 0 && (
                    <details className="section__more" open={current.basic.length === 0}>
                      <summary>更多参数</summary>
                      <div className="param-grid">
                        {current.advanced.map((def) => (
                          <ParamControl key={def.id} def={def} />
                        ))}
                      </div>
                    </details>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
