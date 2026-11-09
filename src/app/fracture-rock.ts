import { CanvasSource, Container, Graphics, Texture } from 'pixi.js';
import type { AsteroidField } from './asteroid-field';
import { fanTriangles } from './asteroid-collision';
import type { AsteroidCollider, Vec2 } from './asteroid-collision';
import { planPieCut } from './fracture-model';
import type { FragmentPlan } from './fracture-model';
import { createLitSprite } from './lit-sprite';
import type { LightingState, LitSprite } from './lit-sprite';
import { PIXELS_PER_METER } from './world-scale';

const SHELL_HITS_TO_BREAK = 3;
const WEAK_POINT_RADIUS_FRACTION = 0.62;
const WEAK_POINT_HIT_RADIUS_M = 1.8;
const FRAGMENT_LIFETIME_S = 9;
const FRAGMENT_FADE_S = 2;
const FRAGMENT_DAMPING = 0.7;
const CORE_RADIUS_M = 1.2;

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
  life: number;
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
    life: number;
    scale: number;
    screenX: number;
    screenY: number;
    alpha: number;
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
  core.zIndex = 10;
  core.visible = false;
  container.addChild(marker, crack, core);

  const fragments: FragmentBody[] = [];
  let shellBroken = false;
  let coreActive = false;
  let coreCollider: AsteroidCollider | null = null;
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
    const colour = hot ? 0xfff0c8 : 0xffb44a;
    marker
      .circle(screen.x, screen.y, radius * pulse)
      .stroke({ color: colour, width: 2, alpha: 0.85 });
    marker
      .circle(screen.x, screen.y, radius * 0.55)
      .stroke({ color: colour, width: 1, alpha: 0.55 });
    marker.circle(screen.x, screen.y, 3).fill({ color: colour, alpha: 0.95 });
    if (hot) {
      marker
        .circle(screen.x, screen.y, radius * 1.8)
        .stroke({ color: 0xffffff, width: 1, alpha: 0.7 });
    }
  };

  const spawnFragment = (plan: FragmentPlan, index: number, side: number): void => {
    const centroidArt = {
      x: plan.centroid.x / metresPerArtPixel,
      y: plan.centroid.y / metresPerArtPixel,
    };
    const baked = bakeFragmentArt(art.color, art.normal, plan.triangles, metresPerArtPixel);
    const lit = createLitSprite(baked.color, baked.normal);
    lit.mesh.name = 'fracture-fragment-mesh';
    lit.mesh.position.set(
      art.color.width / 2 - centroidArt.x,
      art.color.height / 2 - centroidArt.y,
    );
    const fragment = new Container();
    fragment.name = 'fracture-fragment';
    fragment.addChild(lit.mesh);
    container.addChild(fragment);

    const local = rotate(plan.centroid, shellCollider.rotation);
    const world = { x: shellCollider.x + local.x, y: shellCollider.y + local.y };
    const cutNormal = { x: -Math.sin(weakPointAngle), y: Math.cos(weakPointAngle) };
    const speed = 2.15 + index * 0.2;
    const tangent = side;
    const angle = shellCollider.rotation + side * 0.12;
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
      vx: cutNormal.x * speed * tangent + local.x * 0.18,
      vy: cutNormal.y * speed * tangent + local.y * 0.18,
      angle,
      angularVelocity: tangent * (0.35 + index * 0.12),
      life: FRAGMENT_LIFETIME_S,
    });
  };

  const breakShell = (): void => {
    shellBroken = true;
    marker.visible = false;
    crack.visible = false;
    asteroid.active = false;
    asteroid.mesh.mesh.visible = false;
    const triangles = fanTriangles(shellCollider.points).map((triangle) => triangle.points);
    const plans = planPieCut(triangles, weakPointAngle);
    plans.forEach((plan, index) => spawnFragment(plan, index, index === 0 ? 1 : -1));
    // Keep the exposed core above its shards.
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
  };

  const updateFragments = (frame: FractureFrame): void => {
    for (const fragment of fragments) {
      fragment.life -= frame.dt;
      if (fragment.life <= 0) {
        fragment.container.destroy({ children: true });
        for (const texture of fragment.textures) texture.destroy(true);
        continue;
      }
      fragment.vx *= Math.exp(-FRAGMENT_DAMPING * frame.dt);
      fragment.vy *= Math.exp(-FRAGMENT_DAMPING * frame.dt);
      fragment.x += fragment.vx * frame.dt;
      fragment.y += fragment.vy * frame.dt;
      fragment.angle += fragment.angularVelocity * frame.dt;
      fragment.angularVelocity *= Math.exp(-0.35 * frame.dt);
      fragment.collider.x = fragment.x;
      fragment.collider.y = fragment.y;
      fragment.collider.rotation = fragment.angle;

      const screen = screenPoint(fragment.x, fragment.y, frame);
      const scale = metresPerArtPixel * PIXELS_PER_METER * frame.zoom;
      fragment.container.position.set(screen.x, screen.y);
      fragment.container.rotation = fragment.angle;
      fragment.container.scale.set(scale);
      fragment.container.alpha = Math.min(1, fragment.life / FRAGMENT_FADE_S);
    }
    for (let index = fragments.length - 1; index >= 0; index -= 1) {
      if (fragments[index]!.life <= 0) fragments.splice(index, 1);
    }
  };

  const drawCrack = (frame: FractureFrame): void => {
    crack.clear();
    if (shellBroken || hitCount === 0) {
      crack.visible = false;
      return;
    }
    crack.visible = true;
    const dir = { x: Math.cos(weakPointAngle), y: Math.sin(weakPointAngle) };
    const perp = { x: -dir.y, y: dir.x };
    const radius = shellCollider.radius;
    // Ordered from the weak-point side through the centre to the far edge.
    const stops = [1.05, 0.82, 0.62, 0.45, 0.28, 0.1, -0.1, -0.3, -0.52, -0.75, -0.95, -1.05];
    const localPath = stops.map((stop, index) => {
      const wobble = Math.sin(index * 2.7 + 0.8) * radius * 0.075;
      return {
        x: dir.x * radius * stop + perp.x * wobble,
        y: dir.y * radius * stop + perp.y * wobble,
      };
    });
    const screenPath = localPath.map((point) => {
      const local = rotate(point, shellCollider.rotation);
      return screenPoint(shellCollider.x + local.x, shellCollider.y + local.y, frame);
    });
    // Shadowed fracture first, then the hot inner seam.
    crack.moveTo(screenPath[0]!.x, screenPath[0]!.y);
    for (const point of screenPath.slice(1)) crack.lineTo(point.x, point.y);
    crack.stroke({ color: 0x120b08, width: 5, alpha: 0.9 });
    crack.moveTo(screenPath[0]!.x, screenPath[0]!.y);
    for (const point of screenPath.slice(1)) crack.lineTo(point.x, point.y);
    crack.stroke({ color: 0xff5a24, width: 2.4, alpha: hitCount >= 2 ? 0.95 : 0.7 });
    crack.moveTo(screenPath[0]!.x, screenPath[0]!.y);
    for (const point of screenPath.slice(1)) crack.lineTo(point.x, point.y);
    crack.stroke({ color: 0xffd08a, width: 0.9, alpha: 0.9 });
    if (hitCount >= 2) {
      // A branch at the centre makes the second hit read as a spreading crack.
      const centre = screenPoint(shellCollider.x, shellCollider.y, frame);
      const branch = screenPoint(
        shellCollider.x +
          rotate({ x: perp.x * radius * 0.8, y: perp.y * radius * 0.8 }, shellCollider.rotation).x,
        shellCollider.y +
          rotate({ x: perp.x * radius * 0.8, y: perp.y * radius * 0.8 }, shellCollider.rotation).y,
        frame,
      );
      crack.moveTo(centre.x, centre.y).lineTo(branch.x, branch.y);
      crack.stroke({ color: 0xff6b2e, width: 1.8, alpha: 0.8 });
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
    const radius = Math.max(8, CORE_RADIUS_M * PIXELS_PER_METER * frame.zoom);
    core.circle(screen.x, screen.y, radius * 2.2).fill({ color: 0xff6b35, alpha: 0.08 });
    core.circle(screen.x, screen.y, radius * 1.5).fill({ color: 0xff8a3d, alpha: 0.16 });
    core.circle(screen.x, screen.y, radius * pulse).fill({ color: 0xffd28a, alpha: 0.82 });
    core.circle(screen.x, screen.y, radius * 0.45).fill({ color: 0xffffff, alpha: 0.9 });
    core
      .circle(screen.x, screen.y, radius * 1.7)
      .stroke({ color: 0xffa14a, width: 1, alpha: 0.55 });
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
      return shellBroken && coreActive && coreCollider ? [coreCollider] : [];
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
            life: fragment.life,
            scale: fragment.container.scale.x,
            screenX: screen.x,
            screenY: screen.y,
            alpha: fragment.container.alpha,
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
