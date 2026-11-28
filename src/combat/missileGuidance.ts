import type { Vec3 } from '../core/math';

export type MissileGuidanceConfig =
  | { program: 'pure-pursuit' }
  | { program: 'lead-pursuit'; maxLeadTime?: number }
  | { program: 'proportional-navigation'; navigationConstant?: number };

export interface MissileGuidanceInput {
  position: Vec3;
  velocity: Vec3;
  targetPosition: Vec3;
  targetVelocity: Vec3;
  deltaTime: number;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (v: Vec3): Vec3 => {
  const magnitude = Math.hypot(v[0], v[1], v[2]);
  return magnitude > 1e-6 ? [v[0] / magnitude, v[1] / magnitude, v[2] / magnitude] : [1, 0, 0];
};

function leadPursuit(input: MissileGuidanceInput, maxLeadTime: number): Vec3 {
  const relativePosition = subtract(input.targetPosition, input.position);
  const distance = Math.hypot(relativePosition[0], relativePosition[1], relativePosition[2]);
  const speed = Math.hypot(input.velocity[0], input.velocity[1], input.velocity[2]);
  const leadTime = Math.min(maxLeadTime, distance / Math.max(speed, 300));
  return normalize([
    relativePosition[0] + input.targetVelocity[0] * leadTime,
    relativePosition[1] + input.targetVelocity[1] * leadTime,
    relativePosition[2] + input.targetVelocity[2] * leadTime,
  ]);
}

export function guideMissile(input: MissileGuidanceInput, config: MissileGuidanceConfig): Vec3 {
  const relativePosition = subtract(input.targetPosition, input.position);
  if (config.program === 'pure-pursuit') return normalize(relativePosition);
  if (config.program === 'lead-pursuit') {
    return leadPursuit(input, config.maxLeadTime ?? 2.5);
  }

  const rangeSquared = dot(relativePosition, relativePosition);
  if (rangeSquared <= 1e-6) return [1, 0, 0];
  const lineOfSight = normalize(relativePosition);
  const relativeVelocity = subtract(input.targetVelocity, input.velocity);
  const closingSpeed = -dot(relativeVelocity, lineOfSight);
  if (closingSpeed <= 0) return leadPursuit(input, 2.5);

  const lineOfSightRate = cross(relativePosition, relativeVelocity);
  const navigationAcceleration = cross(
    [lineOfSightRate[0] / rangeSquared, lineOfSightRate[1] / rangeSquared, lineOfSightRate[2] / rangeSquared],
    lineOfSight,
  );
  const navigationConstant = config.navigationConstant ?? 3;
  return normalize([
    input.velocity[0] + navigationAcceleration[0] * closingSpeed * navigationConstant * input.deltaTime,
    input.velocity[1] + navigationAcceleration[1] * closingSpeed * navigationConstant * input.deltaTime,
    input.velocity[2] + navigationAcceleration[2] * closingSpeed * navigationConstant * input.deltaTime,
  ]);
}
