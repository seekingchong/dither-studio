import { useShallow } from 'zustand/react/shallow';
import type { ParamDef } from '@/params';
import { useStudioStore } from '@/state';
import { ColorField, Select, SliderField, TextField, ToggleField } from '@/ui/primitives';
import { helpForOption, helpForParam } from '@/ui/state/helpStore';

interface ParamControlProps {
  def: ParamDef;
  /** 覆盖显示标签（顶部"算法"下拉复用各族的算法参数） */
  label?: string;
}

/** 按 schema 记录渲染对应控件 */
export function ParamControl({ def, label }: ParamControlProps) {
  const { value, setParam } = useStudioStore(useShallow((s) => ({ value: s.params[def.id], setParam: s.setParam })));
  const text = label ?? def.label;
  const help = helpForParam(def, label);
  switch (def.type) {
    case 'select':
      return (
        <Select
          label={text}
          value={String(value)}
          options={def.options}
          onChange={(v) => setParam(def.id, v)}
          help={help}
          optionHelp={(o) => helpForOption(def.id, o.value, o.label)}
          data-param={def.id}
        />
      );
    case 'number':
      return (
        <SliderField
          label={text}
          value={Number(value)}
          min={def.min}
          max={def.max}
          step={def.step}
          unit={def.unit}
          onChange={(v) => setParam(def.id, v)}
          help={help}
          data-param={def.id}
        />
      );
    case 'boolean':
      return <ToggleField label={text} value={Boolean(value)} onChange={(v) => setParam(def.id, v)} help={help} data-param={def.id} />;
    case 'color':
      return <ColorField label={text} value={String(value)} onChange={(v) => setParam(def.id, v)} help={help} data-param={def.id} />;
    case 'effects':
      return null;
    case 'text':
      return (
        <div className={def.multiline ? 'param-span-2' : undefined}>
          <TextField
            label={text}
            value={String(value)}
            multiline={def.multiline}
            placeholder={def.placeholder}
            onChange={(v) => setParam(def.id, v)}
            help={help}
            data-param={def.id}
          />
        </div>
      );
  }
}
