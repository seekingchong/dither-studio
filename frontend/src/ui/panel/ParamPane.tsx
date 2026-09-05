import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FAMILY_PARAM, type DitherFamily } from '@/engine';
import { PARAM_SCHEMA, isParamVisible, styleOf, type ParamDef, type Params, type StyleKind } from '@/params';
import { isParamExposed, presetReferenceParams, resolveBase, useStudioStore } from '@/state';
import { Icon, IconButton, Tabs } from '@/ui/primitives';
import { SettingsMenu } from '@/ui/SettingsMenu';
import { ColorSwatches } from './ColorSwatches';
import { EffectsEditor } from './EffectsEditor';
import { HistoryPane } from './HistoryPane';
import { ParamControl } from './ParamControl';
import { PresetActions } from './PresetActions';
import { PresetPicker } from './PresetPicker';
import { leadParamIds, SECTIONS, sectionHint, sectionOf, type SectionMeta } from './sections';

/** 左栏页签：三种艺术风格各一页（页签本身就是 `style.type`），再加「历史」 */
type PaneTab = StyleKind | 'history';

const TABS: { id: PaneTab; label: string }[] = [
  { id: 'dither', label: '抖动' },
  { id: 'hatch', label: '排线' },
  { id: 'halftone', label: '网点' },
  { id: 'history', label: '历史' },
];

interface SectionContent {
  meta: SectionMeta;
  basic: ParamDef[];
  advanced: ParamDef[];
}

/**
 * 左栏。「抖动」「排线」「网点」三页 = 预设模块（选一套该风格的方案）+ 在这套方案范围内微调的参数，
 * 切页签就是切 `style.type`（`setStyle`：进撤销栈，并换到那种风格上次用的方案），各风格的参数都留在同一份参数表里；
 * 「历史」页 = 保存过的所有方案。
 *
 * 参数不再分 tab：整栏一列，每节可折叠、收起时显示当前值摘要。
 * 默认全部展开，需要时可逐节收起（收起后标题右侧显示当前值摘要），几节之间的关系一眼可见，也不用来回切 tab 找参数。
 * 画布尺寸 / 适配在预览区右上角的「画布」菜单里，不在这儿。
 * 导出也不在这儿：唯一的导出按钮在预览头里，跟着媒体类型在「导出图片」/「导出视频」之间切。
 * 打开 / 复制 PNG / 撤销 / 重做只走快捷键与系统菜单（「设置」里有一览），操作行只留页签、「设置」与预设动作（还原 / 保存预设）。
 */
export function ParamPane() {
  const params = useStudioStore((s) => s.params);
  const setStyle = useStudioStore((s) => s.setStyle);
  const setParams = useStudioStore((s) => s.setParams);
  // 当前方案的来源预设决定参数面板露出哪些分组 / 参数
  const exposes = useStudioStore(useShallow((s) => resolveBase(s.presetId, s.presets).exposes));
  // 「重置」把这一节退回当前方案本身的值（不是 schema 默认值），跟操作行的「还原」同一把尺子
  const reference = useStudioStore(useShallow((s) => presetReferenceParams(s.presetId, s.presets)));
  const [showHistory, setShowHistory] = useState(false);
  // 分节默认全展开；点标题仍可单独收起，收起后标题右侧显示当前值摘要
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const style = styleOf(params);
  const family = String(params['dither.family']) as DitherFamily;
  const algorithmId = style === 'dither' ? FAMILY_PARAM[family] : undefined;
  // 领头参数只随风格与算法族变；用拼起来的键做依赖，免得每改一个滑块都重排
  const leadsKey = leadParamIds(params).join('|');
  const leads = useMemo(() => leadsKey.split('|'), [leadsKey]);
  const tab: PaneTab = showHistory ? 'history' : style;
  const onTab = (id: PaneTab) => {
    if (id === 'history') {
      setShowHistory(true);
      return;
    }
    setShowHistory(false);
    if (id !== style) setStyle(id);
  };

  /**
   * 每一节管着哪些参数——重置要把没露出来、当前条件下不可见的一并退回去，
   * 所以按整份 schema 算，不用面板上正在显示的那份。
   */
  const sectionParamIds = useMemo(() => {
    const leadSet = new Set(leads);
    const bySection = new Map<string, string[]>();
    for (const def of PARAM_SCHEMA) {
      const id = sectionOf(def, leadSet);
      if (!id) continue;
      const list = bySection.get(id);
      if (list) list.push(def.id);
      else bySection.set(id, [def.id]);
    }
    return bySection;
  }, [leads]);

  const sectionDirty = (id: string) => (sectionParamIds.get(id) ?? []).some((pid) => params[pid] !== reference[pid]);
  const resetSection = (id: string) => {
    const patch: Partial<Params> = {};
    for (const pid of sectionParamIds.get(id) ?? []) patch[pid] = reference[pid];
    setParams(patch);
  };

  const sections = useMemo<SectionContent[]>(() => {
    const leadSet = new Set(leads);
    const bySection = new Map<string, { basic: ParamDef[]; advanced: ParamDef[] }>();
    for (const def of PARAM_SCHEMA) {
      if (!isParamExposed(def, exposes) || !isParamVisible(def, params)) continue;
      // 领头的那几个不管属于哪个分组，一律归「基础」；没有对应分节的分组（画布、风格）不在左栏出现
      const id = sectionOf(def, leadSet);
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
    <section className="pane pane--params" aria-label="参数面板" data-style={style}>
      <div className="pane-actions">
        <Tabs items={TABS} value={tab} onChange={onTab} />
        <div className="pane-actions__tools">
          <SettingsMenu />
          <PresetActions />
        </div>
      </div>

      <div className="pane-content">
        {tab === 'history' && <HistoryPane onApplied={() => setShowHistory(false)} />}
        {tab !== 'history' && (
          <>
            <PresetPicker />

            <div className="sections" data-testid="params-module">
              {sections.map(({ meta, basic, advanced }) => {
                const open = openSections[meta.id] ?? true;
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
                      {/* 只退回这一节，其余分节的微调留着；没改过就置灰 */}
                      <IconButton
                        icon="undo"
                        label={`重置${meta.label}`}
                        className="tda-iconbtn--sm section__reset"
                        disabled={!sectionDirty(meta.id)}
                        onClick={() => resetSection(meta.id)}
                        data-testid={`reset-${meta.id}`}
                      />
                    </h3>
                    {open && (
                      <div className="section__body">
                        <p className="section__hint">{sectionHint(meta, params)}</p>
                        {meta.id === 'color' && <ColorSwatches />}
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
