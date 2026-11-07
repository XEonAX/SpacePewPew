import { describe, expect, it } from 'vitest';
import { DEFAULT_WEAPON_MODE, weaponHint, weaponModeForKey } from '../src/app/weapon-mode';

describe('weapon modes', () => {
  it('defaults to mouse aiming', () => {
    expect(DEFAULT_WEAPON_MODE).toBe('mouse');
  });

  it('maps Digit1 to mouse aiming and Digit2 to all-forward', () => {
    expect(weaponModeForKey('Digit1')).toBe('mouse');
    expect(weaponModeForKey('Digit2')).toBe('forward');
  });

  it('ignores unrelated keys', () => {
    expect(weaponModeForKey('Digit3')).toBeUndefined();
    expect(weaponModeForKey('Space')).toBeUndefined();
    expect(weaponModeForKey('KeyW')).toBeUndefined();
  });

  it('describes the active controls in the hint', () => {
    const mouse = weaponHint('mouse', false);
    const forward = weaponHint('forward', false);
    expect(mouse).toContain('hold click: fire');
    expect(forward).toContain('hold Space: fire all weapons');
    expect(mouse).toContain('M: mute');
    expect(weaponHint('forward', true)).toContain('sound muted');
    expect(weaponHint('forward', true)).not.toContain('M: mute');
  });
});
