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
}

export interface CombatMissile {
  id: number;
  position: Vec3;
  previousPosition: Vec3;
  velocity: Vec3;
  targetId: string;
  remaining: number;
  age: number;
  color: string;
}

export interface CombatBullet {
  id: number;
  position: Vec3;
  previousPosition: Vec3;
  velocity: Vec3;
  remaining: number;
}

export interface CombatProjectileHit {
  targetId: string;
  weapon: 'missile' | 'cannon';
}

export interface CombatImpact {
  position: Vec3;
  radius: number;
  age: number;
  color: string;
}

export interface CombatAircraft {
  position: Vec3;
  velocity: Vec3;
  orientation: Quat;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const normalize = (v: Vec3): Vec3 => {
  const magnitude = length(v);
  return magnitude > 1e-6 ? [v[0] / magnitude, v[1] / magnitude, v[2] / magnitude] : [1, 0, 0];
};
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
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
  readonly bullets: CombatBullet[] = [];
  readonly impacts: CombatImpact[] = [];
  readonly projectileHits: CombatProjectileHit[] = [];
  cannonRounds = 600;
  destroyedCount = 0;
  private nextMissileId = 1;
  private nextBulletId = 1;

  reset(origin: Vec3, heading: number): void {
    this.contacts.length = 0;
    this.missiles.length = 0;
    this.bullets.length = 0;
    this.impacts.length = 0;
    this.projectileHits.length = 0;
    this.cannonRounds = 600;
    this.destroyedCount = 0;
    this.nextMissileId = 1;
    this.nextBulletId = 1;

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
      });
    };

    spawn('ECHO-01', 'VIPER T-21 FIGHTER', 'air', 1800, -320, 180, 5);
    spawn('ECHO-02', 'VIPER T-21 FIGHTER', 'air', 3900, 560, -120, 6);
    spawn('ECHO-03', 'VIPER T-21 FIGHTER', 'air', 6500, -850, 320, 7);
    spawn('SITE-01', 'GROUND SITE', 'ground', 2600, 420, 0, 3);
    spawn('SITE-02', 'GROUND SITE', 'ground', 4700, -700, 0, 3);
  }

  getContact(id: string): CombatContact | undefined {
    return this.contacts.find((contact) => contact.id === id);
  }

  updateAirContact(id: string, position: Vec3, velocity: Vec3): void {
    const contact = this.getContact(id);
    if (!contact?.alive || contact.kind !== 'air') return;
    contact.position = [...position];
    contact.velocity = [...velocity];
  }

  destroyAirContact(id: string): void {
    const contact = this.getContact(id);
    if (contact?.alive && contact.kind === 'air') this.destroy(contact, contact.position);
  }

  fireMissile(aircraft: CombatAircraft, targetId: string, color: string): boolean {
    const target = this.getContact(targetId);
    if (!target?.alive) return false;
    const forward = quatRotate(aircraft.orientation, [1, 0, 0]);
    const position = addScaled(aircraft.position, forward, 8);
    const velocity = addScaled(aircraft.velocity, forward, 520);
    this.missiles.push({
      id: this.nextMissileId++,
      position,
      previousPosition: [...position],
      velocity,
      targetId,
      remaining: 12,
      age: 0,
      color,
    });
    return true;
  }

  fireCannon(aircraft: CombatAircraft): boolean {
    if (this.cannonRounds <= 0) return false;
    this.cannonRounds -= 1;
    const forward = normalize(quatRotate(aircraft.orientation, [1, 0, 0]));
    const position = addScaled(aircraft.position, forward, 8);
    this.bullets.push({
      id: this.nextBulletId++,
      position,
      previousPosition: [...position],
      velocity: addScaled(aircraft.velocity, forward, 1000),
      remaining: 2,
    });
    return true;
  }

  update(dt: number): void {
    const step = Math.max(0, Math.min(dt, 0.05));
    if (step === 0) return;

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i];
      const target = this.getContact(missile.targetId);
      missile.remaining -= step;
      if (!target?.alive || missile.remaining <= 0) {
        this.missiles.splice(i, 1);
        continue;
      }

      const desired = normalize(subtract(target.position, missile.position));
      const speed = length(missile.velocity);
      const currentDirection = normalize(missile.velocity);
      const turnAngle = Math.acos(clamp(dot(currentDirection, desired), -1, 1));
      const maxTurn = Math.min(turnAngle, 1.8 * step);
      const axisVector: Vec3 = [
        currentDirection[1] * desired[2] - currentDirection[2] * desired[1],
        currentDirection[2] * desired[0] - currentDirection[0] * desired[2],
        currentDirection[0] * desired[1] - currentDirection[1] * desired[0],
      ];
      const turnAxis = length(axisVector) > 1e-6
        ? normalize(axisVector)
        : normalize([
            currentDirection[1],
            -currentDirection[0],
            0,
          ]);
      const direction = turnAngle < 1e-6
        ? desired
        : normalize([
            currentDirection[0] * Math.cos(maxTurn) + (turnAxis[1] * currentDirection[2] - turnAxis[2] * currentDirection[1]) * Math.sin(maxTurn),
            currentDirection[1] * Math.cos(maxTurn) + (turnAxis[2] * currentDirection[0] - turnAxis[0] * currentDirection[2]) * Math.sin(maxTurn),
            currentDirection[2] * Math.cos(maxTurn) + (turnAxis[0] * currentDirection[1] - turnAxis[1] * currentDirection[0]) * Math.sin(maxTurn),
          ]);
      missile.age += step;
      const thrust = missile.age < 2.5 ? 100 * step : 0;
      missile.previousPosition = [...missile.position];
      missile.velocity = [direction[0] * Math.min(900, speed + thrust), direction[1] * Math.min(900, speed + thrust) - 9.81 * step, direction[2] * Math.min(900, speed + thrust)];
      missile.position = addScaled(missile.position, missile.velocity, step);

      if (this.segmentHits(missile.previousPosition, missile.position, target.position, target.kind === 'air' ? 36 : 52)) {
        this.destroy(target, target.position);
        this.projectileHits.push({ targetId: target.id, weapon: 'missile' });
        this.missiles.splice(i, 1);
        continue;
      }
      if (missile.position[1] <= 0) this.missiles.splice(i, 1);
    }

    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];
      bullet.remaining -= step;
      bullet.previousPosition = [...bullet.position];
      bullet.velocity[1] -= 9.81 * step;
      bullet.position = addScaled(bullet.position, bullet.velocity, step);
      let hit: CombatContact | undefined;
      for (const contact of this.contacts) {
        if (contact.alive && contact.kind === 'air' &&
          this.segmentHits(bullet.previousPosition, bullet.position, contact.position, 12)) {
          hit = contact;
          break;
        }
      }
      if (hit) {
        hit.health -= 1;
        this.projectileHits.push({ targetId: hit.id, weapon: 'cannon' });
        if (hit.health <= 0) this.destroy(hit, hit.position);
        this.bullets.splice(i, 1);
        continue;
      }
      if (bullet.remaining <= 0 || bullet.position[1] <= 0) this.bullets.splice(i, 1);
    }

    for (const impact of this.impacts) impact.age += step;
  }

  drainProjectileHits(): CombatProjectileHit[] {
    return this.projectileHits.splice(0);
  }

  private segmentHits(start: Vec3, end: Vec3, point: Vec3, radius: number): boolean {
    const segment = subtract(end, start);
    const lengthSquared = dot(segment, segment);
    const fromStart = subtract(point, start);
    const t = lengthSquared > 1e-6 ? clamp(dot(fromStart, segment) / lengthSquared, 0, 1) : 0;
    return distanceBetween(addScaled(start, segment, t), point) <= radius;
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
