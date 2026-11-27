import { quatRotate, type Quat, type Vec3 } from '../core/math';

export type CombatTargetKind = 'air' | 'ground';

export interface CombatContact {
  id: string;
  className: string;
  kind: CombatTargetKind;
  position: Vec3;
  velocity: Vec3;
  health: number;
  alive: boolean;
  phase: number;
}

export interface CombatMissile {
  id: number;
  position: Vec3;
  velocity: Vec3;
  targetId: string;
  remaining: number;
  color: string;
}

export interface CombatImpact {
  position: Vec3;
  radius: number;
  age: number;
  color: string;
}

export interface CombatAircraft {
  position: Vec3;
  orientation: Quat;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const normalize = (v: Vec3): Vec3 => {
  const magnitude = length(v);
  return magnitude > 1e-6 ? [v[0] / magnitude, v[1] / magnitude, v[2] / magnitude] : [1, 0, 0];
};
const addScaled = (a: Vec3, b: Vec3, scale: number): Vec3 => [
  a[0] + b[0] * scale,
  a[1] + b[1] * scale,
  a[2] + b[2] * scale,
];

export function distanceBetween(a: Vec3, b: Vec3): number {
  return length(subtract(a, b));
}

export class CombatSimulation {
  readonly contacts: CombatContact[] = [];
  readonly missiles: CombatMissile[] = [];
  readonly impacts: CombatImpact[] = [];
  cannonRounds = 600;
  destroyedCount = 0;
  private nextMissileId = 1;

  reset(origin: Vec3, heading: number): void {
    this.contacts.length = 0;
    this.missiles.length = 0;
    this.impacts.length = 0;
    this.cannonRounds = 600;
    this.destroyedCount = 0;
    this.nextMissileId = 1;

    const forward: Vec3 = [Math.sin(heading), 0, -Math.cos(heading)];
    const right: Vec3 = [Math.cos(heading), 0, Math.sin(heading)];
    const spawn = (id: string, className: string, kind: CombatTargetKind, ahead: number, across: number, height: number, health: number): void => {
      const position = addScaled(addScaled(origin, forward, ahead), right, across);
      position[1] = kind === 'ground' ? 0 : Math.max(100, origin[1] + height);
      this.contacts.push({
        id,
        className,
        kind,
        position,
        velocity: kind === 'air' ? [0, 0, 0] : [0, 0, 0],
        health,
        alive: true,
        phase: this.contacts.length * 1.7,
      });
    };

    spawn('ECHO-01', 'TRAINER', 'air', 1800, -320, 180, 5);
    spawn('ECHO-02', 'DRONE', 'air', 3900, 560, -120, 6);
    spawn('ECHO-03', 'DRONE', 'air', 6500, -850, 320, 7);
    spawn('SITE-01', 'GROUND SITE', 'ground', 2600, 420, 0, 3);
    spawn('SITE-02', 'GROUND SITE', 'ground', 4700, -700, 0, 3);
  }

  getContact(id: string): CombatContact | undefined {
    return this.contacts.find((contact) => contact.id === id);
  }

  fireMissile(aircraft: CombatAircraft, targetId: string, color: string): boolean {
    const target = this.getContact(targetId);
    if (!target?.alive) return false;
    const forward = quatRotate(aircraft.orientation, [1, 0, 0]);
    const position = addScaled(aircraft.position, forward, 8);
    const direction = normalize(subtract(target.position, position));
    this.missiles.push({
      id: this.nextMissileId++,
      position,
      velocity: [direction[0] * 720, direction[1] * 720, direction[2] * 720],
      targetId,
      remaining: 14,
      color,
    });
    return true;
  }

  fireCannon(aircraft: CombatAircraft): { fired: boolean; hitId: string | null } {
    if (this.cannonRounds <= 0) return { fired: false, hitId: null };
    this.cannonRounds -= 1;
    const forward = normalize(quatRotate(aircraft.orientation, [1, 0, 0]));
    let nearest: CombatContact | null = null;
    let nearestAlong = Infinity;
    for (const contact of this.contacts) {
      if (!contact.alive || contact.kind !== 'air') continue;
      const relative = subtract(contact.position, aircraft.position);
      const along = dot(relative, forward);
      if (along <= 0 || along > 1800 || along >= nearestAlong) continue;
      const missDistance = length(subtract(relative, [forward[0] * along, forward[1] * along, forward[2] * along]));
      if (missDistance <= Math.max(24, along * 0.012)) {
        nearest = contact;
        nearestAlong = along;
      }
    }

    if (nearest) {
      nearest.health -= 1;
      if (nearest.health <= 0) this.destroy(nearest, nearest.position);
      return { fired: true, hitId: nearest.id };
    }

    return { fired: true, hitId: null };
  }

  update(dt: number): void {
    const step = Math.max(0, Math.min(dt, 0.05));
    if (step === 0) return;

    for (const contact of this.contacts) {
      if (!contact.alive || contact.kind !== 'air') continue;
      contact.phase += step * (0.35 + contact.phase * 0.015);
      contact.position[0] += Math.sin(contact.phase) * 18 * step;
      contact.position[1] += Math.cos(contact.phase * 0.7) * 8 * step;
      contact.position[2] += Math.cos(contact.phase * 0.8) * 18 * step;
    }

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i];
      const target = this.getContact(missile.targetId);
      missile.remaining -= step;
      if (!target?.alive || missile.remaining <= 0) {
        this.missiles.splice(i, 1);
        continue;
      }

      const desired = normalize(subtract(target.position, missile.position));
      const speed = 720;
      const turn = Math.min(1, step * 2.8);
      const direction = normalize([
        missile.velocity[0] / speed + (desired[0] - missile.velocity[0] / speed) * turn,
        missile.velocity[1] / speed + (desired[1] - missile.velocity[1] / speed) * turn,
        missile.velocity[2] / speed + (desired[2] - missile.velocity[2] / speed) * turn,
      ]);
      const previous = missile.position;
      missile.velocity = [direction[0] * speed, direction[1] * speed, direction[2] * speed];
      missile.position = addScaled(missile.position, direction, speed * step);

      const segment = subtract(missile.position, previous);
      const segmentLengthSquared = dot(segment, segment);
      const fromStart = subtract(target.position, previous);
      const t = segmentLengthSquared > 1e-6 ? Math.max(0, Math.min(1, dot(fromStart, segment) / segmentLengthSquared)) : 0;
      const closest = addScaled(previous, segment, t);
      if (distanceBetween(closest, target.position) <= (target.kind === 'air' ? 75 : 90)) {
        this.destroy(target, target.position);
        this.missiles.splice(i, 1);
      }
    }

    for (const impact of this.impacts) impact.age += step;
  }

  private destroy(contact: CombatContact, position: Vec3): void {
    if (!contact.alive) return;
    contact.alive = false;
    this.destroyedCount += 1;
    this.impacts.push({
      position: [...position],
      radius: contact.kind === 'ground' ? 58 : 26,
      age: 0,
      color: contact.kind === 'ground' ? '#ff9b56' : '#ffc56b',
    });
  }
}
