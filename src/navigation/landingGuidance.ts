import { CARRIER, LANDING, RUNWAYS, SITE_MARKERS, type SiteMarker } from '../world/sites';
import type { Vec3 } from '../core/math';

const DEG = Math.PI / 180;
const GLIDE_ANGLE = 3 * DEG;
const FINAL_DISTANCE = 10_000;

export interface LandingApproach {
  site: SiteMarker;
  course: number;
  thresholdX: number;
  thresholdZ: number;
  inboundX: number;
  inboundZ: number;
  rightX: number;
  rightZ: number;
  entryX: number;
  entryZ: number;
  surfaceHeight: number;
}

export interface LandingState {
  position: Vec3;
  heading: number;
  altitude: number;
  speed: number;
  verticalSpeed: number;
}

export interface LandingGuidance {
  site: SiteMarker;
  course: number;
  distanceToThreshold: number;
  distanceAlong: number;
  lateralError: number;
  targetAltitude: number;
  glideError: number;
  headingError: number;
  speed: number;
  verticalSpeed: number;
  targetSinkRate: number;
  phase: 'INTERCEPT' | 'FINAL' | 'OVER THRESHOLD' | 'MISSED';
}

const wrapPi = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export function nearestLandingSite(position: Vec3): SiteMarker {
  return [...SITE_MARKERS].sort(
    (a, b) =>
      Math.hypot(a.x - position[0], a.z - position[2]) -
      Math.hypot(b.x - position[0], b.z - position[2]),
  )[0];
}

export function createLandingApproach(site: SiteMarker, position: Vec3, heading: number): LandingApproach {
  const runway = RUNWAYS.find((item) => item.id === site.id);
  const halfLength = runway?.halfLen ?? (site.kind === 'carrier' ? CARRIER.halfLen : 0);
  const centered = Math.abs(position[2] - site.z) < halfLength;
  const fromNorth = centered
    ? Math.abs(wrapPi(Math.PI - heading)) < Math.abs(wrapPi(heading))
    : position[2] < site.z;
  const course = fromNorth ? Math.PI : 0;
  const inboundX = Math.sin(course);
  const inboundZ = -Math.cos(course);
  const thresholdX = site.x;
  const thresholdZ = site.z + (fromNorth ? -halfLength : halfLength);
  const surfaceHeight = site.kind === 'carrier' ? CARRIER.deckY : 0;

  return {
    site,
    course,
    thresholdX,
    thresholdZ,
    inboundX,
    inboundZ,
    rightX: Math.cos(course),
    rightZ: Math.sin(course),
    entryX: thresholdX - inboundX * FINAL_DISTANCE,
    entryZ: thresholdZ - inboundZ * FINAL_DISTANCE,
    surfaceHeight,
  };
}

export function calculateLandingGuidance(approach: LandingApproach, state: LandingState): LandingGuidance {
  const dx = state.position[0] - approach.thresholdX;
  const dz = state.position[2] - approach.thresholdZ;
  const distanceAlong = -(dx * approach.inboundX + dz * approach.inboundZ);
  const lateralError = dx * approach.rightX + dz * approach.rightZ;
  const targetAltitude = approach.surfaceHeight + Math.max(0, distanceAlong) * Math.tan(GLIDE_ANGLE);
  const distanceToThreshold = Math.hypot(dx, dz);
  const phase: LandingGuidance['phase'] = distanceAlong > FINAL_DISTANCE
    ? 'INTERCEPT'
    : distanceAlong > 0
      ? 'FINAL'
      : distanceAlong > -1500
        ? 'OVER THRESHOLD'
        : 'MISSED';

  return {
    site: approach.site,
    course: approach.course,
    distanceToThreshold,
    distanceAlong,
    lateralError,
    targetAltitude,
    glideError: state.altitude - targetAltitude,
    headingError: wrapPi(approach.course - state.heading),
    speed: state.speed,
    verticalSpeed: state.verticalSpeed,
    targetSinkRate: -state.speed * Math.sin(GLIDE_ANGLE),
    phase,
  };
}

export function landingAdvice(guidance: LandingGuidance): string {
  if (guidance.phase === 'MISSED') return 'MISSED APPROACH · CLIMB AND RE-ENTER';
  if (guidance.speed > LANDING.maxSpeed) return `SLOW DOWN · LIMIT ${Math.round(LANDING.maxSpeed * 1.943844)} KT`;
  if (Math.abs(guidance.lateralError) > 60) return guidance.lateralError > 0 ? 'CORRECT LEFT TO CENTERLINE' : 'CORRECT RIGHT TO CENTERLINE';
  if (Math.abs(guidance.glideError) > 35) return guidance.glideError > 0 ? 'ABOVE GLIDE PATH' : 'BELOW GLIDE PATH · CLIMB';
  if (Math.abs(guidance.headingError) > 8 * DEG) return `TURN ${guidance.headingError > 0 ? 'RIGHT' : 'LEFT'} TO ${String(Math.round(guidance.course / DEG) % 360).padStart(3, '0')}°`;
  if (guidance.distanceAlong <= 0) return 'THRESHOLD · FLARE GENTLY';
  return 'ON APPROACH · HOLD CENTERLINE';
}
