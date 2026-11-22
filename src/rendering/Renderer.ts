import type { Vec3 } from '../core/math';

export type Backend = 'webgpu' | 'webgl2';

/** Camera in world space. Basis vectors are unit length and mutually orthogonal. */
export interface CameraState {
  position: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  fovY: number; // radians
}

export interface RenderStats {
  drawCalls: number;
  instances: number;
}

export interface Renderer {
  readonly backend: Backend;
  readonly stats: RenderStats;
  /** Set the drawing-buffer size in physical pixels (CSS size is handled by the page). */
  resize(width: number, height: number): void;
  render(camera: CameraState): void;
  dispose(): void;
}

export const NEAR_PLANE = 1;
export const FAR_PLANE = 100_000;
