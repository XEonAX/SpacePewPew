import { CanvasSource, Container, Graphics, Texture } from 'pixi.js';
import type { AsteroidField } from './asteroid-field';
import { fanTriangles } from './asteroid-collision';
import type { AsteroidCollider, Vec2 } from './asteroid-collision';
import { planWedgeCut } from './fracture-model';
import type { FragmentPlan } from './fracture-model';
import { createLitSprite } from './lit-sprite';
import type { LightingState, LitSprite } from './lit-sprite';
import { PIXELS_PER_METER } from './world-scale';

const SHELL_HITS_TO_BREAK = 3;
const WEAK_POINT_RADIUS_FRACTION = 0.62;
const WEAK_POINT_HIT_RADIUS_M = 1.8;
const FRAGMENT_DAMPING = 2.2;
/** Immediate separation so the two cut faces never stay welded together. */
const SEPARATION_GAP_M = 0.55;
/** Angle of the small cracked-out wedge; the remainder is >180°. */
const WEDGE_ANGLE = Math.PI * 0.55;
const CORE_RADIUS_M = 0.95;

interface FragmentBody {
  lit: LitSprite;
  container: Container;
  textures: Texture[];
  collider: AsteroidCollider;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  angularVelocity: number;
}

export interface FractureFrame {
  dustX: number;
  dustY: number;
  zoom: number;
  width: number;
  height: number;
  dt: number;
  /** Lighting clock, seconds. */
  now: number;
}

export interface FractureDebug {
  shellBroken: boolean;
  hits: number;
  weakPointWorld: { x: number; y: number };
  weakPointScreen: { x: number; y: number };
  coreExposed: boolean;
  coreWorld: { x: number; y: number } | null;
  coreScreen: { x: number; y: number } | null;
  fragmentCount: number;
  fragments: readonly {
    x: number;
    y: number;
    angle: number;
    scale: number;
    screenX: number;
    screenY: number;
    visible: boolean;
  }[];
}

export interface FractureRock {
  container: Container;
  update(frame: FractureFrame): void;
  setLighting(state: LightingState): void;
  /** Active shell/fragment/core colliders for ship and tracer collision. */
  getColliders(): readonly AsteroidCollider[];
  /** Only the exposed core is mineable; the shell must be shot open first. */
  getMiningTargets(): readonly AsteroidCollider[];
  /** Called by the bullet field when a tracer stops on a rock. */
  handleBulletHit(blocker: AsteroidCollider, x: number, y: number): void;
  getDebug(): FractureDebug;
  destroy(): void;
}

export interface FractureOptions {
  x: number;
  y: number;
  diameter: number;
  variant?: number;
  /** Angle in the rock's local frame where the weak point sits. */
  weakPointAngle?: number;
}

function rotate(point: Vec2, rotation: number): Vec2 {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

function screenPoint(x: number, y: number, frame: FractureFrame): { x: number; y: number } {
  return {
    x: (x * PIXELS_PER_METER - frame.dustX * frame.width) * frame.zoom + frame.width / 2,
    y: (y * PIXELS_PER_METER - frame.dustY * frame.height) * frame.zoom + frame.height / 2,
  };
}

function regularPolygon(radius: number, sides: number): Vec2[] {
  return Array.from({ length: sides }, (_, index) => {
    const angle = (index / sides) * Math.PI * 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

/**
 * The fragment visual is baked once into a texture instead of using a live
 * mask: Pixi masks on Mesh nodes are unreliable here, and a one-time canvas
 * clip is cheaper for a handful of shards. The colour and normal maps are
 * clipped identically so the custom lighting shader still works.
 */
function bakeFragmentArt(
  color: Texture,
  normal: Texture,
  triangles: readonly (readonly Vec2[])[],
  metresPerArtPixel: number,
): { color: Texture; normal: Texture } {
  const width = color.width;
  const height = color.height;
  const centreX = width / 2;
  const centreY = height / 2;
  const clip = (source: Texture): Texture => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Fragment art needs a 2D canvas context');
    context.drawImage(source.source.resource as CanvasImageSource, 0, 0, width, height);
    context.globalCompositeOperation = 'destination-in';
    context.beginPath();
    for (const triangle of triangles) {
      triangle.forEach((point, index) => {
        const x = centreX + point.x / metresPerArtPixel;
        const y = centreY + point.y / metresPerArtPixel;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.closePath();
    }
    context.fillStyle = '#ffffff';
    context.fill();
    return new Texture({ source: new CanvasSource({ resource: canvas }) });
  };
  return { color: clip(color), normal: clip(normal) };
}

export function createFractureRock(field: AsteroidField, options: FractureOptions): FractureRock {
  const asteroid = field.add(options.x, options.y, options.diameter, options.variant ?? 0);
  const art = asteroid.art;
  const shellCollider = asteroid.collider;
  const metresPerArtPixel = asteroid.diameter / art.color.width;
  const weakPointAngle = options.weakPointAngle ?? 0;
  const weakPointLocal = {
    x: Math.cos(weakPointAngle) * shellCollider.radius * WEAK_POINT_RADIUS_FRACTION,
    y: Math.sin(weakPointAngle) * shellCollider.radius * WEAK_POINT_RADIUS_FRACTION,
  };

  const container = new Container();
  container.name = 'fracture';
  container.sortableChildren = true;
  const marker = new Graphics();
  marker.zIndex = 20;
  const crack = new Graphics();
  crack.zIndex = 15;
  const core = new Graphics();
  core.zIndex = -10;
  core.visible = false;
  container.addChild(marker, crack, core);

  const fragments: FragmentBody[] = [];
  let shellBroken = false;
  let coreActive = false;
  let coreCollider: AsteroidCollider | null = null;
  let coreOwner: FragmentBody | null = null;
  let coreLocalOffset: Vec2 = { x: 0, y: 0 };
  let hitCount = 0;
  let hitFlash = 0;
  let lastFrame: FractureFrame | null = null;

  const weakPointWorld = (): { x: number; y: number } => {
    const local = rotate(weakPointLocal, shellCollider.rotation);
    return { x: shellCollider.x + local.x, y: shellCollider.y + local.y };
  };

  const drawMarker = (frame: FractureFrame, now: number): void => {
    marker.clear();
    if (shellBroken) {
      marker.visible = false;
      return;
    }
    marker.visible = true;
    const world = weakPointWorld();
    const screen = screenPoint(world.x, world.y, frame);
    const pulse = 0.82 + 0.18 * Math.sin(now * 5.2);
    const radius = Math.max(11, 1.05 * PIXELS_PER_METER * frame.zoom);
    const hot = hitFlash > 0;
    const colour = hot ? 0xffd38a : 0xffb44a;
    marker
      .circle(screen.x, screen.y, radius * pulse)
      .stroke({ color: colour, width: 2, alpha: 0.85 });
    marker
      .circle(screen.x, screen.y, radius * 0.55)
      .stroke({ color: colour, width: 1, alpha: 0.55 });
    marker.circle(screen.x, screen.y, 3).fill({ color: colour, alpha: 0.95 });
  };

  const spawnFragment = (plan: FragmentPlan, index: number, side: number): void => {
    const centroidArt = {
      x: plan.centroid.x / metresPerArtPixel,
      y: plan.centroid.y / metresPerArtPixel,
    };
    const baked = bakeFragmentArt(art.color, art.normal, plan.triangles, metresPerArtPixel);
    const lit = createLitSprite(baked.color, baked.normal);
    lit.mesh.name = 'fracture-fragment-mesh';
    // The shader geometry is centred on the art texture, so offsetting the
    // mesh by negative centroid puts the fragment's own centroid at local 0.
    lit.mesh.position.set(-centroidArt.x, -centroidArt.y);
    const fragment = new Container();
    fragment.name = 'fracture-fragment';
    fragment.addChild(lit.mesh);
    container.addChild(fragment);

    const local = rotate(plan.centroid, shellCollider.rotation);
    const cutNormal = { x: Math.cos(weakPointAngle), y: Math.sin(weakPointAngle) };
    // Push each piece half the gap away from the cut immediately, then let the
    // small velocity open it a little further. Damping stops them nearby.
    const gap = (SEPARATION_GAP_M / 2) * side;
    const world = {
      x: shellCollider.x + local.x + cutNormal.x * gap,
      y: shellCollider.y + local.y + cutNormal.y * gap,
    };
    const speed = 0.55 + index * 0.05;
    const tangent = side;
    const angle = shellCollider.rotation + side * 0.06;
    const colliderPoints = plan.hull.map((point) => ({
      x: point.x - plan.centroid.x,
      y: point.y - plan.centroid.y,
    }));
    let radius = 0;
    for (const point of colliderPoints) radius = Math.max(radius, Math.hypot(point.x, point.y));
    const collider: AsteroidCollider = {
      x: world.x,
      y: world.y,
      rotation: angle,
      points: colliderPoints,
      radius,
      ...(asteroid.collider.variant === undefined ? {} : { variant: asteroid.collider.variant }),
    };
    fragments.push({
      lit,
      container: fragment,
      textures: [baked.color, baked.normal],
      collider,
      x: world.x,
      y: world.y,
      vx: cutNormal.x * speed * tangent + local.x * 0.03,
      vy: cutNormal.y * speed * tangent + local.y * 0.03,
      angle,
      angularVelocity: tangent * 0.05,
    });
  };

  const breakShell = (): void => {
    shellBroken = true;
    marker.visible = false;
    crack.visible = false;
    asteroid.active = false;
    asteroid.mesh.mesh.visible = false;
    const triangles = fanTriangles(shellCollider.points).map((triangle) => triangle.points);
    const plans = planWedgeCut(triangles, weakPointAngle, WEDGE_ANGLE);
    const areas = plans.map((plan) =>
      plan.triangles.reduce((total, triangle) => {
        let area = 0;
        for (let index = 0; index < triangle.length; index += 1) {
          const a = triangle[index]!;
          const b = triangle[(index + 1) % triangle.length]!;
          area += a.x * b.y - b.x * a.y;
        }
        return total + Math.abs(area) / 2;
      }, 0),
    );
    const ownerIndex = areas.reduce(
      (best, area, index) => (area > (areas[best] ?? 0) ? index : best),
      0,
    );
    const ownerPlan = plans[ownerIndex];
    // The larger half owns the core at the original cut seam, beneath the
    // shell rather than painted on its surface.
    if (ownerPlan) {
      coreLocalOffset = { x: -ownerPlan.centroid.x, y: -ownerPlan.centroid.y };
    }
    plans.forEach((plan, index) => spawnFragment(plan, index, index === 0 ? 1 : -1));
    // zIndex keeps the core below the fragments even though it was added last.
    container.setChildIndex(core, container.children.length - 1);

    coreActive = true;
    core.visible = true;
    coreCollider = {
      x: shellCollider.x,
      y: shellCollider.y,
      rotation: 0,
      points: regularPolygon(CORE_RADIUS_M, 6),
      radius: CORE_RADIUS_M,
      ...(asteroid.collider.variant === undefined ? {} : { variant: asteroid.collider.variant }),
    };
    // The core is embedded in the larger half, not a free-floating third body.
    coreOwner = fragments[ownerIndex] ?? null;
  };

  const updateFragments = (frame: FractureFrame): void => {
    for (const fragment of fragments) {
      fragment.vx *= Math.exp(-FRAGMENT_DAMPING * frame.dt);
      fragment.vy *= Math.exp(-FRAGMENT_DAMPING * frame.dt);
      fragment.x += fragment.vx * frame.dt;
      fragment.y += fragment.vy * frame.dt;
      fragment.angle += fragment.angularVelocity * frame.dt;
      fragment.angularVelocity *= Math.exp(-1.2 * frame.dt);
      fragment.collider.x = fragment.x;
      fragment.collider.y = fragment.y;
      fragment.collider.rotation = fragment.angle;

      if (coreCollider && fragment === coreOwner) {
        const cos = Math.cos(fragment.angle);
        const sin = Math.sin(fragment.angle);
        coreCollider.x = fragment.x + coreLocalOffset.x * cos - coreLocalOffset.y * sin;
        coreCollider.y = fragment.y + coreLocalOffset.x * sin + coreLocalOffset.y * cos;
        coreCollider.rotation = fragment.angle;
      }

      const screen = screenPoint(fragment.x, fragment.y, frame);
      const scale = metresPerArtPixel * PIXELS_PER_METER * frame.zoom;
      fragment.container.position.set(screen.x, screen.y);
      fragment.container.rotation = fragment.angle;
      fragment.container.scale.set(scale);
      fragment.container.alpha = 1;
    }
  };

  const drawCrack = (frame: FractureFrame): void => {
    crack.clear();
    if (shellBroken || hitCount === 0) {
      crack.visible = false;
      return;
    }
    crack.visible = true;
    const half = WEDGE_ANGLE / 2;
    const edgeRadius = shellCollider.radius * 1.05;
    const ray = (angle: number, sign: number): { x: number; y: number }[] => {
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const perp = { x: -dir.y, y: dir.x };
      return [0, 0.18, 0.36, 0.55, 0.74, 0.9, 1.05].map((stop, index) => {
        const local = {
          x:
            dir.x * edgeRadius * stop +
            perp.x * Math.sin(index * 2.1 + sign) * shellCollider.radius * 0.05,
          y:
            dir.y * edgeRadius * stop +
            perp.y * Math.sin(index * 2.1 + sign) * shellCollider.radius * 0.05,
        };
        const rotated = rotate(local, shellCollider.rotation);
        return screenPoint(shellCollider.x + rotated.x, shellCollider.y + rotated.y, frame);
      });
    };
    const left = ray(weakPointAngle - half, 1.3);
    const right = ray(weakPointAngle + half, 2.8);
    for (const path of [left, right]) {
      crack.moveTo(path[0]!.x, path[0]!.y);
      for (const point of path.slice(1)) crack.lineTo(point.x, point.y);
      crack.stroke({
        color: 0xff5a24,
        width: hitCount >= 2 ? 3 : 2,
        alpha: hitCount >= 2 ? 0.95 : 0.75,
      });
      crack.moveTo(path[0]!.x, path[0]!.y);
      for (const point of path.slice(1)) crack.lineTo(point.x, point.y);
      crack.stroke({ color: 0xffd08a, width: 0.9, alpha: 0.9 });
    }
    const weak = weakPointWorld();
    const weakScreen = screenPoint(weak.x, weak.y, frame);
    crack.circle(weakScreen.x, weakScreen.y, Math.max(3, 0.16 * PIXELS_PER_METER * frame.zoom));
    crack.fill({ color: 0xfff0d0, alpha: 0.9 });
  };

  const drawCore = (frame: FractureFrame, now: number): void => {
    core.clear();
    if (!coreActive || !coreCollider) {
      core.visible = false;
      return;
    }
    core.visible = true;
    const screen = screenPoint(coreCollider.x, coreCollider.y, frame);
    const pulse = 0.9 + 0.1 * Math.sin(now * 4.5);
    const radius = Math.max(6, CORE_RADIUS_M * PIXELS_PER_METER * frame.zoom * 0.68);
    // Drawn beneath the fragments: the shell hides it except where the break
    // gap exposes the interior. It must not read as a disc on the surface.
    core.circle(screen.x, screen.y, radius * 2.8).fill({ color: 0x7c220b, alpha: 0.28 });
    core.circle(screen.x, screen.y, radius * 1.9).fill({ color: 0xff5f26, alpha: 0.38 });
    core.circle(screen.x, screen.y, radius * 1.15).fill({ color: 0xffb34f, alpha: 0.8 });
    core.circle(screen.x, screen.y, radius * 0.52).fill({ color: 0xfff0c8, alpha: 0.9 });
    core
      .circle(screen.x, screen.y, radius * (1.35 + 0.08 * pulse))
      .stroke({ color: 0xff7a33, width: 1, alpha: 0.35 });
  };

  return {
    container,
    update(frame: FractureFrame): void {
      lastFrame = frame;
      hitFlash = Math.max(0, hitFlash - frame.dt);
      // The field updates the shell transform; the marker tracks the live pose.
      drawMarker(frame, frame.now);
      drawCrack(frame);
      updateFragments(frame);
      drawCore(frame, frame.now);
    },
    setLighting(state: LightingState): void {
      for (const fragment of fragments) fragment.lit.setLighting(state, fragment.angle);
    },
    getColliders(): readonly AsteroidCollider[] {
      if (!shellBroken) return [shellCollider];
      const colliders: AsteroidCollider[] = fragments.map((fragment) => fragment.collider);
      if (coreCollider) colliders.push(coreCollider);
      return colliders;
    },
    getMiningTargets(): readonly AsteroidCollider[] {
      if (!shellBroken) return [];
      // The fragment shells are the asteroid surface. Because mining picks the
      // nearest target along each ray, they also occlude the core: only the
      // part of the core exposed through the gap can be cut.
      const targets: AsteroidCollider[] = fragments.map((fragment) => fragment.collider);
      if (coreActive && coreCollider) targets.push(coreCollider);
      return targets;
    },
    handleBulletHit(blocker: AsteroidCollider, x: number, y: number): void {
      if (shellBroken || blocker !== shellCollider) return;
      const weak = weakPointWorld();
      if (Math.hypot(x - weak.x, y - weak.y) > WEAK_POINT_HIT_RADIUS_M) return;
      hitCount += 1;
      hitFlash = 0.35;
      if (hitCount >= SHELL_HITS_TO_BREAK) breakShell();
    },
    getDebug(): FractureDebug {
      const weak = weakPointWorld();
      const frame = lastFrame;
      const coreWorld = coreCollider ? { x: coreCollider.x, y: coreCollider.y } : null;
      return {
        shellBroken,
        hits: hitCount,
        weakPointWorld: weak,
        weakPointScreen: frame ? screenPoint(weak.x, weak.y, frame) : { x: 0, y: 0 },
        coreExposed: coreActive,
        coreWorld,
        coreScreen: coreWorld && frame ? screenPoint(coreWorld.x, coreWorld.y, frame) : null,
        fragmentCount: fragments.length,
        fragments: fragments.map((fragment) => {
          const screen = frame ? screenPoint(fragment.x, fragment.y, frame) : { x: 0, y: 0 };
          return {
            x: fragment.x,
            y: fragment.y,
            angle: fragment.angle,
            scale: fragment.container.scale.x,
            screenX: screen.x,
            screenY: screen.y,
            visible: fragment.container.visible,
          };
        }),
      };
    },
    destroy(): void {
      for (const fragment of fragments) {
        fragment.container.destroy({ children: true });
        for (const texture of fragment.textures) texture.destroy(true);
      }
      fragments.length = 0;
      container.destroy({ children: true });
    },
  };
}
