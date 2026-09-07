import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { EFFECT_DEFS, defaultEffectInstance, parseStack, serializeStack, type EffectInstance, type EffectParamDef } from '@/engine';
import { useStudioStore } from '@/state';
import { ColorField, HelpLabel, Icon, IconButton, Select, SliderField, ToggleField } from '@/ui/primitives';
import { helpForEffect } from '@/ui/state/helpStore';
import { LevelMaskControl } from './LevelMaskControl';

const STACK_ID = 'effects.stack';

interface EffectParamControlProps {
  def: EffectParamDef;
  value: EffectInstance['params'][string];
  /** 同一实例的全部参数：逐阶开关要看阶数 */
  params: EffectInstance['params'];
  onChange: (v: EffectInstance['params'][string]) => void;
}

function EffectParamControl({ def, value, params, onChange }: EffectParamControlProps) {
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
    case 'color':
      return <ColorField label={def.label} value={String(value)} onChange={onChange} data-param={`effect.${def.id}`} />;
    case 'levels':
      return (
        <LevelMaskControl
          label={def.label}
          value={String(value ?? '')}
          count={def.countFrom ? Number(params[def.countFrom]) : 1}
          onChange={onChange}
          data-param={`effect.${def.id}`}
        />
      );
  }
}

/** 参数在这个实例里露不露出：定义了 visibleWhen 的只在那个参数等于指定值时显示 */
function paramVisible(def: EffectParamDef, params: EffectInstance['params']): boolean {
  return !def.visibleWhen || params[def.visibleWhen.id] === def.visibleWhen.equals;
}

/** 特效栈编辑器：全部特效以选项芯片露出，点一下即添加；已添加的实例可启用、上下移动、删除，按定义生成控件 */
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
    // 初始值可以看当前参数表（描边的阶数跟随风格的灰阶数），所以取一次实时状态
    const inst = defaultEffectInstance(type, useStudioStore.getState().params);
    if (inst) write([...stack, inst]);
  };
  const countOf = (type: string) => stack.filter((e) => e.type === type).length;

  return (
    <div className="effects" data-testid="effects-editor">
      <div className="effects__add" data-testid="effects-add" role="group" aria-label="添加特效">
        {EFFECT_DEFS.map((def) => {
          const n = countOf(def.id);
          return (
            <button
              key={def.id}
              type="button"
              className={['effect-chip', n > 0 ? 'is-used' : ''].filter(Boolean).join(' ')}
              data-effect-add={def.id}
              title={def.hint ? `${def.hint}（点击添加）` : '点击添加'}
              onClick={() => add(def.id)}
            >
              <Icon name="plus" size={12} />
              {def.label}
              {n > 0 && <span className="effect-chip__count">{n}</span>}
            </button>
          );
        })}
      </div>
      {stack.length === 0 && <p className="effects__empty">还没有特效。点上面的选项添加，特效按列表顺序依次应用。</p>}
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
              {def.params
                .filter((p) => paramVisible(p, inst.params))
                .map((p) => (
                  <EffectParamControl key={p.id} def={p} value={inst.params[p.id]} params={inst.params} onChange={(v) => update(index, { params: { ...inst.params, [p.id]: v } })} />
                ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
