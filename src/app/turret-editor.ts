import type { TurretMountConfig } from './turrets';
import { TURRET_MOUNT_LABELS } from './turrets';

const PANEL_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  left: '12px',
  bottom: '12px',
  zIndex: '10',
  width: '246px',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(90, 160, 200, 0.35)',
  background: 'rgba(5, 9, 18, 0.86)',
  color: '#9fb7c9',
  font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
  backdropFilter: 'blur(6px)',
  userSelect: 'none',
};

interface SliderSpec {
  key: 'x' | 'y' | 'scale' | 'restAngle';
  label: string;
  min: number;
  max: number;
  step: number;
  display: (value: number) => string;
}

const SLIDERS: SliderSpec[] = [
  {
    key: 'x',
    label: 'X offset',
    min: -250,
    max: 250,
    step: 1,
    display: (v) => `${Math.round(v)}px`,
  },
  {
    key: 'y',
    label: 'Y offset',
    min: -400,
    max: 400,
    step: 1,
    display: (v) => `${Math.round(v)}px`,
  },
  {
    key: 'scale',
    label: 'Scale',
    min: 0.4,
    max: 2.5,
    step: 0.01,
    display: (v) => `${v.toFixed(2)}x`,
  },
  {
    key: 'restAngle',
    label: 'Rest angle',
    min: -Math.PI,
    max: Math.PI,
    step: Math.PI / 180,
    display: (v) => `${Math.round((v * 180) / Math.PI)}°`,
  },
];

export interface TurretEditor {
  element: HTMLElement;
  destroy(): void;
}

export function createTurretEditor(
  configs: TurretMountConfig[],
  onChange: (index: number, config: TurretMountConfig) => void,
): TurretEditor {
  const root = document.createElement('div');
  Object.assign(root.style, PANEL_STYLE);

  const title = document.createElement('div');
  title.textContent = 'TURRET MOUNTS';
  title.style.cssText = 'margin-bottom:8px;color:#d8f3ff;letter-spacing:0.12em;font-size:10px;';
  root.append(title);

  const select = document.createElement('select');
  select.style.cssText =
    'width:100%;margin-bottom:7px;padding:3px;background:#0d1722;color:#cfefff;border:1px solid rgba(90,160,200,.35);border-radius:4px;font:inherit;';
  TURRET_MOUNT_LABELS.forEach((label, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${index + 1}. ${label}`;
    select.append(option);
  });
  root.append(select);

  let selected = 0;
  const inputs = new Map<SliderSpec['key'], HTMLInputElement>();
  const readouts = new Map<SliderSpec['key'], HTMLElement>();

  for (const spec of SLIDERS) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:6px 0;';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;gap:8px;margin-bottom:2px;';
    const label = document.createElement('span');
    label.textContent = spec.label;
    const value = document.createElement('span');
    value.style.cssText = 'color:#7fdfff;font-variant-numeric:tabular-nums;';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.setAttribute('aria-label', `Turret ${spec.label}`);
    input.style.cssText = 'width:100%;margin:0;accent-color:#6fe3ff;cursor:pointer;';
    input.addEventListener('input', () => {
      const config = configs[selected];
      if (!config) return;
      config[spec.key] = Number(input.value);
      value.textContent = spec.display(config[spec.key]);
      onChange(selected, config);
    });
    header.append(label, value);
    row.append(header, input);
    root.append(row);
    inputs.set(spec.key, input);
    readouts.set(spec.key, value);
  }

  const sync = (): void => {
    const config = configs[selected];
    if (!config) return;
    for (const spec of SLIDERS) {
      const input = inputs.get(spec.key);
      const value = readouts.get(spec.key);
      if (input) input.value = String(config[spec.key]);
      if (value) value.textContent = spec.display(config[spec.key]);
    }
  };

  select.addEventListener('change', () => {
    selected = Number(select.value);
    sync();
  });

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'COPY LAYOUT';
  copy.style.cssText =
    'width:100%;margin-top:7px;padding:4px 0;border:1px solid rgba(90,160,200,.35);border-radius:4px;background:rgba(20,50,70,.6);color:#cfefff;font:inherit;cursor:pointer;';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(
      JSON.stringify(
        configs.map((config) => ({
          x: config.x,
          y: config.y,
          scale: config.scale,
          restAngleDegrees: Math.round((config.restAngle * 180) / Math.PI),
        })),
      ),
    );
  });
  root.append(copy);
  sync();

  return {
    element: root,
    destroy(): void {
      root.remove();
    },
  };
}
