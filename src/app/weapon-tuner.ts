import { WEAPON_PAIRS } from './weapons';
import type { MiningTuning } from './mining-tuning';

const PAIR_LABELS = ['Front pair', '2nd pair', '3rd pair', 'Rear pair'] as const;
// The slider reaches near-instantly-repeating fire on purpose; the scene still
// paces shots off this cooldown, so keep it above zero to stay finite.
const MIN_COOLDOWN = 0.02;
const MAX_COOLDOWN = 2.5;

const PANEL_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'fixed',
  left: '12px',
  bottom: '12px',
  zIndex: '10',
  width: '252px',
  padding: '10px 12px',
  borderRadius: '8px',
  border: '1px solid rgba(90, 160, 200, 0.35)',
  background: 'rgba(5, 9, 18, 0.86)',
  color: '#9fb7c9',
  font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
  backdropFilter: 'blur(6px)',
  userSelect: 'none',
  maxHeight: 'calc(100vh - 24px)',
  overflowY: 'auto',
};

interface SliderSpec {
  key: keyof MiningTuning;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  decimals: number;
}

/** Live mining-rig sliders, shown instead of rate-of-fire while mining. */
const MINING_SLIDERS: readonly SliderSpec[] = [
  { key: 'meltSeconds', label: 'Melt dwell', min: 0.2, max: 3, step: 0.05, unit: 's', decimals: 2 },
  {
    key: 'meltSpotRadiusM',
    label: 'Melt spot',
    min: 0.1,
    max: 1.5,
    step: 0.05,
    unit: 'm',
    decimals: 2,
  },
  {
    key: 'meltCoolSeconds',
    label: 'Melt cool',
    min: 0.5,
    max: 6,
    step: 0.1,
    unit: 's',
    decimals: 1,
  },
  {
    key: 'chunkMinSpeedMps',
    label: 'Chunk min',
    min: 0.5,
    max: 5,
    step: 0.1,
    unit: 'm/s',
    decimals: 1,
  },
  {
    key: 'chunkMaxSpeedMps',
    label: 'Chunk max',
    min: 0.5,
    max: 8,
    step: 0.1,
    unit: 'm/s',
    decimals: 1,
  },
  {
    key: 'chunkDampingPerSecond',
    label: 'Chunk damp',
    min: 0,
    max: 2,
    step: 0.05,
    unit: '/s',
    decimals: 2,
  },
  {
    key: 'chunkLifetimeSeconds',
    label: 'Chunk life',
    min: 2,
    max: 20,
    step: 0.5,
    unit: 's',
    decimals: 1,
  },
  {
    key: 'tractorRangeM',
    label: 'Tractor reach',
    min: 2,
    max: 12,
    step: 0.25,
    unit: 'm',
    decimals: 2,
  },
  {
    key: 'tractorTrackRateLimit',
    label: 'Tractor slew',
    min: 0.5,
    max: 8,
    step: 0.25,
    unit: 'rad/s',
    decimals: 2,
  },
  {
    key: 'carrierMaxSpeedMps',
    label: 'Cargo speed',
    min: 2,
    max: 16,
    step: 0.5,
    unit: 'm/s',
    decimals: 1,
  },
  {
    key: 'carrierTurnRate',
    label: 'Cargo turn',
    min: 0.5,
    max: 6,
    step: 0.1,
    unit: 'rad/s',
    decimals: 1,
  },
  {
    key: 'carrierArrivalSeconds',
    label: 'Cargo easing',
    min: 0.2,
    max: 2,
    step: 0.05,
    unit: 's',
    decimals: 2,
  },
  { key: 'laserRangeM', label: 'Laser range', min: 50, max: 400, step: 10, unit: 'm', decimals: 0 },
];

export interface WeaponTuner {
  element: HTMLElement;
  /** Swaps the panel between weapon rate-of-fire and mining tunables. */
  setMining(active: boolean): void;
  destroy(): void;
}

export function createWeaponTuner(cooldowns: number[], miningTuning: MiningTuning): WeaponTuner {
  const root = document.createElement('div');
  Object.assign(root.style, PANEL_STYLE);

  const title = document.createElement('div');
  title.textContent = 'RATE OF FIRE';
  title.style.cssText = 'margin-bottom:8px;color:#d8f3ff;letter-spacing:0.12em;font-size:10px;';
  root.append(title);

  const gunsSection = document.createElement('div');
  const miningSection = document.createElement('div');
  root.append(gunsSection, miningSection);

  const addRow = (
    labelText: string,
    input: HTMLInputElement,
    syncReadout: () => void,
    parent: HTMLElement,
  ): void => {
    const row = document.createElement('div');
    row.style.cssText = 'margin:6px 0;';
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;gap:8px;margin-bottom:2px;';
    const label = document.createElement('span');
    label.textContent = labelText;
    const readout = document.createElement('span');
    readout.style.cssText = 'color:#7fdfff;font-variant-numeric:tabular-nums;';
    header.append(label, readout);
    row.append(header, input);
    parent.append(row);
    const refresh = (): void => {
      syncReadout();
      readout.textContent = input.dataset.readout ?? '';
    };
    input.addEventListener('input', refresh);
    refresh();
  };

  // ---- guns: rate of fire ----
  WEAPON_PAIRS.forEach((pair, index) => {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(MIN_COOLDOWN);
    input.max = String(MAX_COOLDOWN);
    input.step = '0.01';
    input.value = String(cooldowns[index] ?? pair.cooldown);
    input.setAttribute('aria-label', `${PAIR_LABELS[index]} cooldown`);
    input.style.cssText = 'width:100%;margin:0;accent-color:#6fe3ff;cursor:pointer;';
    addRow(
      PAIR_LABELS[index] ?? `Pair ${index + 1}`,
      input,
      () => {
        const cooldown = Number(input.value);
        cooldowns[index] = cooldown;
        input.dataset.readout = `${cooldown.toFixed(2)} s · ${(1 / cooldown).toFixed(2)}/s`;
      },
      gunsSection,
    );
  });

  // ---- mining: live rig tunables ----
  for (const spec of MINING_SLIDERS) {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(miningTuning[spec.key]);
    input.setAttribute('aria-label', spec.label);
    input.style.cssText = 'width:100%;margin:0;accent-color:#6fe3ff;cursor:pointer;';
    input.addEventListener('input', () => {
      const value = Number(input.value);
      miningTuning[spec.key] = value;
      // Keep the ejection-speed pair ordered.
      if (spec.key === 'chunkMinSpeedMps' && value > miningTuning.chunkMaxSpeedMps) {
        miningTuning.chunkMaxSpeedMps = value;
        miningSection
          .querySelectorAll<HTMLInputElement>('input[data-key="chunkMaxSpeedMps"]')
          .forEach((other) => {
            other.value = String(value);
            other.dispatchEvent(new Event('input'));
          });
      }
      if (spec.key === 'chunkMaxSpeedMps' && value < miningTuning.chunkMinSpeedMps) {
        miningTuning.chunkMinSpeedMps = value;
        miningSection
          .querySelectorAll<HTMLInputElement>('input[data-key="chunkMinSpeedMps"]')
          .forEach((other) => {
            other.value = String(value);
            other.dispatchEvent(new Event('input'));
          });
      }
      input.dataset.readout = `${value.toFixed(spec.decimals)} ${spec.unit}`;
    });
    input.dataset.key = spec.key;
    addRow(
      spec.label,
      input,
      () => {
        input.dataset.readout = `${Number(input.value).toFixed(spec.decimals)} ${spec.unit}`;
      },
      miningSection,
    );
  }

  let mining = false;
  const applyMode = (): void => {
    title.textContent = mining ? 'MINING TUNING' : 'RATE OF FIRE';
    gunsSection.style.display = mining ? 'none' : 'block';
    miningSection.style.display = mining ? 'block' : 'none';
  };
  applyMode();

  return {
    element: root,
    setMining(active: boolean): void {
      if (mining === active) return;
      mining = active;
      applyMode();
    },
    destroy(): void {
      root.remove();
    },
  };
}
