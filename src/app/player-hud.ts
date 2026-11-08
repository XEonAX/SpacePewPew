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
  carry: 'curved' | 'physics';
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
  const carry = document.createElement('span');
  carry.className = 'hud-pill';
  carry.title = 'Mining carry mode — P toggles physics / curved arc';
  carry.textContent = 'CARRY: PHYSICS';
  const cargo = document.createElement('span');
  cargo.className = 'hud-pill';
  cargo.innerHTML = 'CARGO <b>0</b>';
  const cargoValue = cargo.querySelector('b');
  status.append(mode, carry, cargo);
  identity.append(brand, status);

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
    carry.textContent = state.carry === 'physics' ? 'CARRY: PHYSICS' : 'CARRY: CURVED';
    // Carry mode only matters while the mining rig is equipped.
    carry.classList.toggle('hud-pill--hidden', !mining);
    if (cargoValue) cargoValue.textContent = String(state.cargo);

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
