import { describe, expect, it } from 'vitest';
import {
  IMPACT_FULL_ENERGY_J,
  SCRAPE_FULL_SPEED_MPS,
  SCRAPE_GAIN,
  impactRate,
  impactStrength,
  impactVolume,
  scrapeGain,
  scrapeRate,
} from '../src/app/impact-audio';

describe('impact audio', () => {
  it('maps hit energy to a 0..1 strength with a square-root curve', () => {
    expect(impactStrength(0)).toBe(0);
    expect(impactStrength(IMPACT_FULL_ENERGY_J / 4)).toBeCloseTo(0.5, 6);
    expect(impactStrength(IMPACT_FULL_ENERGY_J)).toBe(1);
    expect(impactStrength(IMPACT_FULL_ENERGY_J * 4)).toBe(1);
  });

  it('gets louder and lower as the hit gets heavier', () => {
    const light = impactVolume(0);
    const heavy = impactVolume(IMPACT_FULL_ENERGY_J);
    expect(heavy).toBeGreaterThan(light);
    expect(impactVolume(IMPACT_FULL_ENERGY_J * 4)).toBeCloseTo(heavy, 6);
    expect(impactRate(IMPACT_FULL_ENERGY_J)).toBeLessThan(impactRate(0));
  });

  it('scales the scrape bed from sliding speed and saturates', () => {
    expect(scrapeGain(0)).toBe(0);
    expect(scrapeGain(SCRAPE_FULL_SPEED_MPS / 2)).toBeCloseTo(SCRAPE_GAIN / 2, 6);
    expect(scrapeGain(SCRAPE_FULL_SPEED_MPS)).toBeCloseTo(SCRAPE_GAIN, 6);
    expect(scrapeGain(SCRAPE_FULL_SPEED_MPS * 10)).toBeCloseTo(SCRAPE_GAIN, 6);
    expect(scrapeGain(-3)).toBe(0);
    expect(scrapeRate(SCRAPE_FULL_SPEED_MPS)).toBeGreaterThan(scrapeRate(0));
  });
});
