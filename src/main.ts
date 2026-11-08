import './styles.css';
import type { Application } from 'pixi.js';
import type { AsteroidCollider } from './app/asteroid-collision';
import { createApp } from './app/create-app';
import { createScene } from './app/lighting-scene';
import { AudioManager } from './audio/audio';
import { pingVisit } from './app/analytics';
import { createLoadingScreen } from './app/loading-screen';

declare global {
  interface Window {
    /**
     * Small inspection hook for the agent browser tooling. Do not use it as a
     * general application API.
     */
    __SPACEPEWPEW__?: {
      ready: boolean;
      app: Application;
      /** Debug: current asteroid colliders (world metres, local points). */
      getColliders: () => readonly AsteroidCollider[];
      /** Debug: current ship pose (world metres/radians) for screenshot staging. */
      getShipPose: () => { x: number; y: number; rotation: number };
      /** Debug: stage an asteroid for screenshots and harness tests, world metres. */
      stageAsteroid: (x: number, y: number, diameter: number, variant?: number) => void;
    };
  }
}

const audio = new AudioManager({ baseUrl: import.meta.env.BASE_URL });

async function main(): Promise<void> {
  pingVisit();
  const loading = createLoadingScreen();
  document.body.append(loading.element);

  try {
    const mount = document.querySelector<HTMLDivElement>('#app');
    if (!mount) throw new Error('Missing #app mount point');

    const app = await createApp();
    mount.append(app.canvas);

    loading.setStatus('Loading art…');
    const scene = await createScene(app, audio, ({ loaded, total }) => {
      loading.setProgress(loaded, total);
    });

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

    loading.setStatus('Waking the audio…');
    loading.setIndeterminate(true);
    await audio.load();
    loading.finish();

    window.__SPACEPEWPEW__ = {
      ready: true,
      app,
      getColliders: scene.getColliders,
      getShipPose: scene.getShipPose,
      stageAsteroid: scene.stageAsteroid,
    };

    if (import.meta.hot) {
      import.meta.hot.dispose(() => {
        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', onKeyDown);
        scene.destroy();
        audio.destroy();
        app.destroy(true, { children: true });
        delete window.__SPACEPEWPEW__;
        loading.destroy();
      });
    }
  } catch (error) {
    loading.fail('Startup failed — see the browser console.');
    throw error;
  }
}

void main().catch((error: unknown) => {
  console.error('[spacepewpew] startup failed', error);
  const mount = document.querySelector<HTMLDivElement>('#app');
  if (mount) mount.textContent = 'Failed to start. See the browser console.';
});
