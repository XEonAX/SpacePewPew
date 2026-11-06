import './styles.css';
import type { Application } from 'pixi.js';
import { createApp } from './app/create-app';
import { createScene } from './app/lighting-scene';
import { AudioManager } from './audio/audio';

declare global {
  interface Window {
    /**
     * Small inspection hook for the agent browser tooling. Do not use it as a
     * general application API.
     */
    __SPACEPEWPEW__?: {
      ready: boolean;
      app: Application;
    };
  }
}

const audio = new AudioManager({ baseUrl: import.meta.env.BASE_URL });

async function main(): Promise<void> {
  const mount = document.querySelector<HTMLDivElement>('#app');
  if (!mount) throw new Error('Missing #app mount point');

  const app = await createApp();
  mount.append(app.canvas);

  const scene = await createScene(app, audio);

  const unlockAudio = (): void => {
    void audio.enable();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyM') {
      scene.setMuted(audio.toggleMute());
      return;
    }
    unlockAudio();
  };

  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('keydown', onKeyDown);

  await audio.load();

  window.__SPACEPEWPEW__ = { ready: true, app };

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', onKeyDown);
      scene.destroy();
      audio.destroy();
      app.destroy(true, { children: true });
      delete window.__SPACEPEWPEW__;
    });
  }
}

void main().catch((error: unknown) => {
  console.error('[spacepewpew] startup failed', error);
  const mount = document.querySelector<HTMLDivElement>('#app');
  if (mount) mount.textContent = 'Failed to start. See the browser console.';
});
