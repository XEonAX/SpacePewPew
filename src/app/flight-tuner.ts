import type { FlightTuning } from './ship-flight';

interface SliderSpec {
  key: keyof FlightTuning;
  label: string;
  min: number;
  max: number;
  step: number;
  digits: number;
  unit: string;
}

const SLIDERS: SliderSpec[] = [
  { key: 'forwardAccel', label: 'W thrust', min: 0, max: 60, step: 0.1, digits: 2, unit: 'm/s²' },
  { key: 'reverseAccel', label: 'S thrust', min: 0, max: 45, step: 0.1, digits: 2, unit: 'm/s²' },
  {
    key: 'angularAccel',
    label: 'A/D torque',
    min: 0,
    max: 40,
    step: 0.1,
    digits: 1,
    unit: 'rad/s²',
  },
  { key: 'linearDrag', label: 'Linear drag', min: 0.05, max: 8, step: 0.05, digits: 2, unit: '/s' },
  {
    key: 'angularDrag',
    label: 'Angular drag',
    min: 0.05,
    max: 8,
    step: 0.05,
    digits: 2,
    unit: '/s',
  },
  {
    key: 'inputRampSeconds',
    label: 'Input ramp',
    min: 0.05,
    max: 1.2,
    step: 0.05,
    digits: 2,
    unit: 's',
  },
];

const PANEL_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  top: '12px',
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
};

function format(value: number, spec: SliderSpec): string {
  return `${value.toFixed(spec.digits)} ${spec.unit}`;
}

export interface FlightTuner {
  element: HTMLElement;
  destroy(): void;
}

/** Small live overlay for tuning the arcade flight constants. */
export function createFlightTuner(tuning: FlightTuning): FlightTuner {
  const root = document.createElement('div');
  Object.assign(root.style, PANEL_STYLE);

  const title = document.createElement('div');
  title.textContent = 'FLIGHT TUNING';
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
    value.textContent = format(tuning[spec.key], spec);
    value.style.cssText = 'color:#7fdfff;font-variant-numeric:tabular-nums;';

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
      value.textContent = format(tuning[spec.key], spec);
    });

    header.append(label, value);
    row.append(header, input);
    root.append(row);
  }

  return {
    element: root,
    destroy(): void {
      root.remove();
    },
  };
}
