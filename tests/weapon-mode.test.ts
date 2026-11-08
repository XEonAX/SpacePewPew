import { describe, expect, it } from 'vitest';
import {
  AIM_MODE_KEY_CODES,
  DEFAULT_AIM_MODE,
  DEFAULT_WEAPON_MODE,
  WEAPON_MODE_KEY_CODE,
  aimModeForKey,
  gamepadHint,
  toggleWeaponMode,
  turretAimMode,
  weaponHint,
} from '../src/app/weapon-mode';

describe('weapon modes', () => {
  it('starts in the gun battery with mouse aiming', () => {
    expect(DEFAULT_WEAPON_MODE).toBe('guns');
    expect(DEFAULT_AIM_MODE).toBe('mouse');
  });

  it('cycles the weapon system with Tab', () => {
    expect(WEAPON_MODE_KEY_CODE).toBe('Tab');
    expect(toggleWeaponMode('guns')).toBe('mining');
    expect(toggleWeaponMode('mining')).toBe('guns');
  });

  it('maps Digit1 and Digit2 to the gun aiming modes', () => {
    expect(AIM_MODE_KEY_CODES.has('Digit1')).toBe(true);
    expect(AIM_MODE_KEY_CODES.has('Digit2')).toBe(true);
    expect(aimModeForKey('Digit1')).toBe('mouse');
    expect(aimModeForKey('Digit2')).toBe('forward');
    expect(aimModeForKey('Digit3')).toBeUndefined();
    expect(aimModeForKey('Tab')).toBeUndefined();
  });

  it('hands the turrets the right aim resolver', () => {
    expect(turretAimMode('guns', 'mouse')).toBe('mouse');
    expect(turretAimMode('guns', 'forward')).toBe('forward');
    expect(turretAimMode('mining', 'mouse')).toBe('mining');
    expect(turretAimMode('mining', 'forward')).toBe('mining');
    expect(turretAimMode('mining', 'mouse', 'forward')).toBe('mining-forward');
    expect(turretAimMode('mining', 'forward', 'mouse')).toBe('mining');
  });

  it('describes the gamepad controls separately', () => {
    const guns = gamepadHint('guns', 'mouse', false);
    expect(guns).toContain('L stick steer');
    expect(guns).toContain('RT/LT thrust');
    expect(guns).toContain('R stick aim');
    expect(guns).toContain('A fire');
    expect(guns).toContain('B stabilise');
    expect(guns).not.toContain('hold click');
    expect(gamepadHint('mining', 'mouse', false)).toContain('A mining laser');
    expect(gamepadHint('mining', 'mouse', false, 'forward')).toContain('D-pad ←/→ forward');
  });

  it('describes the active controls in the hint', () => {
    const gunsMouse = weaponHint('guns', 'mouse', false);
    expect(gunsMouse).toContain('hold click: fire');
    expect(gunsMouse).toContain('Tab mining');
    expect(gunsMouse).toContain('1 mouse / 2 forward');

    const gunsForward = weaponHint('guns', 'forward', false);
    expect(gunsForward).toContain('hold Space: fire all weapons');

    const mining = weaponHint('mining', 'mouse', false, 7);
    expect(mining).toContain('Tab guns');
    expect(mining).toContain('mining laser');
    expect(mining).toContain('tractors auto');
    expect(mining).toContain('cargo: 7');
    expect(mining).toContain('carry: physics');
    expect(weaponHint('mining', 'mouse', false, 7, 'physics', 'forward')).toContain(
      'lasers: forward',
    );
    expect(weaponHint('mining', 'mouse', false, 7, 'curved')).toContain('carry: curved');

    expect(weaponHint('guns', 'mouse', true)).toContain('sound muted');
    expect(weaponHint('guns', 'mouse', true)).not.toContain('M: mute');
  });
});
