import { Application } from 'pixi.js';

export interface CreateAppOptions {
  background?: string;
}

/**
 * Creates and initialises the PixiJS application.
 *
 * Keep renderer setup here so the rest of the app only depends on an
 * initialised `Application`.
 */
export async function createApp({
  background = '#05070f',
}: CreateAppOptions = {}): Promise<Application> {
  const app = new Application();

  await app.init({
    background,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    resizeTo: window,
  });

  return app;
}
