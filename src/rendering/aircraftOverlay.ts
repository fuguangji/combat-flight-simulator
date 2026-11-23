import * as THREE from 'three';
import type { AircraftDefinition } from '../aircraft/registry';
import type { AircraftSnapshot } from '../physics/stateLayout';
import type { CameraState } from './Renderer';
import type { EncyclopediaViewer } from '../encyclopedia/modelViewer';

/**
 * Transparent live-scene layer. It requests the exact same procedural model
 * factory used by the encyclopedia, then places that model on the physics body.
 */
export class AircraftSceneOverlay {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.08, 50000);
  private readonly root = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;
  private visible = false;
  private width = 1;
  private height = 1;

  constructor(
    private readonly host: HTMLElement,
    aircraft: AircraftDefinition,
    private readonly modelFactory: Pick<EncyclopediaViewer, 'createAircraftModel'>,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, {
      position: 'absolute', inset: '0', width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '1', display: 'none',
    });
    this.host.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, alpha: true, antialias: false,
      powerPreference: 'low-power', premultipliedAlpha: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(this.root);
    this.setAircraft(aircraft);
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  setAircraft(aircraft: AircraftDefinition): void {
    for (const child of [...this.root.children]) {
      child.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
        else mesh.material?.dispose();
      });
    }
    this.root.clear();
    this.root.add(this.modelFactory.createAircraftModel(aircraft.id));
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.canvas.style.display = visible ? 'block' : 'none';
  }

  render(view: CameraState, snapshot: AircraftSnapshot): void {
    if (!this.visible) return;
    const q = snapshot.orientation;
    this.root.position.set(...snapshot.position);
    this.root.quaternion.set(q[0], q[1], q[2], q[3]);
    this.camera.position.set(...view.position);
    this.camera.up.set(...view.up);
    this.camera.lookAt(
      view.position[0] + view.forward[0],
      view.position[1] + view.forward[1],
      view.position[2] + view.forward[2],
    );
    this.camera.fov = THREE.MathUtils.radToDeg(view.fovY);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  private resize = (): void => {
    const rect = this.host.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setSize(Math.round(this.width * dpr), Math.round(this.height * dpr), false);
  };
}
