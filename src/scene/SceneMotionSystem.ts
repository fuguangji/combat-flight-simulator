import * as THREE from 'three';

export interface SceneMotionConfig {
  position: THREE.Vector3;
  velocity?: THREE.Vector3;
  acceleration?: THREE.Vector3;
  radius?: number;
  color?: THREE.ColorRepresentation;
  lifetimeSeconds?: number;
  trailLength?: number;
}

export interface SceneMotionHandle {
  readonly id: number;
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
}

/**
 * General-purpose scene-object motion for visual simulations and experiments.
 *
 * This module is deliberately independent of aircraft equipment, targets,
 * aiming, collision, impact, damage, and guidance systems.
 */
export class SceneMotionSystem {
  private readonly scene: THREE.Scene;
  private readonly fixedStep: number;
  private readonly maxSubSteps: number;
  private readonly entries = new Map<number, {
    mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
    velocity: THREE.Vector3;
    acceleration: THREE.Vector3;
    age: number;
    lifetime: number;
    trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | null;
    trailPositions: THREE.Vector3[];
    trailLength: number;
  }>();
  private accumulator = 0;
  private nextId = 1;

  constructor(scene: THREE.Scene, options: { fixedStepSeconds?: number; maxSubSteps?: number } = {}) {
    this.scene = scene;
    this.fixedStep = Math.max(1 / 240, options.fixedStepSeconds ?? 1 / 120);
    this.maxSubSteps = Math.max(1, Math.floor(options.maxSubSteps ?? 8));
  }

  addSphere(config: SceneMotionConfig): SceneMotionHandle {
    const id = this.nextId++;
    const radius = Math.max(0.001, config.radius ?? 0.12);
    const geometry = new THREE.SphereGeometry(radius, 16, 12);
    const material = new THREE.MeshStandardMaterial({
      color: config.color ?? 0x8de8c0,
      roughness: 0.38,
      metalness: 0.12,
      emissive: config.color ?? 0x8de8c0,
      emissiveIntensity: 0.12,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(config.position);
    mesh.name = `scene-motion-${id}`;
    this.scene.add(mesh);

    const trailLength = Math.max(0, Math.floor(config.trailLength ?? 48));
    let trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
    if (trailLength > 1) {
      const trailGeometry = new THREE.BufferGeometry();
      const positions = new Float32Array(trailLength * 3);
      trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const trailMaterial = new THREE.LineBasicMaterial({
        color: config.color ?? 0x8de8c0,
        transparent: true,
        opacity: 0.62,
      });
      trail = new THREE.Line(trailGeometry, trailMaterial);
      trail.frustumCulled = false;
      this.scene.add(trail);
    }

    this.entries.set(id, {
      mesh,
      velocity: config.velocity?.clone() ?? new THREE.Vector3(),
      acceleration: config.acceleration?.clone() ?? new THREE.Vector3(),
      age: 0,
      lifetime: Math.max(0, config.lifetimeSeconds ?? Number.POSITIVE_INFINITY),
      trail,
      trailPositions: [mesh.position.clone()],
      trailLength,
    });
    return { id, mesh };
  }

  /** Advance using a fixed simulation step; call once per rendered frame. */
  update(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
    this.accumulator += Math.min(deltaSeconds, 0.1);
    let steps = 0;
    while (this.accumulator >= this.fixedStep && steps < this.maxSubSteps) {
      this.step(this.fixedStep);
      this.accumulator -= this.fixedStep;
      steps++;
    }
    // Avoid a spiral of death after a long tab suspension.
    if (steps === this.maxSubSteps && this.accumulator >= this.fixedStep) {
      this.accumulator = 0;
    }
  }

  getPosition(id: number, target = new THREE.Vector3()): THREE.Vector3 | null {
    const entry = this.entries.get(id);
    return entry ? target.copy(entry.mesh.position) : null;
  }

  getVelocity(id: number, target = new THREE.Vector3()): THREE.Vector3 | null {
    const entry = this.entries.get(id);
    return entry ? target.copy(entry.velocity) : null;
  }

  remove(id: number): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.disposeEntry(entry);
    this.entries.delete(id);
  }

  clear(): void {
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    this.entries.clear();
    this.accumulator = 0;
  }

  dispose(): void {
    this.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private step(dt: number): void {
    for (const [id, entry] of this.entries) {
      entry.velocity.addScaledVector(entry.acceleration, dt);
      entry.mesh.position.addScaledVector(entry.velocity, dt);
      entry.age += dt;

      if (entry.trail) {
        entry.trailPositions.push(entry.mesh.position.clone());
        if (entry.trailPositions.length > entry.trailLength) entry.trailPositions.shift();
        const attribute = entry.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
        const array = attribute.array as Float32Array;
        array.fill(0);
        entry.trailPositions.forEach((point, index) => {
          array[index * 3] = point.x;
          array[index * 3 + 1] = point.y;
          array[index * 3 + 2] = point.z;
        });
        attribute.needsUpdate = true;
        entry.trail.geometry.setDrawRange(0, entry.trailPositions.length);
        entry.trail.geometry.computeBoundingSphere();
      }

      if (entry.age >= entry.lifetime) this.remove(id);
    }
  }

  private disposeEntry(entry: {
    mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
    trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | null;
  }): void {
    this.scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    entry.mesh.material.dispose();
    if (entry.trail) {
      this.scene.remove(entry.trail);
      entry.trail.geometry.dispose();
      entry.trail.material.dispose();
    }
  }
}
