import type { ReverseEngineConfig } from './reverse-engines';

const PANEL_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  left: '12px',
  bottom: '12px',
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
};

interface SliderSpec {
  key: keyof ReverseEngineConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  display: (value: number) => string;
}

const SLIDERS: SliderSpec[] = [
  {
    key: 'xOffset',
    label: 'X offset',
    min: 0,
    max: 220,
    step: 1,
    digits: 0,
    display: (v) => `${v}px`,
  },
  {
    key: 'yOffset',
    label: 'Y offset',
    min: -200,
    max: 200,
    step: 1,
    digits: 0,
    display: (v) => `${v}px`,
  },
  {
    key: 'scale',
    label: 'Scale',
    min: 0.2,
    max: 1.5,
    step: 0.01,
    digits: 2,
    display: (v) => `${v.toFixed(2)}x`,
  },
  {
    key: 'rotation',
    label: 'Rotation',
    min: 0,
    max: Math.PI * 2,
    step: Math.PI / 180,
    digits: 0,
    display: (v) => `${Math.round((v * 180) / Math.PI)}°`,
  },
];

export interface ReverseEngineEditor {
  element: HTMLElement;
  destroy(): void;
}

export function createReverseEngineEditor(
  config: ReverseEngineConfig,
  onChange: (config: ReverseEngineConfig) => void,
): ReverseEngineEditor {
  const root = document.createElement('div');
  Object.assign(root.style, PANEL_STYLE);

  const title = document.createElement('div');
  title.textContent = 'REVERSE ENGINE';
  title.style.cssText = 'margin-bottom:8px;color:#d8f3ff;letter-spacing:0.12em;font-size:10px;';
  root.append(title);

  for (const spec of SLIDERS) {
    const row = document.createElement('div');
    row.style.cssText = 'margin:7px 0;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;gap:8px;margin-bottom:2px;';

    const label = document.createElement('span');
    label.textContent = spec.label;

    const value = document.createElement('span');
    value.textContent = spec.display(config[spec.key]);
    value.style.cssText = 'color:#7fdfff;font-variant-numeric:tabular-nums;';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(config[spec.key]);
    input.setAttribute('aria-label', `Reverse engine ${spec.label}`);
    input.style.cssText = 'width:100%;margin:0;accent-color:#6fe3ff;cursor:pointer;';
    input.addEventListener('input', () => {
      config[spec.key] = Number(input.value);
      value.textContent = spec.display(config[spec.key]);
      onChange(config);
    });

    header.append(label, value);
    row.append(header, input);
    root.append(row);
  }

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'COPY VALUES';
  copy.style.cssText =
    'width:100%;margin-top:6px;padding:4px 0;border:1px solid rgba(90,160,200,.35);border-radius:4px;background:rgba(20,50,70,.6);color:#cfefff;font:inherit;cursor:pointer;';
  copy.addEventListener('click', () => {
    void navigator.clipboard?.writeText(
      JSON.stringify({
        xOffset: config.xOffset,
        yOffset: config.yOffset,
        scale: config.scale,
        rotationDegrees: Math.round((config.rotation * 180) / Math.PI),
      }),
    );
  });
  root.append(copy);

  return {
    element: root,
    destroy(): void {
      root.remove();
    },
  };
}
