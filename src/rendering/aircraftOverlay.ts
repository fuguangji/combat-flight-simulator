import * as THREE from 'three';
import type { AircraftDefinition } from '../aircraft/registry';
import type { AircraftSnapshot } from '../physics/stateLayout';
import type { CameraState } from './Renderer';

/** Transparent Three.js layer that places the selected original game airframe in the live scene. */
export class AircraftSceneOverlay {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.08, 50000);
  private readonly root = new THREE.Group();
  private readonly canvas: HTMLCanvasElement;
  private visible = false;
  private width = 1;
  private height = 1;

  constructor(private readonly host: HTMLElement, aircraft: AircraftDefinition) {
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
    this.root.add(this.buildAirframe(aircraft.id));
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

  private mat(color: number, metalness = 0.58, roughness = 0.36): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, metalness, roughness });
  }

  private add(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number], rotation?: [number, number, number]): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    parent.add(mesh);
    return mesh;
  }

  private buildAirframe(id: number): THREE.Group {
    const model = new THREE.Group();
    const palette = [0x71877e, 0x9b9d91, 0x536d7b, 0x586b77, 0x8c9d8c, 0x6b747b, 0x7e8d98, 0x596d76];
    const hull = this.mat(palette[id % palette.length], 0.72, 0.3);
    const wing = this.mat(palette[(id + 3) % palette.length], 0.66, 0.34);
    const accent = this.mat(0xc0d0c8, 0.76, 0.25);
    const canopy = new THREE.MeshPhysicalMaterial({
      color: 0x397e78, metalness: 0.32, roughness: 0.14,
      transparent: true, opacity: 0.34, clearcoat: 1, depthWrite: false,
    });
    const twinEngine = id % 4 === 0 || id === 5 || id === 8 || id === 14;
    const delta = id % 5 === 2 || id === 3 || id === 10;
    const twinTail = id % 4 === 1 || id === 5 || id === 9 || id === 14;
    const span = 4.5 + (id % 5) * 0.35;
    const sweep = delta ? 1.8 : 0.75 + (id % 4) * 0.18;

    // Local +X is the same forward axis used by the flight simulation.
    const fuselage = this.add(model, new THREE.CylinderGeometry(0.38, 0.48, 9.2, 16), hull, [0, 0, 0], [0, 0, Math.PI / 2]);
    fuselage.scale.set(0.9, 1, 0.78);
    this.add(model, new THREE.ConeGeometry(0.38, 1.7, 16), accent, [5.35, 0, 0], [0, 0, -Math.PI / 2]);
    this.add(model, new THREE.ConeGeometry(0.43, 1.15, 16), hull, [-4.85, 0, 0], [0, 0, Math.PI / 2]);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(1.25, 0);
    wingShape.lineTo(0.35 - sweep, span);
    wingShape.lineTo(-2.15 - sweep * 0.25, span * 0.96);
    wingShape.lineTo(-1.55, 0);
    wingShape.closePath();
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, {
      depth: 0.16, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.04, bevelThickness: 0.025,
    });
    wingGeo.rotateX(-Math.PI / 2);
    wingGeo.computeVertexNormals();
    this.add(model, wingGeo, wing, [0, -0.13, 0]);

    if (id % 3 === 0 || id === 12) {
      const canard = new THREE.Shape();
      canard.moveTo(0.7, 0); canard.lineTo(0.15, 1.55);
      canard.lineTo(-0.7, 1.45); canard.lineTo(-0.55, 0); canard.closePath();
      const geo = new THREE.ExtrudeGeometry(canard, {
        depth: 0.11, bevelEnabled: true, bevelSegments: 1, bevelSize: 0.025, bevelThickness: 0.02,
      });
      geo.rotateX(-Math.PI / 2);
      this.add(model, geo, accent, [2.4, -0.04, 0]);
    }

    const tail = new THREE.Shape();
    tail.moveTo(-3.8, 0.15); tail.lineTo(-2.3, 1.65);
    tail.lineTo(-1.8, 1.5); tail.lineTo(-2.0, 0.12); tail.closePath();
    const tailGeo = new THREE.ShapeGeometry(tail);
    this.add(model, tailGeo, hull, [0, 0.12, twinTail ? 0.55 : 0]);
    if (twinTail) {
      const other = this.add(model, tailGeo.clone(), hull, [0, 0.12, -0.55]);
      other.rotation.y = Math.PI;
    }

    for (const z of (twinEngine ? [-0.55, 0.55] : [0])) {
      this.add(model, new THREE.CylinderGeometry(0.23, 0.29, 1.0, 14), this.mat(0x263b3a, 0.86, 0.26), [-4.0, -0.03, z], [0, 0, Math.PI / 2]);
      this.add(model, new THREE.TorusGeometry(0.25, 0.045, 8, 18), accent, [-4.52, -0.03, z], [0, Math.PI / 2, 0]);
    }
    const glass = this.add(model, new THREE.SphereGeometry(1, 18, 12), canopy, [2.25, 0.38, 0]);
    glass.scale.set(1.25, 0.42, 0.5);
    model.scale.setScalar(0.92 + (id % 4) * 0.035);
    return model;
  }
}
