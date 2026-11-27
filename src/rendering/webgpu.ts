import { GLOBALS_BYTES, GLOBALS_FLOATS, packGlobals } from './globals';
import type { CameraState, RenderStats, Renderer } from './Renderer';
import { buildTestScene } from './scene';
import { TERRAIN_WGSL } from '../terrain/terrainShader';
import { CARRIER } from '../world/sites';

const COMMON = /* wgsl */ `
struct Globals {
  viewProj: mat4x4<f32>,
  camPos: vec4<f32>,
  camRight: vec4<f32>,
  camUp: vec4<f32>,
  camFwd: vec4<f32>,
};
@group(0) @binding(0) var<uniform> g: Globals;

const HORIZON: vec3<f32> = vec3<f32>(0.72, 0.80, 0.88);
const ZENITH: vec3<f32> = vec3<f32>(0.16, 0.36, 0.74);

fn applyFog(c: vec3<f32>, dist: f32) -> vec3<f32> {
  let f = 1.0 - exp(-pow(dist / 55000.0, 1.6));
  return mix(c, HORIZON, clamp(f, 0.0, 1.0));
}
fn hash2(p: vec2<f32>) -> f32 {
  var q = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`;

const SKY = /* wgsl */ `
struct SkyOut { @builtin(position) pos: vec4<f32>, @location(0) ndc: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> SkyOut {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o: SkyOut;
  o.pos = vec4<f32>(p[i], 0.0, 1.0);
  o.ndc = p[i];
  return o;
}
@fragment fn fs(in: SkyOut) -> @location(0) vec4<f32> {
  let dir = normalize(g.camFwd.xyz
    + g.camRight.xyz * (in.ndc.x * g.camFwd.w * g.camRight.w)
    + g.camUp.xyz * (in.ndc.y * g.camFwd.w));
  let t = clamp(dir.y, 0.0, 1.0);
  return vec4<f32>(mix(HORIZON, ZENITH, pow(t, 0.55)), 1.0);
}
`;

const GROUND = /* wgsl */ `
struct GOut { @builtin(position) pos: vec4<f32>, @location(0) rel: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> GOut {
  var c = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0));
  let rel = vec3<f32>(c[i].x * 60000.0, -g.camPos.y, c[i].y * 60000.0);
  var o: GOut;
  o.pos = g.viewProj * vec4<f32>(rel, 1.0);
  o.rel = rel.xz;
  return o;
}
${TERRAIN_WGSL}
@fragment fn fs(in: GOut) -> @location(0) vec4<f32> {
  let w = in.rel + g.camPos.xz;
  let col = shadeGround(w, in.rel, g.camPos.y);
  let dist = length(vec3<f32>(in.rel.x, g.camPos.y, in.rel.y));
  return vec4<f32>(applyFog(col, dist), 1.0);
}
`;

const OBJECTS = /* wgsl */ `
struct VIn {
  @location(0) pos: vec3<f32>,
  @location(1) nrm: vec3<f32>,
  @location(2) inst: vec4<f32>,
};
struct VOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) nrm: vec3<f32>,
  @location(1) rel: vec3<f32>,
  @location(2) tint: f32,
  @location(3) @interpolate(flat) kind: f32,
};
@vertex fn vs(v: VIn) -> VOut {
  // A negative size marks a render-only ship part: fract(-size) * 4 is its kind, floor(-size) its footprint.
  let sz = abs(v.inst.z);
  let kind = select(0.0, floor(fract(sz) * 4.0 + 0.5), v.inst.z < 0.0);
  let size = select(sz, floor(sz), v.inst.z < 0.0);
  let world = vec3<f32>(v.inst.x + v.pos.x * size, v.pos.y * v.inst.w, v.inst.y + v.pos.z * size);
  let rel = world - g.camPos.xyz;
  var o: VOut;
  o.clip = g.viewProj * vec4<f32>(rel, 1.0);
  o.nrm = v.nrm;
  o.rel = rel;
  o.tint = hash2(v.inst.xy);
  o.kind = kind;
  return o;
}
@fragment fn fs(in: VOut) -> @location(0) vec4<f32> {
  let n = normalize(in.nrm);
  let l = vec3<f32>(0.50508, 0.80812, 0.30305);
  var base = mix(vec3<f32>(0.55, 0.56, 0.60), vec3<f32>(0.70, 0.62, 0.50), in.tint);
  if (in.kind > 0.5) {
    let wp = in.rel + g.camPos.xyz;
    if (in.kind < 1.5) {
      if (n.y > 0.5) {
        let dx = wp.x - ${CARRIER.cx.toFixed(1)};
        let dz = wp.z - ${CARRIER.cz.toFixed(1)};
        base = vec3<f32>(0.20, 0.21, 0.22);
        let edge = step(${(CARRIER.halfWid - 1.5).toFixed(1)}, abs(dx));
        let dash = step(abs(dx), 0.5) * step(fract(dz / 24.0), 0.55);
        let lane = step(abs(abs(dx) - 14.0), 0.35) * step(fract(dz / 48.0), 0.7);
        let mark = step(abs(abs(dz) - ${(CARRIER.halfLen - 22).toFixed(1)}), 1.2) * step(abs(dx), ${(CARRIER.halfWid - 3).toFixed(1)});
        base = mix(base, vec3<f32>(0.92, 0.90, 0.80), max(max(edge, dash), max(lane, mark)));
      } else {
        base = select(vec3<f32>(0.30, 0.34, 0.38), vec3<f32>(0.42, 0.10, 0.09), wp.y < 4.0);
        base = base * (0.8 + 0.2 * step(0.5, fract(wp.y / 6.0)));
      }
    } else {
      base = vec3<f32>(0.58, 0.60, 0.62);
      base = mix(base, vec3<f32>(0.12, 0.16, 0.20), step(abs(fract(wp.y / 9.0) - 0.5), 0.12) * step(abs(n.y), 0.5));
    }
  }
  let col = base * (0.35 + 0.65 * max(dot(n, l), 0.0));
  return vec4<f32>(applyFog(col, length(in.rel)), 1.0);
}
`;

const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';

export class WebGPURenderer implements Renderer {
  readonly backend = 'webgpu' as const;
  readonly stats: RenderStats = { drawCalls: 0, instances: 0 };
  /** Set when the GPU device is lost; the host may fall back to another backend. */
  onDeviceLost: ((reason: string) => void) | null = null;

  private depth: GPUTexture | null = null;
  private readonly globals = new Float32Array(GLOBALS_FLOATS);

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly ubo: GPUBuffer,
    private readonly sky: GPURenderPipeline,
    private readonly ground: GPURenderPipeline,
    private readonly objects: GPURenderPipeline,
    private readonly bindGroups: [GPUBindGroup, GPUBindGroup, GPUBindGroup],
    private readonly vbo: GPUBuffer,
    private readonly ibo: GPUBuffer,
    private readonly instBuf: GPUBuffer,
    private readonly indexCount: number,
    private readonly instanceCount: number,
  ) {
    device.lost.then((info) => this.onDeviceLost?.(info.message));
  }

  static async create(canvas: HTMLCanvasElement): Promise<WebGPURenderer> {
    if (!('gpu' in navigator)) throw new Error('navigator.gpu is not available');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter');
    const device = await adapter.requestDevice();
    const format = navigator.gpu.getPreferredCanvasFormat();
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('Could not create a WebGPU canvas context');
    context.configure({ device, format, alphaMode: 'opaque' });

    device.pushErrorScope('validation');

    const scene = buildTestScene();
    const upload = (data: ArrayBufferView, usage: number): GPUBuffer => {
      const buf = device.createBuffer({ size: data.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buf, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
      return buf;
    };
    const vbo = upload(scene.vertices, GPUBufferUsage.VERTEX);
    const ibo = upload(scene.indices, GPUBufferUsage.INDEX);
    const instBuf = upload(scene.instances, GPUBufferUsage.VERTEX);
    const ubo = device.createBuffer({ size: GLOBALS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const module = (code: string, label: string) => device.createShaderModule({ code: COMMON + code, label });
    const depthState = (write: boolean, compare: GPUCompareFunction): GPUDepthStencilState => ({
      format: DEPTH_FORMAT,
      depthWriteEnabled: write,
      depthCompare: compare,
    });

    const simplePipeline = (code: string, label: string, depth: GPUDepthStencilState) => {
      const m = module(code, label);
      return device.createRenderPipeline({
        label,
        layout: 'auto',
        vertex: { module: m, entryPoint: 'vs' },
        fragment: { module: m, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list', cullMode: 'none' },
        depthStencil: depth,
      });
    };
    const sky = simplePipeline(SKY, 'sky', depthState(false, 'always'));
    const ground = simplePipeline(GROUND, 'ground', depthState(true, 'less'));

    const om = module(OBJECTS, 'objects');
    const objects = device.createRenderPipeline({
      label: 'objects',
      layout: 'auto',
      vertex: {
        module: om,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 24,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
            ],
          },
          {
            arrayStride: 16,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x4' }],
          },
        ],
      },
      fragment: { module: om, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthState(true, 'less'),
    });

    const bg = (p: GPURenderPipeline) =>
      device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }] });
    const bindGroups: [GPUBindGroup, GPUBindGroup, GPUBindGroup] = [bg(sky), bg(ground), bg(objects)];

    const error = await device.popErrorScope();
    if (error) throw new Error(`WebGPU validation error: ${error.message}`);

    return new WebGPURenderer(
      canvas, device, context, ubo, sky, ground, objects, bindGroups, vbo, ibo, instBuf,
      scene.indices.length, scene.instanceCount,
    );
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (this.canvas.width === w && this.canvas.height === h && this.depth) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.depth?.destroy();
    this.depth = this.device.createTexture({
      size: [w, h],
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  render(camera: CameraState): void {
    if (!this.depth) this.resize(this.canvas.width, this.canvas.height);
    packGlobals(camera, this.canvas.width / this.canvas.height, true, this.globals);
    this.device.queue.writeBuffer(this.ubo, 0, this.globals.buffer, 0, GLOBALS_BYTES);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0.72, g: 0.8, b: 0.88, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depth!.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });

    pass.setPipeline(this.sky);
    pass.setBindGroup(0, this.bindGroups[0]);
    pass.draw(3);

    // objects first: early-z then skips the expensive ground shader behind buildings
    pass.setPipeline(this.objects);
    pass.setBindGroup(0, this.bindGroups[2]);
    pass.setVertexBuffer(0, this.vbo);
    pass.setVertexBuffer(1, this.instBuf);
    pass.setIndexBuffer(this.ibo, 'uint32');
    pass.drawIndexed(this.indexCount, this.instanceCount);

    pass.setPipeline(this.ground);
    pass.setBindGroup(0, this.bindGroups[1]);
    pass.draw(6);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.stats.drawCalls = 3;
    this.stats.instances = this.instanceCount;
  }

  dispose(): void {
    this.depth?.destroy();
    this.vbo.destroy();
    this.ibo.destroy();
    this.instBuf.destroy();
    this.ubo.destroy();
    this.device.destroy();
  }
}
