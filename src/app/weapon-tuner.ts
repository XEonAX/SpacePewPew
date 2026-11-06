import { WEAPON_PAIRS, WEAPON_SHOT_DELAYS } from './weapons';

const PAIR_LABELS = ['Front pair', '2nd pair', '3rd pair', 'Rear pair'] as const;
const MAX_COOLDOWN = 2.5;

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

export interface WeaponTuner {
  element: HTMLElement;
  destroy(): void;
}

export function createWeaponTuner(cooldowns: number[]): WeaponTuner {
  const root = document.createElement('div');
  Object.assign(root.style, PANEL_STYLE);

  const title = document.createElement('div');
  title.textContent = 'RATE OF FIRE';
  title.style.cssText = 'margin-bottom:8px;color:#d8f3ff;letter-spacing:0.12em;font-size:10px;';
  root.append(title);

  WEAPON_PAIRS.forEach((pair, index) => {
    const minimum = Math.max(0.15, (WEAPON_SHOT_DELAYS[pair.sounds[0]!] ?? 0) + 0.05);
    const row = document.createElement('div');
    row.style.cssText = 'margin:6px 0;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;gap:8px;margin-bottom:2px;';
    const label = document.createElement('span');
    label.textContent = PAIR_LABELS[index] ?? `Pair ${index + 1}`;
    const readout = document.createElement('span');
    readout.style.cssText = 'color:#7fdfff;font-variant-numeric:tabular-nums;';

    const syncReadout = (cooldown: number): void => {
      readout.textContent = `${cooldown.toFixed(2)} s · ${(1 / cooldown).toFixed(2)}/s`;
    };

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(minimum);
    input.max = String(MAX_COOLDOWN);
    input.step = '0.01';
    input.value = String(cooldowns[index] ?? pair.cooldown);
    input.setAttribute('aria-label', `${PAIR_LABELS[index]} cooldown`);
    input.style.cssText = 'width:100%;margin:0;accent-color:#6fe3ff;cursor:pointer;';
    input.addEventListener('input', () => {
      const cooldown = Number(input.value);
      cooldowns[index] = cooldown;
      syncReadout(cooldown);
    });
    syncReadout(cooldowns[index] ?? pair.cooldown);

    header.append(label, readout);
    row.append(header, input);
    root.append(row);
  });

  return {
    element: root,
    destroy(): void {
      root.remove();
    },
  };
}
