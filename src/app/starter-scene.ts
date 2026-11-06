import type { Application, Ticker } from 'pixi.js';
import { Container, Graphics, Text } from 'pixi.js';
import { clamp, lerp, smoothstep } from '../utils/math';

export interface StarterScene {
  setMuted(muted: boolean): void;
  destroy(): void;
}

const TITLE = 'SpacePewPew';
const SUBTITLE = 'PixiJS 8 · Vite · TypeScript · Howler';

/**
 * A deliberately tiny starter screen: proof that PixiJS renders, resizes and
 * reacts to input. Gameplay code should live in its own modules, not here.
 */
export function createStarterScene(app: Application): StarterScene {
  const root = new Container();

  // The spinning ring + orbit dots. One Graphics object keeps draw calls low.
  const ring = new Graphics()
    .circle(0, 0, 84)
    .stroke({ width: 2, color: 0x36e2ff, alpha: 0.85 })
    .circle(0, -84, 3)
    .fill(0x9af7ff)
    .circle(84, 0, 2)
    .fill(0x36e2ff)
    .circle(0, 60, 2)
    .fill(0x36e2ff);

  const title = new Text({
    text: TITLE,
    style: {
      fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
      fontSize: 42,
      fontWeight: '700',
      letterSpacing: 2,
      fill: '#e8f7ff',
    },
  });
  title.anchor.set(0.5);

  const subtitle = new Text({
    text: SUBTITLE,
    style: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      fill: '#7ea8c4',
    },
  });
  subtitle.anchor.set(0.5);

  const hint = new Text({
    text: 'click for audio · M to mute',
    style: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      fill: '#4f728c',
    },
  });
  hint.anchor.set(0.5);

  root.addChild(ring, title, subtitle, hint);
  app.stage.addChild(root);

  let elapsed = 0;
  let lastWidth = 0;
  let lastHeight = 0;
  let ringScale = 1;

  const layout = (): void => {
    const { width, height } = app.screen;
    if (width === lastWidth && height === lastHeight) return;
    lastWidth = width;
    lastHeight = height;

    const centerX = width / 2;
    const centerY = height / 2;

    ring.position.set(centerX, centerY);
    title.position.set(centerX, centerY - 8);
    subtitle.position.set(centerX, centerY + 44);
    hint.position.set(centerX, height - 28);

    // Scale the ring so the title and subtitle sit comfortably inside it.
    ringScale = (Math.min(width, height) * 0.3) / 84;

    title.scale.set(clamp(width / 760, 0.62, 1));
    subtitle.scale.set(clamp(width / 900, 0.75, 1));
  };

  const tick = (ticker: Ticker): void => {
    const deltaSeconds = Math.min(ticker.deltaMS / 1000, 0.05);
    elapsed += deltaSeconds;
    layout();

    ring.rotation += deltaSeconds * 0.25;
    const pulse = (Math.sin(elapsed * 1.4) + 1) / 2;
    ring.scale.set(ringScale * lerp(1, 1.035, pulse));
    ring.alpha = lerp(0.75, 1, pulse);
    root.alpha = smoothstep(0, 0.7, elapsed);
  };

  layout();
  root.alpha = 0;
  app.ticker.add(tick);

  return {
    setMuted(muted: boolean): void {
      hint.text = muted ? 'sound muted · M to unmute' : 'click for audio · M to mute';
    },
    destroy(): void {
      app.ticker.remove(tick);
      root.destroy({ children: true });
    },
  };
}
