/**
 * Shared engine layout. The reverse-engine values must stay in sync with the
 * reverse nozzles baked into ship-color.webp / ship-normal.webp.
 */
export const MAIN_ENGINE_LAYOUT = {
  xOffsets: [-80, 0, 80] as const,
  yOffset: 410,
  flameWidth: 44,
  flameLength: 190,
} as const;

const REVERSE_ENGINE_ART_HEIGHT = 66;
const REVERSE_ENGINE_SCALE = 0.58;
const REVERSE_ENGINE_Y_OFFSET = 50;

export const REVERSE_ENGINE_LAYOUT = {
  xOffsets: [-167, 167] as const,
  scale: REVERSE_ENGINE_SCALE,
  rotation: Math.PI,
  flameWidth: MAIN_ENGINE_LAYOUT.flameWidth * REVERSE_ENGINE_SCALE,
  flameLength: MAIN_ENGINE_LAYOUT.flameLength * REVERSE_ENGINE_SCALE,
  // Nozzle face after the 180° bake: engine center minus half the baked height.
  flameBaseY: REVERSE_ENGINE_Y_OFFSET - (REVERSE_ENGINE_ART_HEIGHT * REVERSE_ENGINE_SCALE) / 2,
} as const;
