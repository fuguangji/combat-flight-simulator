/** Column-major 4x4 matrices (Float32Array), compatible with WGSL mat4x4 and GLSL mat4. */

/** Right-handed perspective. zeroToOne=true for WebGPU clip space, false for WebGL. */
export function perspective(fovY: number, aspect: number, near: number, far: number, zeroToOne: boolean): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[11] = -1;
  if (zeroToOne) {
    m[10] = far / (near - far);
    m[14] = (far * near) / (near - far);
  } else {
    m[10] = (far + near) / (near - far);
    m[14] = (2 * far * near) / (near - far);
  }
  return m;
}

/** Rotation-only view matrix (camera sits at the origin; geometry is made camera-relative). */
export function viewRotation(
  right: readonly number[],
  up: readonly number[],
  forward: readonly number[],
): Float32Array {
  const m = new Float32Array(16);
  m[0] = right[0]; m[4] = right[1]; m[8] = right[2];
  m[1] = up[0]; m[5] = up[1]; m[9] = up[2];
  m[2] = -forward[0]; m[6] = -forward[1]; m[10] = -forward[2];
  m[15] = 1;
  return m;
}

/** out = a * b */
export function multiply(a: Float32Array, b: Float32Array, out = new Float32Array(16)): Float32Array {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}
