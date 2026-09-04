import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FAMILY_PARAM, type DitherFamily } from '@/engine';
import { PARAM_SCHEMA, isParamVisible, type ParamDef, type ParamGroup } from '@/params';
import { isAnimated, isParamExposed, resolveBase, useStudioStore } from '@/state';
import { ExportVideoDialog } from '@/ui/export/ExportVideoDialog';
import { useExport } from '@/ui/export/useExport';
import { useOpenMedia } from '@/ui/media/useOpenMedia';
import { Button, Icon, IconButton, Tabs } from '@/ui/primitives';
import { useUiStore } from '@/ui/state/uiStore';
import { ColorPreview } from './ColorPreview';
import { EffectsEditor } from './EffectsEditor';
import { HistoryPane } from './HistoryPane';
import { ParamControl } from './ParamControl';
import { PresetPicker } from './PresetPicker';
import { leadParamIds, SECTIONS, type SectionMeta } from './sections';

type PaneTab = 'params' | 'history';

interface SectionContent {
  meta: SectionMeta;
  basic: ParamDef[];
  advanced: ParamDef[];
}

/**
 * 左栏。「参数」页 = 预设模块（选一套方案）+ 在这套方案范围内微调的参数；
 * 「历史」页 = 保存过的所有方案。
 *
 * 参数不再分 tab：整栏一列，每节可折叠、收起时显示当前值摘要。
 * 默认只展开「基础」，其余按需打开，几节之间的关系一眼可见，也不用来回切 tab 找参数。
 */
export function ParamPane() {
  const params = useStudioStore((s) => s.params);
  // 当前方案的来源预设决定参数面板露出哪些分组 / 参数
  const exposes = useStudioStore(useShallow((s) => resolveBase(s.presetId, s.presets).exposes));
  const [paneTab, setPaneTab] = useState<PaneTab>('params');
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({ basic: true });
  const { openDialog } = useOpenMedia();
  const { canExport, exportPng, copyPng } = useExport();
  const animated = useStudioStore((s) => isAnimated(s.slots[s.view.activeSlot]?.media));
  const { videoDialog, setVideoDialog } = useUiStore(useShallow((s) => ({ videoDialog: s.exportVideoOpen, setVideoDialog: s.setExportVideoOpen })));
  const { canUndo, canRedo, undo, redo } = useStudioStore(
    useShallow((s) => ({ canUndo: s.history.past.length > 0, canRedo: s.history.future.length > 0, undo: s.undo, redo: s.redo })),
  );

  const family = String(params['dither.family']) as DitherFamily;
  const algorithmId = FAMILY_PARAM[family];
  const leads = useMemo(() => leadParamIds(family), [family]);

  const sections = useMemo<SectionContent[]>(() => {
    const sectionOfGroup = new Map<ParamGroup, string>();
    for (const meta of SECTIONS) for (const group of meta.groups) sectionOfGroup.set(group, meta.id);
    const leadSet = new Set(leads);

    const bySection = new Map<string, { basic: ParamDef[]; advanced: ParamDef[] }>();
    for (const def of PARAM_SCHEMA) {
      if (!isParamExposed(def, exposes) || !isParamVisible(def, params)) continue;
      // 领头的那几个不管属于哪个分组，一律归「基础」
      const id = leadSet.has(def.id) ? 'basic' : sectionOfGroup.get(def.group);
      if (!id) continue;
      const entry = bySection.get(id) ?? { basic: [], advanced: [] };
      (def.advanced ? entry.advanced : entry.basic).push(def);
      bySection.set(id, entry);
    }

    return SECTIONS.map((meta) => {
      const entry = bySection.get(meta.id) ?? { basic: [], advanced: [] };
      const basic = entry.basic.slice();
      // 「基础」把那一排领头参数提到最前，其余保持 schema 顺序
      if (meta.id === 'basic') {
        const rank = (def: ParamDef) => {
          const i = leads.indexOf(def.id);
          return i === -1 ? leads.length : i;
        };
        basic.sort((a, b) => rank(a) - rank(b));
      }
      return { meta, basic, advanced: entry.advanced };
    }).filter((s) => s.basic.length > 0 || s.advanced.length > 0);
  }, [params, exposes, leads]);

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
              {sections.map(({ meta, basic, advanced }) => {
                const open = openSections[meta.id] ?? false;
                return (
                  <section key={meta.id} className="section section--fold" data-section={meta.id} data-group={meta.id} data-open={open}>
                    <h3 className="section__head">
                      <button
                        type="button"
                        className="section__toggle"
                        aria-expanded={open}
                        onClick={() => setOpenSections((s) => ({ ...s, [meta.id]: !open }))}
                      >
                        <Icon name="chevron" size={12} className="section__caret" />
                        <span className="section__label">{meta.label}</span>
                        <span className="section__summary">{meta.summary(params)}</span>
                      </button>
                    </h3>
                    {open && (
                      <div className="section__body">
                        <p className="section__hint">{meta.hint}</p>
                        {meta.id === 'color' && <ColorPreview />}
                        {meta.id === 'effects' && <EffectsEditor />}
                        {meta.id !== 'effects' && basic.length > 0 && (
                          <div className="param-grid">
                            {basic.map((def) => (
                              <ParamControl key={def.id} def={def} label={def.id === algorithmId ? '算法' : undefined} />
                            ))}
                          </div>
                        )}
                        {advanced.length > 0 && (
                          <details className="section__more" open={basic.length === 0}>
                            <summary>更多参数</summary>
                            <div className="param-grid">
                              {advanced.map((def) => (
                                <ParamControl key={def.id} def={def} />
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
