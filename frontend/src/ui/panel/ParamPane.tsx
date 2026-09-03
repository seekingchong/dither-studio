import { useMemo, useState } from 'react';
import { FAMILY_PARAM } from '@/engine';
import { PARAM_SCHEMA, getParamDef, hasParam, isParamVisible, type ParamDef, type ParamGroup } from '@/params';
import { useStudioStore } from '@/state';
import { useExport } from '@/ui/export/useExport';
import { useOpenMedia } from '@/ui/media/useOpenMedia';
import { Button, Tabs } from '@/ui/primitives';
import { ColorPreview } from './ColorPreview';
import { EffectsEditor } from './EffectsEditor';
import { GROUPS, QUICK_PARAMS } from './groups';
import { ParamControl } from './ParamControl';

type PaneTab = 'params';

export function ParamPane() {
  const params = useStudioStore((s) => s.params);
  const [paneTab, setPaneTab] = useState<PaneTab>('params');
  const [group, setGroup] = useState<ParamGroup>('pixel');
  const { openDialog } = useOpenMedia();
  const { canExport, exportPng, copyPng } = useExport();

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
      if (quickIds.has(def.id) || !isParamVisible(def, params)) continue;
      const entry = map.get(def.group) ?? { basic: [], advanced: [] };
      (def.advanced ? entry.advanced : entry.basic).push(def);
      map.set(def.group, entry);
    }
    return map;
  }, [params, quickIds]);

  const groupTabs = GROUPS.filter((g) => groupDefs.has(g.id)).map((g) => ({ id: g.id, label: g.label }));
  const activeGroup = groupDefs.has(group) ? group : groupTabs[0]?.id;
  const meta = GROUPS.find((g) => g.id === activeGroup);
  const current = activeGroup ? groupDefs.get(activeGroup) : undefined;

  return (
    <section className="pane pane--params" aria-label="参数面板">
      <div className="pane-actions">
        <Tabs items={[{ id: 'params', label: '参数' }]} value={paneTab} onChange={setPaneTab} />
        <div className="btn-group">
          <Button variant="secondary" icon="folder" onClick={() => void openDialog()}>
            打开
          </Button>
          <Button variant="secondary" icon="copy" disabled={!canExport} onClick={() => void copyPng()}>
            复制 PNG
          </Button>
          <Button variant="primary" icon="download" disabled={!canExport} onClick={() => void exportPng()}>
            导出 PNG
          </Button>
        </div>
      </div>

      <div className="pane-content">
        <div className="param-grid" data-testid="quick-params">
          {quickDefs.map((def) => (
            <ParamControl key={def.id} def={def} label={def.id === algorithmParamId ? '算法' : undefined} />
          ))}
        </div>

        <div className="sections">
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
      </div>
    </section>
  );
}
