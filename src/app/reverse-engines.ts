import { Container, Sprite, Texture } from 'pixi.js';

export interface ReverseEngineConfig {
  xOffset: number;
  yOffset: number;
  scale: number;
  /** Radians. */
  rotation: number;
}

export const DEFAULT_REVERSE_ENGINE_CONFIG: ReverseEngineConfig = {
  xOffset: 120,
  yOffset: -30,
  scale: 0.75,
  rotation: Math.PI,
};

export interface ReverseEngines {
  container: Container;
  setConfig(config: ReverseEngineConfig): void;
  update(screenX: number, screenY: number, rotation: number, scale: number): void;
  destroy(): void;
}

/** Two nozzle copies under the wing leading edges, drawn behind the ship. */
export function createReverseEngines(
  texture: Texture,
  initial: ReverseEngineConfig = DEFAULT_REVERSE_ENGINE_CONFIG,
): ReverseEngines {
  const container = new Container();
  const left = new Sprite({ texture, anchor: 0.5 });
  const right = new Sprite({ texture, anchor: 0.5 });
  container.addChild(left, right);

  const setConfig = (config: ReverseEngineConfig): void => {
    left.position.set(-config.xOffset, config.yOffset);
    right.position.set(config.xOffset, config.yOffset);
    left.rotation = config.rotation;
    right.rotation = config.rotation;
    left.scale.set(config.scale);
    right.scale.set(config.scale);
  };
  setConfig(initial);

  return {
    container,
    setConfig,
    update(screenX, screenY, rotation, scale): void {
      container.position.set(screenX, screenY);
      container.rotation = rotation;
      container.scale.set(scale);
    },
    destroy(): void {
      container.destroy({ children: true });
    },
  };
}
