import { Container, Sprite, Texture } from 'pixi.js';

const ENGINE_X_OFFSETS = [-120, 120] as const;
const ENGINE_Y_OFFSET = -30;

export interface ReverseEngines {
  container: Container;
  update(screenX: number, screenY: number, rotation: number, scale: number): void;
  destroy(): void;
}

/** Two nozzle copies tucked under the wing leading edges, behind the ship. */
export function createReverseEngines(texture: Texture): ReverseEngines {
  const container = new Container();

  for (const offset of ENGINE_X_OFFSETS) {
    const sprite = new Sprite({ texture, anchor: 0.5 });
    sprite.x = offset;
    sprite.y = ENGINE_Y_OFFSET;
    sprite.rotation = Math.PI;
    container.addChild(sprite);
  }

  return {
    container,
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
