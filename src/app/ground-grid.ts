import { Mesh, MeshGeometry, Shader, UniformGroup } from 'pixi.js';
import { PIXELS_PER_METER } from './world-scale';

/** 1 m minor cells, 5 m major cells. */
const MINOR_CELL = PIXELS_PER_METER;
const MAJOR_CELL = MINOR_CELL * 5;
/**
 * Half-extent of the camera-centred quad in world pixels. Large enough to cover
 * the viewport at the deepest zoom-out (0.02x) even on an 8K display.
 */
const QUAD_EXTENT = 200_000;

const vertex = `#version 300 es
precision highp float;

in vec2 aPosition;
in vec2 aUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec2 uCameraWorld;

out vec2 vWorld;

void main() {
    // The quad is authored in world pixels around the camera and offset by the
    // camera's world position, so vWorld is true world space at any distance.
    vWorld = aPosition + uCameraWorld;

    mat3 modelViewMatrix = uWorldTransformMatrix * uTransformMatrix;
    vec3 world = modelViewMatrix * vec3(aPosition, 1.0);
    vec3 clip = uProjectionMatrix * world;
    gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;

in vec2 vWorld;
out vec4 finalColor;

uniform float uZoom;

float gridMask(vec2 world, float cell, float thickness) {
    vec2 coord = world / cell;
    vec2 distanceToLine = abs(fract(coord + 0.5) - 0.5);
    vec2 width = fwidth(coord);
    vec2 line = 1.0 - smoothstep(vec2(0.0), width * thickness, distanceToLine);
    return max(line.x, line.y);
}

void main() {
    const float MINOR_CELL = ${MINOR_CELL.toFixed(1)};
    const float MAJOR_CELL = ${MAJOR_CELL.toFixed(1)};

    // Spacing on screen, used only to fade detail out as the camera pulls back.
    float minorSpacing = MINOR_CELL * uZoom;
    float majorSpacing = MAJOR_CELL * uZoom;
    float minorFade = smoothstep(5.0, 12.0, minorSpacing);
    float majorFade = smoothstep(5.0, 14.0, majorSpacing);

    float minor = gridMask(vWorld, MINOR_CELL, 1.1) * minorFade * 0.16;
    float major = gridMask(vWorld, MAJOR_CELL, 1.4) * majorFade * 0.30;

    vec3 minorColor = vec3(0.28, 0.58, 0.76);
    vec3 majorColor = vec3(0.52, 0.86, 1.0);
    vec3 color = mix(minorColor, majorColor, major);
    float alpha = max(minor, major);

    // World axes through the origin: vertical x=0 in warm amber, horizontal
    // y=0 in green. They are world-locked, so they make it obvious whether the
    // grid pans or anchors with the dust layer while the camera moves/zooms.
    float axisAlpha = 0.55;
    float verticalAxis = 1.0 - smoothstep(0.0, fwidth(vWorld.x) * 1.7, abs(vWorld.x));
    float horizontalAxis = 1.0 - smoothstep(0.0, fwidth(vWorld.y) * 1.7, abs(vWorld.y));
    color = mix(color, vec3(1.0, 0.62, 0.22), verticalAxis);
    color = mix(color, vec3(0.35, 0.95, 0.6), horizontalAxis);
    alpha = max(alpha, max(verticalAxis, horizontalAxis) * axisAlpha);

    if (alpha < 0.002) discard;
    finalColor = vec4(color * alpha, alpha);
}
`;

export interface GroundGrid {
  mesh: Mesh<MeshGeometry, Shader>;
  /**
   * `cameraWorld` is the camera's position in zoom-1 world pixels; the mesh is
   * kept centred on screen and scaled by `zoom`, so the camera point is always
   * the pivot of the zoom.
   */
  setView(
    cameraWorldX: number,
    cameraWorldY: number,
    zoom: number,
    width: number,
    height: number,
  ): void;
  destroy(): void;
}

export function createGroundGrid(): GroundGrid {
  const e = QUAD_EXTENT;
  const geometry = new MeshGeometry({
    positions: new Float32Array([-e, -e, e, -e, e, e, -e, e]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });

  const uniforms = new UniformGroup({
    uZoom: { value: 1, type: 'f32' },
    uCameraWorld: { value: new Float32Array(2), type: 'vec2<f32>' },
  });

  const shader = Shader.from({
    gl: { vertex, fragment },
    resources: { grid: uniforms },
  });

  const mesh = new Mesh({ geometry, shader });

  return {
    mesh,
    setView(cameraWorldX, cameraWorldY, zoom, width, height): void {
      // Keep the quad centred on the viewport; only the camera offset moves the
      // world inside it. That makes the camera point exactly the zoom pivot.
      mesh.position.set(width / 2, height / 2);
      mesh.scale.set(zoom, zoom);
      uniforms.uniforms.uZoom = zoom;
      uniforms.uniforms.uCameraWorld[0] = cameraWorldX;
      uniforms.uniforms.uCameraWorld[1] = cameraWorldY;
      uniforms.update();
    },
    destroy(): void {
      mesh.destroy({ children: true });
    },
  };
}
