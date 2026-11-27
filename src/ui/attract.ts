import { degToRad, vecCross, vecNormalize, type Vec3 } from '../core/math';
import type { CameraState } from '../rendering/Renderer';

/**
 * Home-screen camera: a slow, drifting orbit high above the test city. Above the tallest massif
 * (1.55 km) so it can never end up inside a building. Purely a function of wall-clock time.
 */
export function attractCamera(nowMs: number, pointerX = 0, pointerY = 0): CameraState {
  const t = nowMs / 1000;
  // A continuous cinematic orbit remains active even when the pointer is still.
  const angle = t * 0.035 + pointerX * 0.16;
  const radius = 2600 + 350 * Math.sin(t * 0.05);
  const height = 1900 + 120 * Math.sin(t * 0.083) - pointerY * 95;
  const position: Vec3 = [Math.cos(angle) * radius, height, Math.sin(angle) * radius];
  const target: Vec3 = [
    Math.cos(angle + 0.6) * 600 - Math.sin(angle) * pointerX * 300,
    350 - pointerY * 140,
    Math.sin(angle + 0.6) * 600 + Math.cos(angle) * pointerX * 300,
  ];
  const forward = vecNormalize([target[0] - position[0], target[1] - position[1], target[2] - position[2]]);
  const right = vecNormalize(vecCross(forward, [0, 1, 0]));
  const up = vecCross(right, forward);
  return { position, right, up, forward, fovY: degToRad(62) };
}
