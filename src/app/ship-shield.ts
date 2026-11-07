import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { ShipCapsule } from './asteroid-collision';

export interface ShieldFrame {
  /** Ship position on screen, px. */
  x: number;
  y: number;
  rotation: number;
  /** Ship texture px → screen px (shipBaseScale × zoom). */
  scale: number;
  dt: number;
  /** Inward impact speed in m/s this frame; > 0 highlights the hit point. */
  impact: number;
  /** Contact point in ship-local texture px (0,0 = ship centre). */
  impactX: number;
  impactY: number;
}

export interface ShipShield {
  container: Container;
  update(frame: ShieldFrame): void;
  destroy(): void;
}

const SHIELD_COLOR = 0x7fdcff;
const SHIELD_EDGE_COLOR = 0xdaf7ff;
/** Resting glow strength of the boundary; always visible, clearly a surface. */
const IDLE_ALPHA = 0.58;
const IMPACT_DECAY_PER_SECOND = 3.4;
/** Impact speed (m/s) that saturates the highlight. */
const FULL_FLASH_IMPACT = 6;
/** Glow band at the boundary fading inward: number of inset strokes and step. */
const EDGE_RINGS = 7;
const EDGE_STEP_PX = 5;
const BREATH_RATE = 1.6;
const IMPACT_TEXTURE_SIZE = 128;

function createImpactTexture(): Texture {
  const size = IMPACT_TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const half = size / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.22, 'rgba(210, 245, 255, 0.9)');
    gradient.addColorStop(0.55, 'rgba(110, 210, 255, 0.35)');
    gradient.addColorStop(1, 'rgba(70, 170, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

/**
 * The ship's energy shield: an oval capsule drawn in ship-texture pixels so it
 * inherits the ship's transform, and the same capsule used for collision. Its
 * glow hugs the boundary and fades toward the middle; impacts light up the
 * contact patch instead of the whole bubble.
 */
export function createShipShield(capsule: ShipCapsule): ShipShield {
  const container = new Container();
  const glow = new Graphics();
  glow.blendMode = 'add';
  container.addChild(glow);

  const impactTexture = createImpactTexture();
  const impact = new Sprite({ texture: impactTexture, anchor: 0.5 });
  impact.blendMode = 'add';
  impact.visible = false;
  container.addChild(impact);

  const { halfLength, radius } = capsule;
  const left = -radius;
  const top = -(halfLength + radius);
  const width = radius * 2;
  const height = (halfLength + radius) * 2;

  // Faint body fill, then a boundary glow that steps inward and fades: the
  // brightest light sits on the surface and the interior falls away.
  glow.roundRect(left, top, width, height, radius).fill({ color: SHIELD_COLOR, alpha: 0.06 });
  for (let ring = 0; ring < EDGE_RINGS; ring += 1) {
    const inset = ring * EDGE_STEP_PX;
    const falloff = 1 - ring / EDGE_RINGS;
    glow
      .roundRect(left + inset, top + inset, width - inset * 2, height - inset * 2, radius - inset)
      .stroke({
        color: SHIELD_COLOR,
        width: EDGE_STEP_PX * 1.1,
        alpha: 0.5 * falloff * falloff,
      });
  }
  // Hot boundary line.
  glow
    .roundRect(left, top, width, height, radius)
    .stroke({ color: SHIELD_EDGE_COLOR, width: 2, alpha: 1 });

  let flash = 0;
  let hitX = 0;
  let hitY = 0;
  let time = 0;

  return {
    container,
    update(frame: ShieldFrame): void {
      time += frame.dt;
      if (frame.impact > 0) {
        flash = Math.max(flash, Math.min(1, frame.impact / FULL_FLASH_IMPACT));
        hitX = frame.impactX;
        hitY = frame.impactY;
      }
      flash = Math.max(0, flash - frame.dt * IMPACT_DECAY_PER_SECOND);

      container.position.set(frame.x, frame.y);
      container.rotation = frame.rotation;
      // A small swell on impact sells the hit without moving the collider.
      container.scale.set(frame.scale * (1 + flash * 0.03));

      const breath = Math.sin(time * BREATH_RATE) * 0.05;
      glow.alpha = Math.max(0.4, IDLE_ALPHA + breath) + flash * 0.3;

      const size = radius * (1.5 + 1.1 * flash);
      impact.position.set(hitX, hitY);
      impact.width = size;
      impact.height = size;
      impact.alpha = flash;
      impact.visible = flash > 0.01;
    },
    destroy(): void {
      container.destroy({ children: true });
      glow.destroy();
      impact.destroy();
      impactTexture.destroy(true);
    },
  };
}
