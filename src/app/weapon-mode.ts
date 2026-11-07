/**
 * Turret aiming mode. `mouse` tracks the pointer inside each mount's cone;
 * `forward` parks every mount at the forward-most aim its cone allows and
 * fires all pairs from the keyboard.
 */
export type WeaponMode = 'mouse' | 'forward';

export const DEFAULT_WEAPON_MODE: WeaponMode = 'mouse';

export const WEAPON_MODE_KEY_CODES = new Set(['Digit1', 'Digit2']);

/** Digit1 selects mouse aiming, Digit2 selects all-forward. */
export function weaponModeForKey(code: string): WeaponMode | undefined {
  if (code === 'Digit1') return 'mouse';
  if (code === 'Digit2') return 'forward';
  return undefined;
}

export function weaponHint(mode: WeaponMode, muted: boolean): string {
  const controls =
    mode === 'mouse'
      ? 'W/S thrust · A/D turn · 1 mouse / 2 forward · hold click: fire'
      : 'W/S thrust · A/D turn · 1 mouse / 2 forward · hold Space: fire all weapons';
  return muted ? `${controls} · sound muted` : `${controls} · M: mute`;
}
