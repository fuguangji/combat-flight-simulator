import { multiply, perspective, viewRotation } from './mat4';
import { FAR_PLANE, NEAR_PLANE, type CameraState } from './Renderer';

/** Size of the per-frame uniform block shared by every shader (both backends). */
export const GLOBALS_FLOATS = 32;
export const GLOBALS_BYTES = GLOBALS_FLOATS * 4;

/**
 * std140-compatible layout:
 *   [0..15]  viewProj (rotation-only view * projection; geometry is camera-relative)
 *   [16..19] camPos.xyz
 *   [20..23] right.xyz, w = aspect
 *   [24..27] up.xyz
 *   [28..31] forward.xyz, w = tan(fovY / 2)
 */
export function packGlobals(cam: CameraState, aspect: number, zeroToOne: boolean, out: Float32Array): void {
  const proj = perspective(cam.fovY, aspect, NEAR_PLANE, FAR_PLANE, zeroToOne);
  const view = viewRotation(cam.right, cam.up, cam.forward);
  out.set(multiply(proj, view), 0);
  out.set(cam.position, 16);
  out.set(cam.right, 20);
  out[23] = aspect;
  out.set(cam.up, 24);
  out.set(cam.forward, 28);
  out[31] = Math.tan(cam.fovY / 2);
}
