import { useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FAMILY_PARAM } from '@/engine';
import { PARAM_SCHEMA, getParamDef, hasParam, isParamVisible, type ParamDef, type ParamGroup } from '@/params';
import { isAnimated, isParamExposed, resolveBase, useStudioStore } from '@/state';
import { ExportVideoDialog } from '@/ui/export/ExportVideoDialog';
import { useExport } from '@/ui/export/useExport';
import { Button, Tabs } from '@/ui/primitives';
import { useUiStore } from '@/ui/state/uiStore';
import { ColorSwatches } from './ColorSwatches';
import { EffectsEditor } from './EffectsEditor';
import { GROUPS, QUICK_PARAMS } from './groups';
import { HistoryPane } from './HistoryPane';
import { ParamControl } from './ParamControl';
import { PresetPicker } from './PresetPicker';
import { useScrollSpy } from './useScrollSpy';

type PaneTab = 'params' | 'history';

/** 画布尺寸 / 适配放在预览区的「画布」菜单里，不在左栏 */
const HIDDEN_GROUPS: ReadonlySet<ParamGroup> = new Set<ParamGroup>(['canvas']);

/**
 * 左栏。「参数」页 = 预设模块（选一套方案）+ 快捷参数 + 全部分区排成一列（锚点式 tab：点哪个滚到哪个）；
 * 「历史」页 = 保存过的所有方案。打开 / 复制 / 撤销 / 重做只走快捷键与系统菜单，这里不放按钮。
 */
export function ParamPane() {
  const params = useStudioStore((s) => s.params);
  // 当前方案的来源预设决定参数面板露出哪些分组 / 参数
  const exposes = useStudioStore(useShallow((s) => resolveBase(s.presetId, s.presets).exposes));
  const [paneTab, setPaneTab] = useState<PaneTab>('params');
  const { canExport, exportPng } = useExport();
  const animated = useStudioStore((s) => isAnimated(s.slots[s.view.activeSlot]?.media));
  const { videoDialog, setVideoDialog } = useUiStore(useShallow((s) => ({ videoDialog: s.exportVideoOpen, setVideoDialog: s.setExportVideoOpen })));

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
      if (HIDDEN_GROUPS.has(def.group) || quickIds.has(def.id) || !isParamExposed(def, exposes) || !isParamVisible(def, params)) continue;
      const entry = map.get(def.group) ?? { basic: [], advanced: [] };
      (def.advanced ? entry.advanced : entry.basic).push(def);
      map.set(def.group, entry);
    }
    return map;
  }, [params, quickIds, exposes]);

  const groups = useMemo(() => GROUPS.filter((g) => groupDefs.has(g.id)), [groupDefs]);
  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const { active, jumpTo } = useScrollSpy(sectionsRef, barRef, groupIds);

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
              {groups.length > 0 && (
                <div className="anchor-bar" ref={barRef}>
                  <Tabs variant="underline" items={groups.map((g) => ({ id: g.id, label: g.label }))} value={active ?? groups[0].id} onChange={jumpTo} />
                </div>
              )}
              <div className="anchor-sections" ref={sectionsRef}>
                {groups.map((meta) => {
                  const current = groupDefs.get(meta.id)!;
                  return (
                    <section key={meta.id} className="section" id={`group-${meta.id}`} data-group={meta.id}>
                      <h3 className="section__title">{meta.label}</h3>
                      <p className="section__hint">{meta.hint}</p>
                      {meta.id === 'color' && <ColorSwatches />}
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
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
