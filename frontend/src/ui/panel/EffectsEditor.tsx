import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { EFFECT_DEFS, defaultEffectInstance, parseStack, serializeStack, type EffectInstance, type EffectParamDef } from '@/engine';
import { useStudioStore } from '@/state';
import { HelpLabel, IconButton, Select, SliderField, ToggleField } from '@/ui/primitives';
import { helpForEffect } from '@/ui/state/helpStore';

const STACK_ID = 'effects.stack';

function EffectParamControl({ def, value, onChange }: { def: EffectParamDef; value: EffectInstance['params'][string]; onChange: (v: EffectInstance['params'][string]) => void }) {
  switch (def.type) {
    case 'number':
      return (
        <SliderField
          label={def.label}
          value={Number(value)}
          min={def.min ?? 0}
          max={def.max ?? 100}
          step={def.step ?? 1}
          unit={def.unit}
          onChange={onChange}
          data-param={`effect.${def.id}`}
        />
      );
    case 'select':
      return <Select label={def.label} value={String(value)} options={def.options ?? []} onChange={onChange} data-param={`effect.${def.id}`} />;
    case 'boolean':
      return <ToggleField label={def.label} value={Boolean(value)} onChange={onChange} data-param={`effect.${def.id}`} />;
  }
}

/** 特效栈编辑器：可添加、启用、上下移动、删除；每个实例按定义生成控件 */
export function EffectsEditor() {
  const { json, setParam } = useStudioStore(useShallow((s) => ({ json: s.params[STACK_ID], setParam: s.setParam })));
  const stack = useMemo(() => parseStack(json), [json]);
  const write = (next: EffectInstance[]) => setParam(STACK_ID, serializeStack(next));
  const update = (index: number, patch: Partial<EffectInstance>) => write(stack.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= stack.length) return;
    const next = stack.slice();
    [next[index], next[target]] = [next[target], next[index]];
    write(next);
  };
  const remove = (index: number) => write(stack.filter((_, i) => i !== index));
  const add = (type: string) => {
    if (type === '') return;
    const inst = defaultEffectInstance(type);
    if (inst) write([...stack, inst]);
  };

  const addOptions = [{ value: '', label: '选择特效…' }, ...EFFECT_DEFS.map((d) => ({ value: d.id, label: d.label }))];

  return (
    <div className="effects" data-testid="effects-editor">
      {stack.length === 0 && <p className="effects__empty">还没有特效。从下面添加，特效按列表顺序依次应用。</p>}
      {stack.map((inst, index) => {
        const def = EFFECT_DEFS.find((d) => d.id === inst.type);
        if (!def) return null;
        return (
          <section key={`${inst.type}-${index}`} className={['effect-card', inst.enabled ? '' : 'is-disabled'].filter(Boolean).join(' ')} data-effect={inst.type}>
            <header className="effect-card__head">
              <span className="effect-card__index">{index + 1}</span>
              <HelpLabel content={helpForEffect(def.id, def.label)} className="effect-card__title">
                {def.label}
              </HelpLabel>
              {def.hint && <span className="effect-card__hint">{def.hint}</span>}
              <label className="effect-card__switch">
                <input type="checkbox" role="switch" checked={inst.enabled} onChange={(e) => update(index, { enabled: e.target.checked })} aria-label={`启用 ${def.label}`} />
                <span className="tda-toggle__track" aria-hidden="true">
                  <span className="tda-toggle__thumb" />
                </span>
              </label>
              <IconButton icon="up" label="上移" className="tda-iconbtn--sm" disabled={index === 0} onClick={() => move(index, -1)} />
              <IconButton icon="down" label="下移" className="tda-iconbtn--sm" disabled={index === stack.length - 1} onClick={() => move(index, 1)} />
              <IconButton icon="trash" label="删除" className="tda-iconbtn--sm" onClick={() => remove(index)} />
            </header>
            <div className="param-grid">
              {def.params.map((p) => (
                <EffectParamControl key={p.id} def={p} value={inst.params[p.id]} onChange={(v) => update(index, { params: { ...inst.params, [p.id]: v } })} />
              ))}
            </div>
          </section>
        );
      })}
      <div className="effects__add">
        <Select
          label="添加"
          value=""
          options={addOptions}
          onChange={add}
          optionHelp={(o) => helpForEffect(o.value, o.label)}
          data-param="effects.add"
          className="effects__add-select"
        />
      </div>
    </div>
  );
}
