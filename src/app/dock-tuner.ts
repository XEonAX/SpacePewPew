import { DEFAULT_DOCK_TUNING } from './dock-tuning';
import type { DockTuning } from './dock-tuning';
import { createCollapsibleTunerPanel } from './tuner-panel';

const PANEL_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  top: '336px',
  left: '12px',
  zIndex: '10',
  width: '232px',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(90, 160, 200, 0.35)',
  background: 'rgba(5, 9, 18, 0.86)',
  color: '#9fb7c9',
  font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
  backdropFilter: 'blur(6px)',
  userSelect: 'none',
  maxHeight: 'calc(100vh - 360px)',
  overflowY: 'auto',
};

interface SliderSpec {
  key: keyof DockTuning;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  digits: number;
}

const SLIDERS: readonly SliderSpec[] = [
  { key: 'xM', label: 'Dock X', min: -20, max: 20, step: 0.5, unit: 'm', digits: 1 },
  { key: 'yM', label: 'Dock Y', min: -20, max: 20, step: 0.5, unit: 'm', digits: 1 },
  { key: 'heightM', label: 'Dock scale', min: 12, max: 40, step: 1, unit: 'm', digits: 0 },
];

export interface DockTuner {
  element: HTMLElement;
  destroy(): void;
}

export function createDockTuner(tuning: DockTuning): DockTuner {
  const root = document.createElement('div');
  root.className = 'dock-tuner';
  Object.assign(root.style, PANEL_STYLE);

  const panel = createCollapsibleTunerPanel('DOCK PLACEMENT');
  root.append(panel.header, panel.body);

  for (const spec of SLIDERS) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:6px 0;';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;gap:8px;margin-bottom:2px;';
    const label = document.createElement('span');
    label.textContent = spec.label;
    const readout = document.createElement('span');
    readout.style.cssText = 'color:#7fdfff;font-variant-numeric:tabular-nums;';
    header.append(label, readout);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(tuning[spec.key]);
    input.setAttribute('aria-label', spec.label);
    input.style.cssText = 'width:100%;margin:0;accent-color:#6fe3ff;cursor:pointer;';
    input.addEventListener('input', () => {
      tuning[spec.key] = Number(input.value);
      readout.textContent = `${tuning[spec.key].toFixed(spec.digits)} ${spec.unit}`;
    });
    readout.textContent = `${tuning[spec.key].toFixed(spec.digits)} ${spec.unit}`;
    row.append(header, input);
    panel.body.append(row);
  }

  // Keep the default visible in the panel label for quick resetting by hand.
  panel.setTitle(`DOCK PLACEMENT · default ${DEFAULT_DOCK_TUNING.yM} m`);

  return {
    element: root,
    destroy(): void {
      root.remove();
    },
  };
}
