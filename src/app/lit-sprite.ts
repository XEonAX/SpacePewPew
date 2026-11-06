import type { Texture } from 'pixi.js';
import {
  CanvasSource,
  Mesh,
  MeshGeometry,
  Shader,
  Texture as PixiTexture,
  UniformGroup,
} from 'pixi.js';

export interface LightingState {
  ambient: [number, number, number];
  keyDirection: [number, number];
  keyColor: [number, number, number];
  keyIntensity: number;
  time: number;
}

const vertex = `#version 300 es
precision highp float;

in vec2 aPosition;
in vec2 aUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

out vec2 vUV;
out vec2 vWorldPos;

void main() {
    mat3 modelViewMatrix = uWorldTransformMatrix * uTransformMatrix;
    vec3 world = modelViewMatrix * vec3(aPosition, 1.0);

    vUV = aUV;
    vWorldPos = world.xy;

    vec3 clip = uProjectionMatrix * world;
    gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

const fragment = `#version 300 es
precision highp float;

in vec2 vUV;
in vec2 vWorldPos;

out vec4 finalColor;

uniform sampler2D uDiffuse;
uniform sampler2D uNormal;
uniform sampler2D uEmissive;
uniform sampler2D uGlow;

uniform float uRotation;
uniform float uTime;
uniform vec3 uAmbient;
uniform vec2 uKeyDirection;
uniform vec3 uKeyColor;
uniform float uKeyIntensity;

void main() {
    vec4 base = texture(uDiffuse, vUV);
    if (base.a < 0.01) discard;

    vec3 normal = normalize(texture(uNormal, vUV).rgb * 2.0 - 1.0);

    // Rotate the tangent-space normal into world space as the sprite spins.
    float cosRotation = cos(uRotation);
    float sinRotation = sin(uRotation);
    normal.xy = mat2(cosRotation, -sinRotation, sinRotation, cosRotation) * normal.xy;

    float key = max(dot(normal, normalize(vec3(uKeyDirection, 0.65))), 0.0);
    vec3 light = uAmbient + uKeyColor * (uKeyIntensity * key);

    // Soft-knee clamp so stylized highlights don't clip to white.
    light = light / (1.0 + max(light - vec3(1.0), vec3(0.0)) * 0.3);

    float pulse = 0.86 + 0.14 * sin(uTime * 2.2);
    vec3 emissive = texture(uEmissive, vUV).rgb * pulse * 1.3 + texture(uGlow, vUV).rgb * pulse * 0.9;

    finalColor = vec4(base.rgb * light + emissive, base.a);
}
`;

export interface LitSprite {
  mesh: Mesh<MeshGeometry, Shader>;
  uniforms: UniformGroup;
  setLighting(state: LightingState): void;
}

function createEmptyTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return new PixiTexture({ source: new CanvasSource({ resource: canvas }) });
}

const EMPTY_TEXTURE = createEmptyTexture();

export function createLitSprite(
  diffuse: Texture,
  normalMap: Texture,
  emissive: Texture = EMPTY_TEXTURE,
  glow: Texture = EMPTY_TEXTURE,
): LitSprite {
  const width = diffuse.width;
  const height = diffuse.height;

  const geometry = new MeshGeometry({
    positions: new Float32Array([
      -width / 2,
      -height / 2,
      width / 2,
      -height / 2,
      width / 2,
      height / 2,
      -width / 2,
      height / 2,
    ]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });

  const uniforms = new UniformGroup({
    uRotation: { value: 0, type: 'f32' },
    uTime: { value: 0, type: 'f32' },
    uAmbient: { value: new Float32Array(3), type: 'vec3<f32>' },
    uKeyDirection: { value: new Float32Array([0.7, -0.7]), type: 'vec2<f32>' },
    uKeyColor: { value: new Float32Array([1, 0.95, 0.85]), type: 'vec3<f32>' },
    uKeyIntensity: { value: 1, type: 'f32' },
  });

  const shader = Shader.from({
    gl: { vertex, fragment },
    resources: {
      lighting: uniforms,
      uDiffuse: diffuse.source,
      uDiffuseSampler: diffuse.source.style,
      uNormal: normalMap.source,
      uNormalSampler: normalMap.source.style,
      uEmissive: emissive.source,
      uEmissiveSampler: emissive.source.style,
      uGlow: glow.source,
      uGlowSampler: glow.source.style,
    },
  });

  const mesh = new Mesh({ geometry, shader });

  return {
    mesh,
    uniforms,
    setLighting(state: LightingState): void {
      uniforms.uniforms.uRotation = mesh.rotation;
      uniforms.uniforms.uTime = state.time;
      uniforms.uniforms.uAmbient = new Float32Array(state.ambient);
      uniforms.uniforms.uKeyDirection = new Float32Array(state.keyDirection);
      uniforms.uniforms.uKeyColor = new Float32Array(state.keyColor);
      uniforms.uniforms.uKeyIntensity = state.keyIntensity;
      uniforms.update();
    },
  };
}
