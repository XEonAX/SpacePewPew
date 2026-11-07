import { describe, expect, it } from 'vitest';
import { createShipGeometry, SHIP_COM_AFT_PX } from '../src/app/ship-engines';
import type { EngineMount } from '../src/app/ship-engines';
import { MAIN_ENGINE_LAYOUT, REVERSE_ENGINE_LAYOUT } from '../src/app/engine-layout';

const METRES_PER_PIXEL = 1 / 64;
const HULL_LENGTH_M = 6;

function geometry() {
  return createShipGeometry({ metresPerPixel: METRES_PER_PIXEL, hullLengthM: HULL_LENGTH_M });
}

function mounts(predicate: (engine: EngineMount) => boolean): EngineMount[] {
  return geometry().engines.filter(predicate);
}

function mountAt(engines: EngineMount[], index: number): EngineMount {
  const found = engines.find((engine) => engine.index === index);
  if (!found) throw new Error(`missing engine ${index}`);
  return found;
}

describe('ship engine geometry', () => {
  it('places every baked nozzle relative to the centre of mass', () => {
    const mains = mounts((engine) => engine.group === 'main');
    const reverses = mounts((engine) => engine.group === 'reverse');

    expect(mains).toHaveLength(MAIN_ENGINE_LAYOUT.xOffsets.length);
    expect(reverses).toHaveLength(REVERSE_ENGINE_LAYOUT.xOffsets.length);

    const mainY = (MAIN_ENGINE_LAYOUT.yOffset - SHIP_COM_AFT_PX) * METRES_PER_PIXEL;
    const reverseY = (REVERSE_ENGINE_LAYOUT.flameBaseY - SHIP_COM_AFT_PX) * METRES_PER_PIXEL;

    MAIN_ENGINE_LAYOUT.xOffsets.forEach((xOffset, index) => {
      const engine = mountAt(mains, index);
      expect(engine.x).toBeCloseTo(xOffset * METRES_PER_PIXEL, 12);
      expect(engine.y).toBeCloseTo(mainY, 12);
      expect(engine.dirX).toBe(0);
      expect(engine.dirY).toBe(-1);
    });

    REVERSE_ENGINE_LAYOUT.xOffsets.forEach((xOffset, index) => {
      const engine = mountAt(reverses, index);
      expect(engine.x).toBeCloseTo(xOffset * METRES_PER_PIXEL, 12);
      expect(engine.y).toBeCloseTo(reverseY, 12);
      expect(engine.dirX).toBe(0);
      expect(engine.dirY).toBe(1);
    });
  });

  it('mirrors the side engines about the centreline', () => {
    const mains = mounts((engine) => engine.group === 'main');
    const reverses = mounts((engine) => engine.group === 'reverse');

    expect(mountAt(mains, 0).x).toBeCloseTo(-mountAt(mains, 2).x, 12);
    expect(mountAt(reverses, 0).x).toBeCloseTo(-mountAt(reverses, 1).x, 12);
    // The centre engine sits on the thrust axis, so it makes no yaw torque.
    expect(mountAt(mains, 1).x).toBeCloseTo(0, 12);
  });

  it('scales the arms with the layout and derives inertia from hull length', () => {
    const small = createShipGeometry({
      metresPerPixel: METRES_PER_PIXEL / 2,
      hullLengthM: HULL_LENGTH_M / 2,
    });
    const large = geometry();

    const smallMain = small.engines.find((engine) => engine.group === 'main');
    const largeMain = large.engines.find((engine) => engine.group === 'main');
    expect(smallMain?.x).toBeCloseTo((largeMain?.x ?? 0) / 2, 12);
    expect(smallMain?.y).toBeCloseTo((largeMain?.y ?? 0) / 2, 12);
    expect(small.radiusOfGyrationM).toBeCloseTo(large.radiusOfGyrationM / 2, 12);
    expect(large.radiusOfGyrationM).toBeCloseTo(0.3 * HULL_LENGTH_M, 12);
  });

  it('puts the main nozzles aft of the centre of mass and the reversers ahead', () => {
    for (const engine of mounts((candidate) => candidate.group === 'main')) {
      expect(engine.y).toBeGreaterThan(0);
    }
    for (const engine of mounts((candidate) => candidate.group === 'reverse')) {
      expect(engine.y).toBeLessThan(0);
    }
  });
});
