import { GLOBALS_BYTES, GLOBALS_FLOATS, packGlobals } from './globals';
import type { CameraState, RenderStats, Renderer } from './Renderer';
import { buildTestScene } from './scene';
import { TERRAIN_GLSL } from '../terrain/terrainShader';
import { CARRIER } from '../world/sites';

const HEAD = /* glsl */ `#version 300 es
precision highp float;
layout(std140) uniform Globals {
  mat4 uViewProj;
  vec4 uCamPos;
  vec4 uRight;
  vec4 uUp;
  vec4 uFwd;
};
`;

const COMMON_FS = /* glsl */ `
const vec3 HORIZON = vec3(0.72, 0.80, 0.88);
const vec3 ZENITH = vec3(0.16, 0.36, 0.74);
vec3 applyFog(vec3 c, float dist) {
  float f = 1.0 - exp(-pow(dist / 30000.0, 1.6));
  return mix(c, HORIZON, clamp(f, 0.0, 1.0));
}
float hash2(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`;

const SKY_VS = HEAD + /* glsl */ `
out vec2 vNdc;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vNdc = p;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
const SKY_FS = HEAD + COMMON_FS + /* glsl */ `
in vec2 vNdc;
out vec4 outColor;
void main() {
  vec3 dir = normalize(uFwd.xyz + uRight.xyz * (vNdc.x * uFwd.w * uRight.w) + uUp.xyz * (vNdc.y * uFwd.w));
  float t = clamp(dir.y, 0.0, 1.0);
  outColor = vec4(mix(HORIZON, ZENITH, pow(t, 0.55)), 1.0);
}`;

const GROUND_VS = HEAD + /* glsl */ `
const vec2 C[6] = vec2[6](vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));
out vec2 vRel;
void main() {
  vec3 rel = vec3(C[gl_VertexID].x * 60000.0, -uCamPos.y, C[gl_VertexID].y * 60000.0);
  vRel = rel.xz;
  gl_Position = uViewProj * vec4(rel, 1.0);
}`;
const GROUND_FS = HEAD + COMMON_FS + TERRAIN_GLSL + /* glsl */ `
in vec2 vRel;
out vec4 outColor;
void main() {
  vec2 w = vRel + uCamPos.xz;
  vec3 col = shadeGround(w, vRel, uCamPos.y);
  float dist = length(vec3(vRel.x, uCamPos.y, vRel.y));
  outColor = vec4(applyFog(col, dist), 1.0);
}`;

const OBJ_VS = HEAD + COMMON_FS + /* glsl */ `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec4 aInst;
out vec3 vNrm;
out vec3 vRel;
out float vTint;
flat out float vKind;
void main() {
  // A negative size marks a render-only ship part: fract(-size) * 4 is its kind, floor(-size) its footprint.
  float sz = abs(aInst.z);
  float kind = aInst.z < 0.0 ? floor(fract(sz) * 4.0 + 0.5) : 0.0;
  float size = aInst.z < 0.0 ? floor(sz) : sz;
  vKind = kind;
  vec3 world = vec3(aInst.x + aPos.x * size, aPos.y * aInst.w, aInst.y + aPos.z * size);
  vec3 rel = world - uCamPos.xyz;
  vNrm = aNrm;
  vRel = rel;
  vTint = hash2(aInst.xy);
  gl_Position = uViewProj * vec4(rel, 1.0);
}`;
const OBJ_FS = HEAD + COMMON_FS + /* glsl */ `
in vec3 vNrm;
in vec3 vRel;
in float vTint;
flat in float vKind;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNrm);
  vec3 l = vec3(0.50508, 0.80812, 0.30305);
  vec3 base = mix(vec3(0.55, 0.56, 0.60), vec3(0.70, 0.62, 0.50), vTint);
  if (vKind > 0.5) {
    vec3 wp = vRel + uCamPos.xyz;
    if (vKind < 1.5) {
      if (n.y > 0.5) {
        float dx = wp.x - ${CARRIER.cx.toFixed(1)};
        float dz = wp.z - ${CARRIER.cz.toFixed(1)};
        base = vec3(0.20, 0.21, 0.22);
        float edge = step(${(CARRIER.halfWid - 1.5).toFixed(1)}, abs(dx));
        float dash = step(abs(dx), 0.5) * step(fract(dz / 24.0), 0.55);
        float lane = step(abs(abs(dx) - 14.0), 0.35) * step(fract(dz / 48.0), 0.7);
        float mark = step(abs(abs(dz) - ${(CARRIER.halfLen - 22).toFixed(1)}), 1.2) * step(abs(dx), ${(CARRIER.halfWid - 3).toFixed(1)});
        base = mix(base, vec3(0.92, 0.90, 0.80), max(max(edge, dash), max(lane, mark)));
      } else {
        base = wp.y < 4.0 ? vec3(0.42, 0.10, 0.09) : vec3(0.30, 0.34, 0.38);
        base *= 0.8 + 0.2 * step(0.5, fract(wp.y / 6.0));
      }
    } else {
      base = vec3(0.58, 0.60, 0.62);
      base = mix(base, vec3(0.12, 0.16, 0.20), step(abs(fract(wp.y / 9.0) - 0.5), 0.12) * step(abs(n.y), 0.5));
    }
  }
  vec3 col = base * (0.35 + 0.65 * max(dot(n, l), 0.0));
  outColor = vec4(applyFog(col, length(vRel)), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('createShader failed');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`GLSL compile error: ${log}`);
  }
  return s;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram failed');
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`GLSL link error: ${gl.getProgramInfoLog(p)}`);
  const block = gl.getUniformBlockIndex(p, 'Globals');
  if (block !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, block, 0);
  return p;
}

export class WebGL2Renderer implements Renderer {
  readonly backend = 'webgl2' as const;
  readonly stats: RenderStats = { drawCalls: 0, instances: 0 };

  private readonly globals = new Float32Array(GLOBALS_FLOATS);
  private readonly ubo: WebGLBuffer;
  private readonly emptyVao: WebGLVertexArrayObject;
  private readonly objectVao: WebGLVertexArrayObject;
  private readonly buffers: WebGLBuffer[] = [];
  private readonly progs: { sky: WebGLProgram; ground: WebGLProgram; objects: WebGLProgram };
  private readonly indexCount: number;
  private readonly instanceCount: number;
  private contextLost = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
  ) {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });

    this.progs = {
      sky: program(gl, SKY_VS, SKY_FS),
      ground: program(gl, GROUND_VS, GROUND_FS),
      objects: program(gl, OBJ_VS, OBJ_FS),
    };

    const mk = (): WebGLBuffer => {
      const b = gl.createBuffer();
      if (!b) throw new Error('createBuffer failed');
      this.buffers.push(b);
      return b;
    };

    this.ubo = mk();
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, GLOBALS_BYTES, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);

    const scene = buildTestScene();
    this.indexCount = scene.indices.length;
    this.instanceCount = scene.instanceCount;

    const vao = gl.createVertexArray();
    const empty = gl.createVertexArray();
    if (!vao || !empty) throw new Error('createVertexArray failed');
    this.objectVao = vao;
    this.emptyVao = empty;

    gl.bindVertexArray(vao);
    const vbo = mk();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, scene.vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    const inst = mk();
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    gl.bufferData(gl.ARRAY_BUFFER, scene.instances, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(2, 1);

    const ibo = mk();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, scene.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  static create(canvas: HTMLCanvasElement): Promise<WebGL2Renderer> {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, powerPreference: 'default' });
    if (!gl) return Promise.reject(new Error('WebGL 2 is not available'));
    try {
      return Promise.resolve(new WebGL2Renderer(canvas, gl));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  resize(width: number, height: number): void {
    this.canvas.width = Math.max(1, Math.floor(width));
    this.canvas.height = Math.max(1, Math.floor(height));
  }

  render(camera: CameraState): void {
    if (this.contextLost) return;
    const gl = this.gl;
    packGlobals(camera, this.canvas.width / this.canvas.height, false, this.globals);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.globals);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.72, 0.8, 0.88, 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.bindVertexArray(this.emptyVao);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(this.progs.sky);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Opaque geometry front-to-back by cost: the cheap objects first so the expensive ground
    // fragment shader is skipped (early-z) wherever a building already covers the pixel.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.bindVertexArray(this.objectVao);
    gl.useProgram(this.progs.objects);
    gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0, this.instanceCount);

    gl.bindVertexArray(this.emptyVao);
    gl.useProgram(this.progs.ground);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);

    this.stats.drawCalls = 3;
    this.stats.instances = this.instanceCount;
  }

  dispose(): void {
    const gl = this.gl;
    this.buffers.forEach((b) => gl.deleteBuffer(b));
    gl.deleteVertexArray(this.objectVao);
    gl.deleteVertexArray(this.emptyVao);
    Object.values(this.progs).forEach((p) => gl.deleteProgram(p));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
