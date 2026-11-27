import * as THREE from 'three';
import type { AircraftDefinition } from '../aircraft/registry';
import { loadAircraftVisual } from '../aircraft/builder/visualRepository';
import { AircraftModelController } from '../aircraft/builder/aircraftAnimation';

/**
 * Renders the editor-authored aircraft hierarchy around the pilot's actual eye point.
 * The game world remains on the primary renderer; this transparent Three.js pass draws
 * the nearby airframe/cockpit geometry in the same body coordinate system.
 *
 * Body axes: +X forward, +Y up, +Z right.
 * Three.js camera axes: -Z forward, +Y up, +X right.
 */
export class AircraftView {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.01, 500);
  private model: THREE.Group | null = null;
  private controller: AircraftModelController | null = null;
  private disposed = false;

  constructor(private readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'aircraft-view-canvas';
    Object.assign(this.canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      zIndex: '1',
      pointerEvents: 'none',
    });
    host.append(this.canvas);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      depth: true,
      powerPreference: 'low-power',
      premultipliedAlpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.add(new THREE.HemisphereLight(0xdcefe5, 0x18201d, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(5, 8, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8bcdb2, 0.75);
    fill.position.set(-5, 2, -6);
    this.scene.add(fill);
    this.camera.position.set(0, 0, 0);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(host);
  }

  setAircraft(definition: AircraftDefinition): void {
    this.disposeModel();
    const loaded = loadAircraftVisual(definition.key, definition.id);
    this.model = loaded.model;
    this.model.name = `${definition.key}:runtime-airframe`;
    // Convert body-frame (forward, up, right) into Three.js (right, up, backward).
    this.model.scale.setScalar(1); // eyeOffset and geometry now share the exact aircraft metre scale.
    this.model.rotation.set(0, Math.PI / 2, 0);
    this.model.position.set(-definition.eyeOffset[2], -definition.eyeOffset[1], definition.eyeOffset[0]);
    this.model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
      }
    });
    this.scene.add(this.model);
    this.controller = new AircraftModelController(this.model, loaded.config.components);
    this.camera.fov = definition.fovY * 180 / Math.PI;
    this.camera.updateProjectionMatrix();
  }

  setControls(input: { pitch?: number; roll?: number; yaw?: number; gear?: number; flaps?: number; canopy?: number }): void {
    this.controller?.setControls(input);
  }

  render(yaw: number, pitch: number, width: number, height: number, deltaSeconds: number): void {
    if (this.disposed || !this.model) return;
    if (this.canvas.width !== Math.max(1, Math.floor(width * this.renderer.getPixelRatio())) ||
        this.canvas.height !== Math.max(1, Math.floor(height * this.renderer.getPixelRatio()))) this.resize();
    // Free-look is deliberately unbounded: 360°, 720°, and looking directly behind all work.
    this.camera.position.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(pitch, -yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld(true);
    this.controller?.update(deltaSeconds);
    this.renderer.render(this.scene, this.camera);
  }

  setVisible(visible: boolean): void {
    this.canvas.style.display = visible ? 'block' : 'none';
  }

  dispose(): void {
    this.disposed = true;
    this.disposeModel();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private disposeModel(): void {
    if (!this.model) return;
    this.scene.remove(this.model);
    this.model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
      else mesh.material.dispose();
    });
    this.model = null;
    this.controller = null;
  }
}
