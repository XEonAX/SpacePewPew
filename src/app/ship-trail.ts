import { Graphics } from 'pixi.js';

const TRAIL_LIFETIME_SECONDS = 0.28;
const MAX_SAMPLES = 48;

interface TrailSample {
  x: number;
  y: number;
  time: number;
}

interface TrailFrame {
  /** Engine position in dust-world pixels at zoom 1. */
  x: number;
  y: number;
  active: boolean;
  now: number;
  cameraX: number;
  cameraY: number;
  zoom: number;
  width: number;
  height: number;
}

export interface ShipTrail {
  graphics: Graphics;
  update(frame: TrailFrame): void;
  destroy(): void;
}

/**
 * A short additive ribbon behind the ship's engines. Samples live in dust-world
 * space, so the trail stays fixed to the gameplay layer while the camera moves.
 */
export function createShipTrail(): ShipTrail {
  const graphics = new Graphics();
  graphics.blendMode = 'add';
  graphics.eventMode = 'none';

  const samples: TrailSample[] = [];

  return {
    graphics,
    update(frame: TrailFrame): void {
      if (frame.active) {
        samples.push({ x: frame.x, y: frame.y, time: frame.now });
        if (samples.length > MAX_SAMPLES) samples.shift();
      }

      while (samples.length > 0 && frame.now - samples[0]!.time > TRAIL_LIFETIME_SECONDS) {
        samples.shift();
      }

      graphics.clear();
      for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1]!;
        const current = samples[index]!;
        const age = (frame.now - current.time) / TRAIL_LIFETIME_SECONDS;
        const fade = Math.max(0, 1 - age);
        if (fade <= 0) continue;

        const coreWidth = 2 + 10 * fade;
        const glowWidth = 6 + 24 * fade;
        const coreAlpha = 0.65 * fade;
        const glowAlpha = 0.14 * fade;

        graphics
          .moveTo(previous.x, previous.y)
          .lineTo(current.x, current.y)
          .stroke({ width: glowWidth, color: 0x2a8fb8, alpha: glowAlpha, cap: 'round' });
        graphics
          .moveTo(previous.x, previous.y)
          .lineTo(current.x, current.y)
          .stroke({ width: coreWidth, color: 0x9ff8ff, alpha: coreAlpha, cap: 'round' });
      }

      graphics.position.set(
        -frame.cameraX * frame.width * frame.zoom + frame.width / 2,
        -frame.cameraY * frame.height * frame.zoom + frame.height / 2,
      );
      graphics.scale.set(frame.zoom);
    },
    destroy(): void {
      graphics.destroy();
    },
  };
}
