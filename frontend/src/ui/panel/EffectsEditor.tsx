import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  EFFECT_DEFS,
  defaultEffectInstance,
  isEffectParamVisible,
  parseColorList,
  parseStack,
  parseTextList,
  serializeStack,
  serializeTextList,
  type EffectInstance,
  type EffectParamDef,
  type EffectParamValues,
} from '@/engine';
import { useStudioStore } from '@/state';
import { ColorField, ColorPopover, HelpLabel, Icon, IconButton, Select, SliderField, TextField, ToggleField } from '@/ui/primitives';
import { helpForEffect, helpForEffectParam } from '@/ui/state/helpStore';
import { LevelMaskControl } from './LevelMaskControl';

const STACK_ID = 'effects.stack';

interface Editing {
  index: number;
  anchor: HTMLElement;
}

/**
 * 一排色块型的子参数（叠加随机方块的「每块颜色」）：实际生效的颜色由定义里的 `resolve` 按当前实例参数展开，
 * 点一块弹取色层，改动经 `edit` 写回（配色方案转为自定义）。
 */
function EffectSwatches({ effectId, def, params, onPatch }: { effectId: string; def: EffectParamDef; params: EffectParamValues; onPatch: (next: EffectParamValues) => void }) {
  const colors = def.resolve ? def.resolve(params) : parseColorList(String(params[def.id] ?? ''));
  const [editing, setEditing] = useState<Editing | null>(null);
  const count = colors.length;
  // 数量减少后正在编辑的那块没了就收起弹层
  useEffect(() => {
    if (editing && editing.index >= count) setEditing(null);
  }, [editing, count]);
  const titleOf = (i: number) => def.swatchTitle?.(i) ?? `第 ${i + 1} 色`;
  const apply = (i: number, hex: string) => {
    if (def.edit) return onPatch(def.edit(params, i, hex));
    const next = colors.slice();
    next[i] = hex;
    onPatch({ ...params, [def.id]: next.join(' ') });
  };
  return (
    <div className="tda-field tda-swatch-field param-span-2" data-param={`effect.${def.id}`}>
      <HelpLabel content={helpForEffectParam(effectId, def)} className="tda-field__label">
        {def.label}
      </HelpLabel>
      <div className="swatches swatches--editable" role="group" aria-label={def.label}>
        {colors.map((hex, i) => (
          <button
            key={i}
            type="button"
            className={['swatch', 'swatch--btn', editing?.index === i ? 'is-editing' : ''].filter(Boolean).join(' ')}
            style={{ background: hex }}
            title={`${titleOf(i)} ${hex}`}
            aria-label={`${titleOf(i)} ${hex}`}
            data-index={i}
            onClick={(e) => setEditing(editing?.index === i ? null : { index: i, anchor: e.currentTarget })}
          />
        ))}
        {count === 0 && <span className="swatches__note">数量为 0，没有方块</span>}
      </div>
      {editing && colors[editing.index] !== undefined && (
        <ColorPopover
          anchor={editing.anchor}
          value={colors[editing.index]}
          title={titleOf(editing.index)}
          onChange={(hex) => apply(editing.index, hex)}
          onClose={() => setEditing(null)}
          hint={def.editHint?.(params) ?? null}
        />
      )}
    </div>
  );
}

/** 一块的文字框：改完失焦或回车才写回（与「字母」那个文本框一样），写回时清洗成大写、去掉画不出来的字 */
function BlockTextInput({ value, title, maxLength, onCommit }: { value: string; title: string; maxLength: number; onCommit: (text: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <input
      type="text"
      className="block-text__input"
      value={text}
      maxLength={maxLength}
      title={title}
      aria-label={`${title}文字`}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * 一排逐块的文本框（叠加随机方块的「每块文字」）：每块实际的字由定义里的 `resolve` 按当前实例参数展开（字母串轮流填满），
 * 改哪一块经 `edit` 把整个列表写回，之后每一块各是各的。
 */
function EffectTexts({ effectId, def, params, onPatch }: { effectId: string; def: EffectParamDef; params: EffectParamValues; onPatch: (next: EffectParamValues) => void }) {
  const texts = def.resolve ? def.resolve(params) : (parseTextList(String(params[def.id] ?? '')) ?? []);
  const titleOf = (i: number) => def.swatchTitle?.(i) ?? `第 ${i + 1} 块`;
  const apply = (i: number, text: string) => {
    if (def.edit) return onPatch(def.edit(params, i, text));
    const next = texts.slice();
    next[i] = text;
    onPatch({ ...params, [def.id]: serializeTextList(next, def.maxLength) });
  };
  return (
    <div className="tda-field tda-texts-field param-span-2" data-param={`effect.${def.id}`}>
      <HelpLabel content={helpForEffectParam(effectId, def)} className="tda-field__label">
        {def.label}
      </HelpLabel>
      <div className="block-texts" role="group" aria-label={def.label}>
        {texts.map((text, i) => (
          <BlockTextInput key={i} value={text} title={titleOf(i)} maxLength={def.maxLength ?? 8} onCommit={(v) => apply(i, v)} />
        ))}
        {texts.length === 0 && <span className="swatches__note">数量为 0，没有方块</span>}
      </div>
    </div>
  );
}

interface EffectParamControlProps {
  effectId: string;
  def: EffectParamDef;
  /** 同一实例的全部参数：逐阶开关要看阶数，色块列表要按配色展开 */
  params: EffectParamValues;
  onChange: (v: EffectParamValues[string]) => void;
  /** 一次改多个参数（改某块颜色时配色方案也要转自定义） */
  onPatch: (next: EffectParamValues) => void;
}

function EffectParamControl({ effectId, def, params, onChange, onPatch }: EffectParamControlProps) {
  const value = params[def.id];
  const help = helpForEffectParam(effectId, def);
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
          help={help}
          data-param={`effect.${def.id}`}
        />
      );
    case 'select':
      return <Select label={def.label} value={String(value)} options={def.options ?? []} onChange={onChange} help={help} data-param={`effect.${def.id}`} />;
    case 'boolean':
      return <ToggleField label={def.label} value={Boolean(value)} onChange={onChange} help={help} data-param={`effect.${def.id}`} />;
    case 'text':
      return <TextField label={def.label} value={String(value ?? '')} placeholder={def.placeholder} onChange={onChange} help={help} data-param={`effect.${def.id}`} />;
    case 'color':
      return <ColorField label={def.label} value={String(value)} onChange={onChange} help={help} data-param={`effect.${def.id}`} />;
    case 'colors':
      return <EffectSwatches effectId={effectId} def={def} params={params} onPatch={onPatch} />;
    case 'texts':
      return <EffectTexts effectId={effectId} def={def} params={params} onPatch={onPatch} />;
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
                .filter((p) => isEffectParamVisible(p, inst.params))
                .map((p) => (
                  <EffectParamControl
                    key={p.id}
                    effectId={def.id}
                    def={p}
                    params={inst.params}
                    // 定义了 patch 的参数连带改别的（批量字母一改，逐块文字作废）
                    onChange={(v) => update(index, { params: p.patch ? p.patch(inst.params, v) : { ...inst.params, [p.id]: v } })}
                    onPatch={(next) => update(index, { params: next })}
                  />
                ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
