import { Mesh, MeshGeometry, Shader, UniformGroup } from 'pixi.js';
import { PIXELS_PER_METER } from './world-scale';

/** 1 m minor cells, 5 m major cells. */
const MINOR_CELL = PIXELS_PER_METER;
const MAJOR_CELL = MINOR_CELL * 5;

const vertex = `#version 300 es
precision highp float;

in vec2 aPosition;
in vec2 aUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

out vec2 vScreen;

void main() {
    mat3 modelViewMatrix = uWorldTransformMatrix * uTransformMatrix;
    vec3 world = modelViewMatrix * vec3(aPosition, 1.0);
    vScreen = world.xy;

    vec3 clip = uProjectionMatrix * world;
    gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;

in vec2 vScreen;
out vec4 finalColor;

uniform vec2 uResolution;
uniform vec2 uCamera;
uniform float uZoom;

float gridMask(vec2 world, float cell, float thickness) {
    vec2 coord = world / cell;
    vec2 distanceToLine = abs(fract(coord + 0.5) - 0.5);
    vec2 width = fwidth(coord);
    vec2 line = 1.0 - smoothstep(vec2(0.0), width * thickness, distanceToLine);
    return max(line.x, line.y);
}

void main() {
    // Reconstruct zoom-1 world pixels from screen space so the grid is fixed
    // to the near dust layer rather than to the screen.
    vec2 world = (vScreen - uResolution * 0.5) / uZoom + uCamera * uResolution;

    const float MINOR_CELL = ${MINOR_CELL.toFixed(1)};
    const float MAJOR_CELL = ${MAJOR_CELL.toFixed(1)};

    float minorSpacing = MINOR_CELL * uZoom;
    float majorSpacing = MAJOR_CELL * uZoom;
    float minorFade = smoothstep(5.0, 12.0, minorSpacing);
    float majorFade = smoothstep(5.0, 14.0, majorSpacing);

    float minor = gridMask(world, MINOR_CELL, 1.1) * minorFade * 0.16;
    float major = gridMask(world, MAJOR_CELL, 1.4) * majorFade * 0.30;

    vec3 minorColor = vec3(0.28, 0.58, 0.76);
    vec3 majorColor = vec3(0.52, 0.86, 1.0);
    vec3 color = mix(minorColor, majorColor, major);
    float alpha = max(minor, major);

    if (alpha < 0.002) discard;
    finalColor = vec4(color * alpha, alpha);
}
`;

export interface GroundGrid {
  mesh: Mesh<MeshGeometry, Shader>;
  setView(cameraX: number, cameraY: number, zoom: number, width: number, height: number): void;
  destroy(): void;
}

export function createGroundGrid(): GroundGrid {
  const geometry = new MeshGeometry({
    positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });

  const uniforms = new UniformGroup({
    uResolution: { value: new Float32Array(2), type: 'vec2<f32>' },
    uCamera: { value: new Float32Array(2), type: 'vec2<f32>' },
    uZoom: { value: 1, type: 'f32' },
  });

  const shader = Shader.from({
    gl: { vertex, fragment },
    resources: { grid: uniforms },
  });

  const mesh = new Mesh({ geometry, shader });

  return {
    mesh,
    setView(cameraX, cameraY, zoom, width, height): void {
      mesh.position.set(0, 0);
      mesh.scale.set(width, height);
      uniforms.uniforms.uResolution = new Float32Array([width, height]);
      uniforms.uniforms.uCamera = new Float32Array([cameraX, cameraY]);
      uniforms.uniforms.uZoom = zoom;
      uniforms.update();
    },
    destroy(): void {
      mesh.destroy({ children: true });
    },
  };
}
