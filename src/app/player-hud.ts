import type { WeaponMode } from './weapon-mode';

export interface HudAim {
  x: number;
  y: number;
  active: boolean;
  kind: 'pointer' | 'stick';
}

export interface HudState {
  mode: WeaponMode;
  cargo: number;
  /** Per-barrel laser heat, 0..1 plus lockout flag. */
  laserHeat: readonly { heat: number; overheated: boolean }[];
  /** Both barrels are cutting the same small spot. */
  laserFocused: boolean;
  aim: HudAim;
  firing: boolean;
  touch: boolean;
}

export interface PlayerHud {
  element: HTMLElement;
  update(state: HudState): void;
  /** Contextual control hint; auto-fades after a few seconds. */
  setHint(text: string): void;
  destroy(): void;
}

const HINT_VISIBLE_MS = 6500;

/** Player-facing HUD: brand, mode/cargo status, reticle and hint line. */
export function createPlayerHud(): PlayerHud {
  const element = document.createElement('div');
  element.id = 'hud';
  element.setAttribute('aria-hidden', 'true');

  const identity = document.createElement('div');
  identity.className = 'hud-id';

  const brand = document.createElement('div');
  brand.className = 'hud-brand';
  brand.innerHTML = 'COLD ROCK<span>: PROSPECT</span>';

  const status = document.createElement('div');
  status.className = 'hud-status';
  const mode = document.createElement('span');
  mode.className = 'hud-pill hud-pill--mode';
  mode.textContent = 'GUNS';
  const cargo = document.createElement('span');
  cargo.className = 'hud-pill';
  cargo.innerHTML = 'CARGO <b>0</b>';
  const cargoValue = cargo.querySelector('b');
  status.append(mode, cargo);

  const heat = document.createElement('div');
  heat.className = 'hud-heat';
  const heatLabel = document.createElement('span');
  heatLabel.className = 'hud-heat__label';
  heatLabel.textContent = 'HEAT';
  heat.append(heatLabel);
  const heatBars = Array.from({ length: 2 }, () => {
    const bar = document.createElement('span');
    bar.className = 'hud-heat__bar';
    const fill = document.createElement('i');
    fill.className = 'hud-heat__fill';
    bar.append(fill);
    heat.append(bar);
    return { bar, fill };
  });
  identity.append(brand, status, heat);

  const hint = document.createElement('div');
  hint.className = 'hud-hint';

  const reticle = document.createElement('div');
  reticle.className = 'hud-reticle';
  reticle.innerHTML = '<i></i>';

  element.append(identity, hint, reticle);
  document.body.append(element);

  let hintTimer: ReturnType<typeof setTimeout> | null = null;

  const setHint = (text: string): void => {
    hint.textContent = text;
    hint.classList.add('hud-hint--visible');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(() => {
      hint.classList.remove('hud-hint--visible');
    }, HINT_VISIBLE_MS);
  };

  const update = (state: HudState): void => {
    const mining = state.mode === 'mining';
    mode.textContent = mining ? 'MINING' : 'GUNS';
    mode.classList.toggle('hud-pill--mining', mining);
    if (cargoValue) cargoValue.textContent = String(state.cargo);

    heat.classList.toggle('hud-heat--hidden', !mining);
    heat.classList.toggle('hud-heat--focus', mining && state.laserFocused);
    heatLabel.textContent = mining && state.laserFocused ? 'FOCUS' : 'HEAT';
    heatBars.forEach((bar, index) => {
      const readout = state.laserHeat[index];
      const value = Math.max(0, Math.min(1, readout?.heat ?? 0));
      bar.fill.style.transform = `scaleX(${value})`;
      bar.bar.classList.toggle('hud-heat__bar--hot', readout?.overheated === true);
    });

    const showReticle = state.aim.active;
    reticle.classList.toggle('hud-reticle--hidden', !showReticle);
    reticle.classList.toggle('hud-reticle--mining', mining);
    reticle.classList.toggle('hud-reticle--firing', state.firing);
    if (showReticle) {
      reticle.style.transform = `translate(${state.aim.x}px, ${state.aim.y}px) translate(-50%, -50%)`;
    }

    hint.classList.toggle('hud-hint--touch', state.touch);
  };

  return {
    element,
    update,
    setHint,
    destroy(): void {
      if (hintTimer) clearTimeout(hintTimer);
      element.remove();
    },
  };
}
