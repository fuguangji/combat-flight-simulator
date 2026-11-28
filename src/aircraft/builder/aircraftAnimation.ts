import * as THREE from 'three';
import type { AircraftVisualComponent } from './modularAircraft';

export type AircraftAnimationChannel = 'pitch' | 'roll' | 'yaw' | 'gear' | 'flaps' | 'canopy';
export type AircraftAnimationAxis = 'x' | 'y' | 'z';

export interface AircraftAnimationInput {
  pitch?: number;
  roll?: number;
  yaw?: number;
  gear?: number;
  flaps?: number;
  canopy?: number;
}

/**
 * Visual-only component animation. It changes model transforms, never flight physics,
 * collision geometry, targeting, or equipment behaviour.
 */
export class AircraftModelController {
  private readonly nodes = new Map<string, THREE.Object3D>();
  private readonly bindings: Array<{
    node: THREE.Object3D;
    axis: AircraftAnimationAxis;
    channel: AircraftAnimationChannel;
    min: number;
    max: number;
    base: number;
    current: number;
  }> = [];
  private target: Required<AircraftAnimationInput> = {
    pitch: 0, roll: 0, yaw: 0, gear: 0, flaps: 0, canopy: 0,
  };

  constructor(root: THREE.Object3D, components: AircraftVisualComponent[]) {
    root.traverse((node) => {
      const id = node.userData.componentId;
      if (typeof id === 'string') this.nodes.set(id, node);
    });
    for (const component of components) {
      const animation = component.animation;
      const node = this.nodes.get(component.id);
      if (!animation || !node) continue;
      const axis = animation.axis ?? 'x';
      const isAxisControl = animation.channel === 'pitch' || animation.channel === 'roll' || animation.channel === 'yaw';
      const min = animation.min ?? (isAxisControl ? -Math.PI / 4 : 0);
      const max = animation.max ?? Math.PI / 4;
      const base = node.rotation[axis];
      this.bindings.push({ node, axis, channel: animation.channel, min, max, base, current: base });
      // The cockpit stick is a two-axis visual control: pitch and roll both move it.
      if (component.id.toLowerCase().includes('control-stick') && animation.channel === 'pitch') {
        const crossAxis: AircraftAnimationAxis = axis === 'x' ? 'z' : 'x';
        const crossBase = node.rotation[crossAxis];
        this.bindings.push({
          node, axis: crossAxis, channel: 'roll',
          min: -0.13, max: 0.13, base: crossBase, current: crossBase,
        });
      }
    }
  }

  getComponent(id: string): THREE.Object3D | undefined {
    return this.nodes.get(id);
  }

  setControls(input: AircraftAnimationInput): void {
    for (const channel of Object.keys(this.target) as AircraftAnimationChannel[]) {
      const value = input[channel];
      if (typeof value === 'number' && Number.isFinite(value)) {
        this.target[channel] = THREE.MathUtils.clamp(value, channel === 'pitch' || channel === 'roll' || channel === 'yaw' ? -1 : 0, 1);
      }
    }
  }

  /** Call once per rendered frame; smoothing keeps the visual response independent of frame rate. */
  update(deltaSeconds: number): void {
    const alpha = 1 - Math.exp(-Math.max(0, Math.min(deltaSeconds, 0.1)) * 12);
    for (const binding of this.bindings) {
      const t = binding.channel === 'pitch' || binding.channel === 'roll' || binding.channel === 'yaw'
        ? (this.target[binding.channel] + 1) * 0.5
        : this.target[binding.channel];
      const destination = binding.base + THREE.MathUtils.lerp(binding.min, binding.max, t);
      binding.current = THREE.MathUtils.lerp(binding.current, destination, alpha);
      binding.node.rotation[binding.axis] = binding.current;
    }
  }

  reset(): void {
    this.target = { pitch: 0, roll: 0, yaw: 0, gear: 0, flaps: 0, canopy: 0 };
    for (const binding of this.bindings) {
      binding.current = binding.base;
      binding.node.rotation[binding.axis] = binding.base;
    }
  }
}
