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
 * front pair and parks the six tractor barrels at their forward limit;
 * `mining-forward` parks the front laser pair forward while tractors still
 * track chunks autonomously.
 */
export type TurretAimMode = AimMode | 'mining' | 'mining-forward';

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

export function turretAimMode(
  weaponMode: WeaponMode,
  aimMode: AimMode,
  miningAimMode: AimMode = 'mouse',
): TurretAimMode {
  if (weaponMode === 'mining') {
    return miningAimMode === 'forward' ? 'mining-forward' : 'mining';
  }
  return aimMode;
}

export function gamepadHint(
  weaponMode: WeaponMode,
  aimMode: AimMode,
  muted: boolean,
  miningAimMode: AimMode = 'mouse',
): string {
  const controls =
    weaponMode === 'mining'
      ? `L stick steer · RT/LT thrust · R stick aim · A mining laser (5 s heat) · B stabilise · X guns · D-pad ←/→ ${miningAimMode === 'forward' ? 'forward' : 'mouse'}`
      : aimMode === 'mouse'
        ? 'L stick steer · RT/LT thrust · R stick aim · A fire · B stabilise · X mining'
        : 'L stick steer · RT/LT thrust · R stick aim · A fire all · B stabilise · X mining';
  return muted ? `${controls} · Start unmute` : `${controls} · Start mute`;
}

export function weaponHint(
  weaponMode: WeaponMode,
  aimMode: AimMode,
  muted: boolean,
  cargo = 0,
  carryMode: 'curved' | 'physics' = 'physics',
  miningAimMode: AimMode = 'mouse',
): string {
  const controls =
    weaponMode === 'mining'
      ? `W/S thrust · A/D turn · 1 mouse / 2 forward (lasers: ${miningAimMode}) · Tab guns · hold click: mining laser (5 s heat) · tractors auto · cargo: ${cargo} · carry: ${carryMode}`
      : aimMode === 'mouse'
        ? 'W/S thrust · A/D turn · 1 mouse / 2 forward · Space dock/undock · Tab mining · hold click: fire'
        : 'W/S thrust · A/D turn · 1 mouse / 2 forward · Space dock/undock · Tab mining · hold click: fire';
  return muted ? `${controls} · sound muted` : `${controls} · M: mute`;
}
