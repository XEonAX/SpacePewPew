import { readStick, wheelZoomFactor } from './input-model';

/** Logical actions consumed once per press, independent of the device. */
export type InputAction =
  | 'toggleWeapons'
  | 'aimMouse'
  | 'aimForward'
  | 'aimCycle'
  | 'carryMode'
  | 'mute'
  | 'colliders'
  | 'toggleDevUi';

export type InputSource = 'keyboard' | 'gamepad' | 'touch';

export interface AimInput {
  active: boolean;
  /** Pointer coordinates are canvas px; stick coordinates are -1..1. */
  kind: 'pointer' | 'stick';
  x: number;
  y: number;
}

export interface InputSnapshot {
  /** Analog thrust target, -1..1 (positive forward). */
  thrust: number;
  /** Analog turn target, -1..1 (positive right). */
  turn: number;
  stabilize: boolean;
  /** Primary trigger: mouse, gamepad RT/A, touch FIRE. */
  fire: boolean;
  /** Space: fire the whole battery in forward aim mode. */
  fireAll: boolean;
  aim: AimInput;
  /** Left-stick heading demand from a gamepad, separate from touch flight. */
  gamepadHeading: { active: boolean; x: number; y: number };
  zoom: number;
  gamepadConnected: boolean;
  touchVisible: boolean;
  source: InputSource;
}

export interface InputSystem {
  update(): void;
  snapshot(): InputSnapshot;
  /** Multiplicative zoom since the last call; 1 means no change. */
  consumeZoom(): number;
  consumeAction(action: InputAction): boolean;
  setTouchVisible(visible: boolean): void;
  destroy(): void;
}

export interface InputSystemOptions {
  canvas: HTMLCanvasElement;
  /** App-sized viewport used to map mouse coordinates into turret space. */
  getViewport: () => { width: number; height: number };
  /** Force the touch overlay on (useful for desktop testing). */
  forceTouch?: boolean;
  /** Called on any physical input, so the scene can unlock audio. */
  onActivity?: () => void;
}

const GAMEPAD_DEADZONE = 0.18;
const STICK_RADIUS_PX = 54;

const GAMEPAD_ACTIONS: Readonly<Record<number, InputAction>> = {
  2: 'toggleWeapons',
  3: 'carryMode',
  8: 'colliders',
  9: 'mute',
  11: 'aimCycle',
  12: 'toggleDevUi',
  14: 'aimMouse',
  15: 'aimForward',
};

const ACTION_BY_KEY: Readonly<Record<string, InputAction>> = {
  Tab: 'toggleWeapons',
  Digit1: 'aimMouse',
  Digit2: 'aimForward',
  KeyP: 'carryMode',
  KeyM: 'mute',
  F1: 'toggleDevUi',
  F2: 'colliders',
};

const MOVEMENT_KEYS = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyX']);

/** A stable, DOM-based input layer shared by every control device. */
export function createInputSystem(options: InputSystemOptions): InputSystem {
  const { canvas, getViewport } = options;
  const abort = new AbortController();
  const signal = abort.signal;

  const keys = new Set<string>();
  const actions = new Set<InputAction>();
  let pointerFire = false;
  let pointerX = 0;
  let pointerY = 0;
  let pendingZoom = 1;

  const aim: AimInput = { active: false, kind: 'pointer', x: 0, y: 0 };
  let source: InputSource = 'keyboard';

  // Touch state.
  let touchVisible = false;
  let touchFire = false;
  let touchStabilize = false;
  let touchZoomOut = false;
  let touchZoomIn = false;
  let touchThrust = 0;
  let touchTurn = 0;

  // Gamepad state.
  let gamepadConnected = false;
  let gamepadFire = false;
  let gamepadStabilize = false;
  let gamepadThrust = 0;
  let gamepadHeadingActive = false;
  let gamepadHeadingX = 0;
  let gamepadHeadingY = 0;
  let gamepadWasActive = false;
  let previousButtons: boolean[] = [];

  const activity = (): void => {
    options.onActivity?.();
  };

  const pressAction = (action: InputAction, inputSource: InputSource = 'keyboard'): void => {
    actions.add(action);
    source = inputSource;
    activity();
  };

  const setPointerAim = (clientX: number, clientY: number): void => {
    const bounds = canvas.getBoundingClientRect();
    const viewport = getViewport();
    pointerX = ((clientX - bounds.left) / Math.max(bounds.width, 1)) * viewport.width;
    pointerY = ((clientY - bounds.top) / Math.max(bounds.height, 1)) * viewport.height;
    aim.active = true;
    aim.kind = 'pointer';
    aim.x = pointerX;
    aim.y = pointerY;
    source = 'keyboard';
  };

  const setStickAim = (x: number, y: number, inputSource: InputSource): void => {
    aim.active = true;
    aim.kind = 'stick';
    aim.x = x;
    aim.y = y;
    source = inputSource;
  };

  // ---- keyboard + mouse ----

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const action = ACTION_BY_KEY[event.code];
    if (action) {
      event.preventDefault();
      if (!event.repeat) pressAction(action);
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      source = 'keyboard';
      keys.add('Space');
      activity();
      return;
    }
    if (MOVEMENT_KEYS.has(event.code)) {
      event.preventDefault();
      source = 'keyboard';
      keys.add(event.code);
      activity();
    }
  };

  const onKeyUp = (event: KeyboardEvent): void => {
    keys.delete(event.code);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      setTouchVisible(true);
      return;
    }
    if (event.button !== 0) return;
    setPointerAim(event.clientX, event.clientY);
    pointerFire = true;
    activity();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return;
    setPointerAim(event.clientX, event.clientY);
  };

  const onPointerUp = (): void => {
    pointerFire = false;
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    pendingZoom *= wheelZoomFactor(event.deltaY, event.deltaMode);
  };

  const onBlur = (): void => {
    keys.clear();
    pointerFire = false;
    touchFire = false;
    touchStabilize = false;
    touchZoomOut = false;
    touchZoomIn = false;
    touchThrust = 0;
    touchTurn = 0;
    gamepadFire = false;
    gamepadStabilize = false;
  };

  window.addEventListener('keydown', onKeyDown, { signal });
  window.addEventListener('keyup', onKeyUp, { signal });
  window.addEventListener('pointerup', onPointerUp, { signal });
  window.addEventListener('pointercancel', onPointerUp, { signal });
  window.addEventListener('blur', onBlur, { signal });
  canvas.addEventListener('pointerdown', onPointerDown, { signal });
  canvas.addEventListener('pointermove', onPointerMove, { signal });
  canvas.addEventListener('wheel', onWheel, { passive: false, signal });

  // ---- touch overlay ----

  const touchRoot = document.createElement('div');
  touchRoot.id = 'touch-controls';
  touchRoot.innerHTML = `
    <div class="touch-stick touch-stick--fly" data-stick="fly" aria-label="Flight stick">
      <div class="touch-stick__ring"></div><div class="touch-stick__knob"></div>
      <span class="touch-stick__label">FLY</span>
    </div>
    <button class="touch-button touch-button--fire" type="button" data-touch="fire" tabindex="-1">FIRE</button>
    <div class="touch-actions">
      <button class="touch-button" type="button" data-touch="aim" tabindex="-1">AIM</button>
      <button class="touch-button" type="button" data-touch="weapons" tabindex="-1">TAB</button>
      <button class="touch-button" type="button" data-touch="stabilize" tabindex="-1">STAB</button>
      <button class="touch-button" type="button" data-touch="carry" tabindex="-1">CARRY</button>
      <button class="touch-button touch-button--zoom" type="button" data-touch="zoom-out" tabindex="-1">−</button>
      <button class="touch-button touch-button--zoom" type="button" data-touch="zoom-in" tabindex="-1">+</button>
      <button class="touch-button touch-button--mute" type="button" data-touch="mute" tabindex="-1">MUTE</button>
    </div>
    <div class="touch-stick touch-stick--aim" data-stick="aim" aria-label="Aim stick">
      <div class="touch-stick__ring"></div><div class="touch-stick__knob"></div>
      <span class="touch-stick__label">AIM</span>
    </div>
  `;
  document.body.append(touchRoot);

  const stickElements = new Map<string, { root: HTMLElement; knob: HTMLElement }>();
  for (const root of Array.from(touchRoot.querySelectorAll<HTMLElement>('[data-stick]'))) {
    const knob = root.querySelector<HTMLElement>('.touch-stick__knob');
    if (knob) stickElements.set(root.dataset.stick ?? '', { root, knob });
  }

  const updateStickKnob = (name: string, x: number, y: number): void => {
    const stick = stickElements.get(name);
    if (stick) {
      stick.knob.style.transform = `translate(${x * STICK_RADIUS_PX}px, ${y * STICK_RADIUS_PX}px)`;
    }
  };

  const resetStickKnob = (name: string): void => {
    updateStickKnob(name, 0, 0);
  };

  const bindStick = (name: string): void => {
    const element = stickElements.get(name)?.root;
    if (!element) return;
    let pointerId: number | null = null;

    const read = (event: PointerEvent): void => {
      const bounds = element.getBoundingClientRect();
      const radius = Math.min(bounds.width, bounds.height) / 2;
      const rawX = (event.clientX - (bounds.left + bounds.width / 2)) / Math.max(radius, 1);
      const rawY = (event.clientY - (bounds.top + bounds.height / 2)) / Math.max(radius, 1);
      const stick = readStick(rawX, rawY);
      updateStickKnob(name, stick.x, stick.y);
      if (name === 'fly') {
        touchThrust = -stick.y;
        touchTurn = stick.x;
        source = 'touch';
      } else if (stick.magnitude > 0) {
        setStickAim(stick.x, stick.y, 'touch');
      }
    };

    element.addEventListener(
      'pointerdown',
      (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        pointerId = event.pointerId;
        try {
          element.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointers (tests) have no active capture target.
        }
        setTouchVisible(true);
        source = 'touch';
        activity();
        read(event);
      },
      { signal },
    );
    element.addEventListener(
      'pointermove',
      (event: PointerEvent) => {
        if (pointerId !== event.pointerId) return;
        event.preventDefault();
        read(event);
      },
      { signal },
    );
    const release = (event: PointerEvent): void => {
      if (pointerId !== event.pointerId) return;
      pointerId = null;
      resetStickKnob(name);
      if (name === 'fly') {
        touchThrust = 0;
        touchTurn = 0;
      }
    };
    element.addEventListener('pointerup', release, { signal });
    element.addEventListener('pointercancel', release, { signal });
    element.addEventListener('lostpointercapture', release, { signal });
  };

  bindStick('fly');
  bindStick('aim');

  const bindHoldButton = (selector: string, set: (held: boolean) => void): void => {
    const button = touchRoot.querySelector<HTMLElement>(selector);
    if (!button) return;
    const hold =
      (held: boolean) =>
      (event: PointerEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        button.classList.toggle('is-held', held);
        set(held);
        if (held) {
          source = 'touch';
          activity();
        }
      };
    button.addEventListener('pointerdown', hold(true), { signal });
    button.addEventListener('pointerup', hold(false), { signal });
    button.addEventListener('pointercancel', hold(false), { signal });
    button.addEventListener('lostpointercapture', hold(false), { signal });
  };

  bindHoldButton('[data-touch="fire"]', (held) => {
    touchFire = held;
  });
  bindHoldButton('[data-touch="stabilize"]', (held) => {
    touchStabilize = held;
  });
  bindHoldButton('[data-touch="zoom-out"]', (held) => {
    touchZoomOut = held;
  });
  bindHoldButton('[data-touch="zoom-in"]', (held) => {
    touchZoomIn = held;
  });

  const tapButton = (selector: string, onTap: () => void): void => {
    const button = touchRoot.querySelector<HTMLElement>(selector);
    if (!button) return;
    button.addEventListener(
      'pointerdown',
      (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        source = 'touch';
        activity();
        onTap();
      },
      { signal },
    );
  };
  tapButton('[data-touch="aim"]', () => pressAction('aimCycle', 'touch'));
  tapButton('[data-touch="weapons"]', () => pressAction('toggleWeapons', 'touch'));
  tapButton('[data-touch="carry"]', () => pressAction('carryMode', 'touch'));
  tapButton('[data-touch="mute"]', () => pressAction('mute', 'touch'));

  const setTouchVisible = (visible: boolean): void => {
    if (touchVisible === visible) return;
    touchVisible = visible;
    touchRoot.classList.toggle('touch-controls--visible', visible);
    document.body.classList.toggle('touch-ui', visible);
  };

  const removeTouch = (): void => {
    touchRoot.remove();
    document.body.classList.remove('touch-ui');
  };

  // Show automatically on touch-first devices, or when forced for testing.
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  setTouchVisible(options.forceTouch === true || coarsePointer);

  // ---- gamepad ----

  const onGamepadConnected = (): void => {
    source = 'gamepad';
    activity();
  };
  window.addEventListener('gamepadconnected', onGamepadConnected, { signal });
  window.addEventListener('gamepaddisconnected', onGamepadConnected, { signal });

  const pollGamepad = (): void => {
    if (typeof navigator.getGamepads !== 'function') return;
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (const candidate of pads) {
      if (candidate) {
        pad = candidate;
        break;
      }
    }
    if (!pad) {
      gamepadConnected = false;
      gamepadFire = false;
      gamepadStabilize = false;
      gamepadThrust = 0;
      gamepadHeadingActive = false;
      previousButtons = [];
      return;
    }
    gamepadConnected = true;

    // Left stick is a heading demand; triggers own main/reverse thrust.
    const left = readStick(pad.axes[0] ?? 0, pad.axes[1] ?? 0, GAMEPAD_DEADZONE);
    gamepadHeadingActive = left.magnitude > 0;
    if (gamepadHeadingActive) {
      gamepadHeadingX = left.x;
      gamepadHeadingY = left.y;
      source = 'gamepad';
    }
    const mainTrigger = Math.max(pad.buttons[7]?.value ?? 0, pad.buttons[7]?.pressed ? 1 : 0);
    const reverseTrigger = Math.max(pad.buttons[6]?.value ?? 0, pad.buttons[6]?.pressed ? 1 : 0);
    gamepadThrust = Math.max(-1, Math.min(1, mainTrigger - reverseTrigger));

    const right = readStick(pad.axes[2] ?? 0, pad.axes[3] ?? 0, GAMEPAD_DEADZONE);
    if (right.magnitude > 0) {
      setStickAim(right.x, right.y, 'gamepad');
    }

    gamepadFire = !!pad.buttons[0]?.pressed;
    gamepadStabilize = !!pad.buttons[1]?.pressed;
    const gamepadActiveNow =
      gamepadFire ||
      gamepadStabilize ||
      gamepadThrust !== 0 ||
      gamepadHeadingActive ||
      right.magnitude > 0;
    if (gamepadActiveNow) {
      source = 'gamepad';
      if (!gamepadWasActive) activity();
    }
    gamepadWasActive = gamepadActiveNow;

    const pressed = pad.buttons.map((button) => button.pressed);
    for (const [indexText, action] of Object.entries(GAMEPAD_ACTIONS)) {
      const index = Number(indexText);
      if (pressed[index] && !previousButtons[index]) pressAction(action, 'gamepad');
    }
    if (pressed[4]) pendingZoom *= 0.985;
    if (pressed[5]) pendingZoom *= 1.015;
    previousButtons = pressed;
  };

  const update = (): void => {
    pollGamepad();
    if (touchZoomOut) pendingZoom *= 0.985;
    if (touchZoomIn) pendingZoom *= 1.015;
  };

  const snapshot = (): InputSnapshot => {
    const keyboardThrust = keys.has('KeyW') ? 1 : keys.has('KeyS') ? -1 : 0;
    const keyboardTurn = keys.has('KeyD') ? 1 : keys.has('KeyA') ? -1 : 0;
    const thrust = Math.max(-1, Math.min(1, keyboardThrust + gamepadThrust + touchThrust));
    // Gamepad steering is a heading demand handled by the flight controller;
    // keyboard/touch turning stays direct.
    const turn = Math.max(-1, Math.min(1, keyboardTurn + touchTurn));
    return {
      thrust,
      turn,
      stabilize: keys.has('KeyX') || touchStabilize || gamepadStabilize,
      fire: pointerFire || touchFire || gamepadFire,
      fireAll: keys.has('Space'),
      aim: { ...aim },
      gamepadHeading: {
        active: gamepadHeadingActive,
        x: gamepadHeadingX,
        y: gamepadHeadingY,
      },
      zoom: pendingZoom,
      gamepadConnected,
      touchVisible,
      source,
    };
  };

  return {
    update,
    snapshot,
    consumeZoom(): number {
      const zoom = pendingZoom;
      pendingZoom = 1;
      return zoom;
    },
    consumeAction(action: InputAction): boolean {
      if (!actions.has(action)) return false;
      actions.delete(action);
      return true;
    },
    setTouchVisible,
    destroy(): void {
      abort.abort();
      removeTouch();
    },
  };
}
