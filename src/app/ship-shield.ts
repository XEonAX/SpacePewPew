import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { offsetPolygon } from './asteroid-collision';
import type { ShipHull, Vec2 } from './asteroid-collision';

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
/** Glow band inside the boundary: number of inward steps and their size. */
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
 * Trace a convex polygon with rounded corners: capsule-like edges joined by
 * arcs of `radius` at each vertex. This is the outline of the union of capsule
 * segments along the polygon's edges, so it matches the collider.
 */
function traceRoundedPolygon(graphics: Graphics, points: readonly Vec2[], radius: number): void {
  const count = points.length;
  const first = points[0]!;
  const second = points[1] ?? first;
  graphics.moveTo((first.x + second.x) / 2, (first.y + second.y) / 2);
  for (let index = 0; index < count; index += 1) {
    const corner = points[(index + 1) % count]!;
    const next = points[(index + 2) % count]!;
    graphics.arcTo(corner.x, corner.y, next.x, next.y, radius);
  }
  graphics.closePath();
}

/**
 * The ship's energy shield: a hull-shaped bubble drawn in ship-texture px so it
 * inherits the ship's transform, and the same hull used for collision. Its glow
 * hugs the boundary and fades toward the middle; impacts light up the contact
 * patch instead of the whole bubble.
 */
export function createShipShield(hull: ShipHull): ShipShield {
  const container = new Container();
  const glow = new Graphics();
  glow.blendMode = 'add';
  container.addChild(glow);

  const impactTexture = createImpactTexture();
  const impact = new Sprite({ texture: impactTexture, anchor: 0.5 });
  impact.blendMode = 'add';
  impact.visible = false;
  container.addChild(impact);

  // The outline is the hull polygon inflated by `radius`: a convex blend of
  // capsule segments along its edges. Offsetting the polygon first and rounding
  // its corners by the same radius traces that shape exactly.
  const outer = offsetPolygon(hull.points, hull.radius);
  const traceOuter = (target: Graphics): void => traceRoundedPolygon(target, outer, hull.radius);

  // Faint body fill, then a boundary glow that steps inward and fades: the
  // brightest light sits on the surface and the interior falls away.
  traceOuter(glow);
  glow.fill({ color: SHIELD_COLOR, alpha: 0.05 });
  traceOuter(glow);
  glow.stroke({ color: SHIELD_COLOR, width: 11, alpha: 0.16 });
  for (let ring = 1; ring <= EDGE_RINGS; ring += 1) {
    const bandRadius = Math.max(2, hull.radius - ring * EDGE_STEP_PX);
    const falloff = 1 - ring / (EDGE_RINGS + 1);
    traceRoundedPolygon(glow, offsetPolygon(hull.points, bandRadius), bandRadius);
    glow.stroke({
      color: SHIELD_COLOR,
      width: EDGE_STEP_PX * 1.1,
      alpha: 0.55 * falloff * falloff,
    });
  }
  // Hot boundary line, plus a second inner contour for depth.
  traceOuter(glow);
  glow.stroke({ color: SHIELD_EDGE_COLOR, width: 2.2, alpha: 1 });
  const innerContour = offsetPolygon(hull.points, hull.radius - EDGE_STEP_PX * 2);
  traceRoundedPolygon(glow, innerContour, hull.radius - EDGE_STEP_PX * 2);
  glow.stroke({ color: SHIELD_EDGE_COLOR, width: 1, alpha: 0.28 });

  // The impact bloom is masked to the shield, so it lights the bubble rather
  // than spilling into the empty space around it.
  const mask = new Graphics();
  traceOuter(mask);
  mask.fill({ color: 0xffffff });
  container.addChild(mask);
  impact.mask = mask;

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

      const extent = Math.max(
        ...hull.points.map((point) => Math.max(Math.abs(point.x), Math.abs(point.y))),
      );
      const size = extent * (0.75 + 0.5 * flash);
      impact.position.set(hitX, hitY);
      impact.width = size;
      impact.height = size;
      impact.alpha = flash;
      impact.visible = flash > 0.01;
    },
    destroy(): void {
      container.destroy({ children: true });
      glow.destroy();
      mask.destroy();
      impact.destroy();
      impactTexture.destroy(true);
    },
  };
}
