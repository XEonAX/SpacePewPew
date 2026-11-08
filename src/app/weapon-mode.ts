/**
 * Weapon systems. `guns` is the combat battery (with two aiming modes);
 * `mining` replaces the battery with front mining lasers and autonomous
 * tractor beams. Tab toggles the system; 1/2 pick how the guns aim.
 */
export type WeaponMode = 'guns' | 'mining';

/** How the gun battery aims: pointer tracking or all barrels forward. */
export type AimMode = 'mouse' | 'forward';

/**
 * Aim resolver handed to the turrets. `mining` tracks the pointer with the
 * front pair only and parks the six tractor barrels at their forward limit.
 */
export type TurretAimMode = AimMode | 'mining';

export const DEFAULT_WEAPON_MODE: WeaponMode = 'guns';
export const DEFAULT_AIM_MODE: AimMode = 'mouse';

export const AIM_MODE_KEY_CODES = new Set(['Digit1', 'Digit2']);
export const WEAPON_MODE_KEY_CODE = 'Tab';

/** Digit1 selects mouse aiming, Digit2 selects all-forward. */
export function aimModeForKey(code: string): AimMode | undefined {
  if (code === 'Digit1') return 'mouse';
  if (code === 'Digit2') return 'forward';
  return undefined;
}

export function toggleWeaponMode(mode: WeaponMode): WeaponMode {
  return mode === 'guns' ? 'mining' : 'guns';
}

export function turretAimMode(weaponMode: WeaponMode, aimMode: AimMode): TurretAimMode {
  return weaponMode === 'mining' ? 'mining' : aimMode;
}

export function weaponHint(
  weaponMode: WeaponMode,
  aimMode: AimMode,
  muted: boolean,
  cargo = 0,
  carryMode: 'curved' | 'physics' = 'physics',
): string {
  const controls =
    weaponMode === 'mining'
      ? `W/S thrust · A/D turn · Tab guns · hold click: mining laser · tractors auto · cargo: ${cargo} · carry: ${carryMode}`
      : aimMode === 'mouse'
        ? 'W/S thrust · A/D turn · 1 mouse / 2 forward · Tab mining · hold click: fire'
        : 'W/S thrust · A/D turn · 1 mouse / 2 forward · Tab mining · hold Space: fire all weapons';
  return muted ? `${controls} · sound muted` : `${controls} · M: mute`;
}
