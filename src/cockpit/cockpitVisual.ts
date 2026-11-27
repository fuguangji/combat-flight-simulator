import * as THREE from 'three';
import {
  createModularAircraft,
  normalizeAircraftVisualConfig,
  type AircraftVisualConfig,
  type AircraftVisualInput,
  type AircraftVisualPart,
  type AircraftVisualComponent,
} from '../aircraft/builder/modularAircraft';
import { AircraftModelController, type AircraftAnimationInput } from '../aircraft/builder/aircraftAnimation';

const UNIT = 112;
const px = (n: number): string => `${(n * UNIT).toFixed(2)}px`;
const safeColor = (value?: string): string => value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#39443f';
const transform = (position: THREE.Vector3, rotation: THREE.Euler, scale: THREE.Vector3): string =>
  `translate3d(${px(position.z)}, ${px(-position.y)}, ${px(-position.x)}) rotateZ(${-rotation.z}rad) rotateY(${rotation.y}rad) rotateX(${rotation.x}rad) scale3d(${scale.z},${scale.y},${scale.x})`;

/**
 * Projects the editor's cockpit-interior component subtree into the existing CSS 3D cockpit.
 * The source hierarchy and animation controller are the same Three.js model used by the hangar.
 */
export class CockpitVisualRenderer {
  private config: AircraftVisualConfig | null = null;
  private model: THREE.Group | null = null;
  private controller: AircraftModelController | null = null;
  private readonly componentElements = new Map<string, HTMLElement>();
  private readonly partElements = new Map<string, HTMLElement>();
  private controls: AircraftAnimationInput = {};
  private readonly root = document.createElement('div');

  constructor(private readonly host: HTMLElement) {
    this.root.id = 'cockpit-visual-model';
    this.root.setAttribute('aria-hidden', 'true');
    this.host.append(this.root);
  }

  setConfig(input: AircraftVisualInput | null): void {
    this.root.replaceChildren();
    this.componentElements.clear();
    this.partElements.clear();
    this.config = input ? normalizeAircraftVisualConfig(input) : null;
    this.model = this.config ? createModularAircraft(this.config) : null;
    this.controller = this.model && this.config ? new AircraftModelController(this.model, this.config.components) : null;
    if (!this.config || !this.model) {
      this.root.hidden = true;
      return;
    }

    const byId = new Map(this.config.components.map((component) => [component.id, component]));
    const children = new Map<string, AircraftVisualComponent[]>();
    for (const component of this.config.components) {
      if (!component.parent) continue;
      const list = children.get(component.parent) ?? [];
      list.push(component);
      children.set(component.parent, list);
    }
    const details = new Map<string, AircraftVisualPart[]>();
    for (const part of this.config.parts) {
      const list = details.get(part.componentId) ?? [];
      list.push(part);
      details.set(part.componentId, list);
    }

    const interior = this.config.components.find((component) => component.id === 'cockpit-interior')
      ?? this.config.components.find((component) => component.name.toLowerCase().includes('cockpit'));
    if (!interior) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    const renderComponent = (component: AircraftVisualComponent, parent: HTMLElement): void => {
      const element = document.createElement('div');
      element.className = 'cockpit-model-component';
      element.dataset.componentId = component.id;
      parent.append(element);
      this.componentElements.set(component.id, element);
      for (const part of details.get(component.id) ?? []) {
        const partElement = this.createPartElement(part);
        element.append(partElement);
        this.partElements.set(part.id, partElement);
      }
      for (const child of children.get(component.id) ?? []) renderComponent(child, element);
    };
    renderComponent(interior, this.root);
    this.syncTransforms();
  }

  setControls(input: AircraftAnimationInput): void {
    this.controls = { ...this.controls, ...input };
    this.controller?.setControls(this.controls);
  }

  update(deltaSeconds: number): void {
    if (!this.controller) return;
    this.controller.setControls(this.controls);
    this.controller.update(deltaSeconds);
    this.syncTransforms();
  }

  dispose(): void {
    this.root.remove();
    this.componentElements.clear();
    this.partElements.clear();
    this.controller = null;
    this.model = null;
    this.config = null;
  }

  private syncTransforms(): void {
    if (!this.config || !this.model) return;
    const nodes = new Map<string, THREE.Object3D>();
    this.model.traverse((node) => {
      if (typeof node.userData.componentId === 'string') nodes.set(node.userData.componentId, node);
    });
    for (const component of this.config.components) {
      const element = this.componentElements.get(component.id);
      const node = nodes.get(component.id);
      if (!element || !node) continue;
      element.style.transform = transform(node.position, node.rotation, node.scale);
    }
  }

  private createPartElement(part: AircraftVisualPart): HTMLElement {
    const element = document.createElement('div');
    element.className = `cockpit-model-part shape-${part.shape}`;
    element.dataset.partId = part.id;
    const color = safeColor(part.color);
    const opacity = Math.max(0, Math.min(1, part.opacity ?? 1));
    const scale = part.scale ?? [1, 1, 1];
    const position = part.position ?? [0, 0, 0];
    const rotation = part.rotation ?? [0, 0, 0];
    element.style.transform = `translate3d(${px(position[2])}, ${px(-position[1])}, ${px(-position[0])}) rotateZ(${-rotation[2]}rad) rotateY(${rotation[1]}rad) rotateX(${rotation[0]}rad) scale3d(${scale[2]},${scale[1]},${scale[0]})`;
    element.style.backgroundColor = color;
    element.style.opacity = String(opacity);
    element.style.borderColor = color;
    const width = part.width ?? 0.25;
    const height = part.height ?? 0.25;
    const depth = part.depth ?? 0.12;
    const radius = part.radius ?? 0.15;
    const setSize = (w: number, h: number): void => {
      element.style.width = px(w);
      element.style.height = px(h);
    };
    switch (part.shape) {
      case 'box':
        setSize(depth, height);
        element.style.boxShadow = `0 0 ${px(Math.max(1, width * .18))} ${color}, inset 0 0 8px rgba(255,255,255,.12)`;
        element.style.borderRadius = '3px';
        break;
      case 'cylinder':
        setSize(radius * 2, part.height ?? 0.3);
        element.style.borderRadius = '48% / 18%';
        element.style.background = `linear-gradient(90deg,#0008,${color},#fff3,${color},#0008)`;
        break;
      case 'hollowCylinder':
        setSize(radius * 2, part.height ?? 0.3);
        element.style.borderRadius = '50%';
        element.style.background = `radial-gradient(circle, transparent 0 35%, ${color} 38% 100%)`;
        element.style.border = `3px solid ${color}`;
        break;
      case 'cone':
        setSize(radius * 2, part.height ?? 0.3);
        element.style.clipPath = 'polygon(50% 0,100% 100%,0 100%)';
        break;
      case 'sphere':
        setSize(radius * 2, radius * 2);
        element.style.borderRadius = '50%';
        element.style.background = `radial-gradient(circle at 32% 28%,#fff7,${color} 48%,#0009)`;
        break;
      case 'torus':
        setSize(radius * 2, radius * 2);
        element.style.border = `${Math.max(2, (part.tube ?? .04) * UNIT)}px solid ${color}`;
        element.style.borderRadius = '50%';
        element.style.background = 'transparent';
        break;
      case 'polygon': {
        const vertices = part.vertices ?? [[1, 0], [0, 1], [-1, 0]];
        const xs = vertices.map((point) => point[0]);
        const ys = vertices.map((point) => point[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const w = Math.max(.05, maxX - minX), h = Math.max(.05, maxY - minY);
        setSize(part.plane === 'xz' ? h : w, part.plane === 'xz' ? w : h);
        const points = vertices.map(([x, y]) => part.plane === 'xz'
          ? `${((y - minY) / h * 100).toFixed(1)}% ${((maxX - x) / w * 100).toFixed(1)}%`
          : `${((x - minX) / w * 100).toFixed(1)}% ${((maxY - y) / h * 100).toFixed(1)}%`);
        element.style.clipPath = `polygon(${points.join(',')})`;
        break;
      }
    }
    return element;
  }
}
