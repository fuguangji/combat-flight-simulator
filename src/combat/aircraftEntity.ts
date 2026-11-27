import { attitudeFromQuat } from '../cockpit/camera';
import { clamp, quatMultiply, type Quat, type Vec3 } from '../core/math';
import type { AircraftDefinition } from '../aircraft/registry';
import { PhysicsClient, type ControlInput } from '../physics/PhysicsClient';
import type { AircraftSnapshot } from '../physics/stateLayout';

const wrapPi = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export class CombatAircraftEntity {
  private readonly physics = new PhysicsClient();
  private readonly center: Vec3;
  private paused = false;

  constructor(
    readonly id: string,
    position: Vec3,
    private readonly heading: number,
    private readonly orbitRate: number,
    private readonly altitude: number,
    private readonly cruiseSpeed: number,
  ) {
    this.center = [...position];
  }

  async start(wasmUrl: string, aircraft: AircraftDefinition): Promise<void> {
    const yaw = this.heading + Math.PI / 2;
    const yawRotation: Quat = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    const pitchRotation: Quat = [0, 0, Math.sin(aircraft.startAlpha / 2), Math.cos(aircraft.startAlpha / 2)];
    const orientation = quatMultiply(yawRotation, pitchRotation);
    const velocity: Vec3 = [
      Math.sin(this.heading) * this.cruiseSpeed,
      0,
      -Math.cos(this.heading) * this.cruiseSpeed,
    ];
    await this.physics.start(wasmUrl, aircraft.toPhysicsArray(), {
      initialState: { position: [...this.center], velocity, orientation },
    });
  }

  update(nowMs: number): AircraftSnapshot | null {
    if (this.paused) return null;
    const snapshot = this.physics.sample(nowMs);
    if (!snapshot) return null;
    const attitude = attitudeFromQuat(snapshot.orientation);
    const pathAngle = this.heading + snapshot.time * this.orbitRate;
    const waypoint: Vec3 = [
      this.center[0] + Math.sin(pathAngle) * 2800,
      this.altitude,
      this.center[2] - Math.cos(pathAngle) * 2800,
    ];
    const desiredHeading = Math.atan2(waypoint[0] - snapshot.position[0], -(waypoint[2] - snapshot.position[2]));
    const headingError = wrapPi(desiredHeading - attitude.heading);
    const desiredBank = clamp(headingError * 1.6, -0.55, 0.55);
    const verticalSpeed = snapshot.velocity[1];
    const desiredPitch = clamp((this.altitude - snapshot.altitude) * 0.0005 - verticalSpeed * 0.055, -0.22, 0.22);
    const controls: ControlInput = {
      throttle: clamp(0.35 + (this.cruiseSpeed - snapshot.airspeed) * 0.003, 0.2, 0.85),
      pitch: clamp((desiredPitch - attitude.pitch) * 2.2, -0.65, 0.65),
      roll: clamp((desiredBank - attitude.roll) * 2.1 - snapshot.angularVelocity[0] * 0.14, -1, 1),
      yaw: clamp(-snapshot.beta * 2.5 - snapshot.angularVelocity[1] * 0.08, -0.35, 0.35),
    };
    this.physics.setControls(controls);
    return snapshot;
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.physics.pause();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.physics.resume();
  }

  dispose(): void {
    this.physics.dispose();
  }
}
