import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getParamDef, type NumberParam } from '@/params';
import { useStudioStore } from '@/state';
import { SliderField, ToggleField } from '@/ui/primitives';
import { helpForId } from '@/ui/state/helpStore';
import { ParamControl } from './ParamControl';
import type { CellPair } from './sections';

interface CellSizeControlProps {
  pair: CellPair;
}

/**
 * 排线 / 网点的「像素尺寸」。数据上仍是横向、纵向两个间距，面板上合成一个滑杆同时写两个，
 * 与抖动的像素尺寸一个叫法、一个手感；旁边的「横纵分开」打开后换成横、纵各自的滑杆（长方格），
 * 关掉时把纵向同步成横向。方案本身横纵不等（Rain、Brick、线条网点）时自动算打开。
 */
export function CellSizeControl({ pair }: CellSizeControlProps) {
  const xDef = getParamDef(pair.x) as NumberParam;
  const yDef = getParamDef(pair.y) as NumberParam;
  const { x, y, presetId, setParam, setParams } = useStudioStore(
    useShallow((s) => ({ x: Number(s.params[pair.x]), y: Number(s.params[pair.y]), presetId: s.presetId, setParam: s.setParam, setParams: s.setParams })),
  );
  // 用户主动打开了「横纵分开」但两个值还没调开：只在本地记着，换方案就忘掉
  const [forced, setForced] = useState(false);
  useEffect(() => setForced(false), [presetId]);
  const split = forced || x !== y;

  const onSplit = (on: boolean) => {
    setForced(on);
    if (!on) setParam(pair.y, x);
  };

  return (
    <>
      {split ? (
        <>
          <ParamControl def={xDef} />
          <ParamControl def={yDef} />
        </>
      ) : (
        <SliderField
          label="像素尺寸"
          value={x}
          min={xDef.min}
          max={xDef.max}
          step={xDef.step}
          unit={xDef.unit}
          onChange={(v) => setParams({ [pair.x]: v, [pair.y]: v }, pair.id)}
          help={helpForId(pair.id, '像素尺寸')}
          data-param={pair.id}
        />
      )}
      <ToggleField label="横纵分开" value={split} onChange={onSplit} help={helpForId(`${pair.id}.split`, '横纵分开')} data-param={`${pair.id}.split`} />
    </>
  );
}
