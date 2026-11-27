import * as THREE from 'three';

export type Vec3Tuple = [number, number, number];
export type AircraftPartShape = 'box' | 'cylinder' | 'hollowCylinder' | 'cone' | 'sphere' | 'torus' | 'polygon';
export type AircraftAnimationChannel = 'pitch' | 'roll' | 'yaw' | 'gear' | 'flaps' | 'canopy';
export type AircraftAnimationAxis = 'x' | 'y' | 'z';
export interface AircraftComponentAnimation {
  channel: AircraftAnimationChannel;
  axis: AircraftAnimationAxis;
  /** Relative rotation limits in radians, added to the component's base rotation. */
  min?: number;
  max?: number;
}
export interface AircraftVisualComponent {
  id: string;
  name: string;
  parent?: string;
  position?: Vec3Tuple;
  rotation?: Vec3Tuple;
  scale?: Vec3Tuple;
  animation?: AircraftComponentAnimation;
}
export interface AircraftVisualPart {
  id: string;
  componentId: string;
  name?: string;
  shape: AircraftPartShape;
  position?: Vec3Tuple;
  rotation?: Vec3Tuple;
  scale?: Vec3Tuple;
  color?: string;
  metalness?: number;
  roughness?: number;
  opacity?: number;
  visible?: boolean;
  width?: number;
  height?: number;
  depth?: number;
  radius?: number;
  innerRadius?: number;
  radiusTop?: number;
  radiusBottom?: number;
  radialSegments?: number;
  tube?: number;
  tubularSegments?: number;
  vertices?: [number, number][];
  plane?: 'xy' | 'xz';
}
export interface AircraftVisualConfig {
  version: 2;
  name?: string;
  /** Optional binding to the aircraft registry key; when present it must match the visual asset filename. */
  aircraftKey?: string;
  components: AircraftVisualComponent[];
  parts: AircraftVisualPart[];
}
export interface LegacyAircraftVisualPart extends Omit<AircraftVisualPart, 'componentId'> { parent?: string; }
export interface LegacyAircraftVisualConfig { version: 1; name?: string; aircraftKey?: string; parts: LegacyAircraftVisualPart[]; }
export type AircraftVisualInput = AircraftVisualConfig | LegacyAircraftVisualConfig;

export function validateAircraftVisualConfig(config: AircraftVisualConfig): void {
  if (config.version !== 2 || !Array.isArray(config.components) || !Array.isArray(config.parts)) throw new Error('模型格式錯誤：需要 version 2、components 與 parts');
  if (config.aircraftKey !== undefined && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(config.aircraftKey)) throw new Error('模型 aircraftKey 必須是 kebab-case 機型識別碼');
  const ids = new Set<string>();
  const components = new Map<string, AircraftVisualComponent>();
  for (const component of config.components) {
    if (!component.id?.trim() || ids.has(component.id)) throw new Error(`組件 ID 無效或重複：${component.id}`);
    ids.add(component.id); components.set(component.id, component);
  }
  const roots = config.components.filter((component) => !component.parent);
  if (roots.length !== 1) throw new Error(`模型必須且只能有一個根組件，目前找到 ${roots.length} 個`);
  for (const component of config.components) {
    if (component.parent && !components.has(component.parent)) throw new Error(`孤兒組件「${component.name}」：找不到父組件「${component.parent}」`);
    const visited = new Set([component.id]); let parent = component.parent;
    while (parent) { if (visited.has(parent)) throw new Error(`組件階層形成循環：${component.name}`); visited.add(parent); parent = components.get(parent)?.parent; }
  }
  const validVec3 = (value: unknown): value is Vec3Tuple =>
    Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
  for (const component of config.components) {
    for (const [label, value] of [['position', component.position], ['rotation', component.rotation], ['scale', component.scale]] as const) {
      if (value !== undefined && !validVec3(value)) throw new Error(`組件「${component.name}」的 ${label} 必須是三個有限數值`);
    }
    const animation = component.animation;
    if (!animation) continue;
    if (!['pitch', 'roll', 'yaw', 'gear', 'flaps', 'canopy'].includes(animation.channel)) throw new Error(`組件「${component.name}」的動畫通道無效`);
    if (!['x', 'y', 'z'].includes(animation.axis)) throw new Error(`組件「${component.name}」的動畫軸無效`);
    if ((animation.min !== undefined && !Number.isFinite(animation.min)) || (animation.max !== undefined && !Number.isFinite(animation.max))) {
      throw new Error(`組件「${component.name}」的動畫角度必須是有限數值`);
    }
  }
  const shapes: readonly string[] = ['box', 'cylinder', 'hollowCylinder', 'cone', 'sphere', 'torus', 'polygon'];
  for (const part of config.parts) {
    if (!part.id?.trim() || ids.has(part.id)) throw new Error(`細節 ID 無效或重複：${part.id}`);
    ids.add(part.id);
    if (!components.has(part.componentId)) throw new Error(`孤兒細節「${part.name ?? part.id}」：找不到所屬組件「${part.componentId}」`);
    if (!shapes.includes(part.shape)) throw new Error(`細節「${part.id}」的幾何類型無效`);
    for (const [label, value] of [['position', part.position], ['rotation', part.rotation], ['scale', part.scale]] as const) {
      if (value !== undefined && !validVec3(value)) throw new Error(`細節「${part.id}」的 ${label} 必須是三個有限數值`);
    }
    for (const key of ['width', 'height', 'depth', 'radius', 'innerRadius', 'radiusTop', 'radiusBottom', 'tube'] as const) {
      const value = part[key];
      if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error(`細節「${part.id}」的 ${key} 必須是大於 0 的有限數值`);
    }
    for (const key of ['metalness', 'roughness', 'opacity'] as const) {
      const value = part[key];
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) throw new Error(`細節「${part.id}」的 ${key} 必須介於 0 到 1`);
    }
    if (part.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(part.color)) throw new Error(`細節「${part.id}」的顏色必須是 #RRGGBB`);
    if (part.radialSegments !== undefined && (!Number.isInteger(part.radialSegments) || part.radialSegments < 3 || part.radialSegments > 256)) throw new Error(`細節「${part.id}」的分段數必須是 3 到 256 的整數`);
    if (part.tubularSegments !== undefined && (!Number.isInteger(part.tubularSegments) || part.tubularSegments < 3 || part.tubularSegments > 256)) throw new Error(`細節「${part.id}」的圓環分段數必須是 3 到 256 的整數`);
    if (part.plane !== undefined && part.plane !== 'xy' && part.plane !== 'xz') throw new Error(`細節「${part.id}」的擠出平面無效`);
    if (part.vertices !== undefined && (!Array.isArray(part.vertices) || part.vertices.length < 3 || !part.vertices.every((point) => Array.isArray(point) && point.length === 2 && point.every((value) => Number.isFinite(value))))) throw new Error(`細節「${part.id}」的頂點必須至少包含三組有限 [x, y] 座標`);
    if (part.shape === 'polygon' && (!part.vertices || part.vertices.length < 3)) throw new Error(`Polygon part「${part.id}」至少需要三個頂點`);
    if (part.shape === 'hollowCylinder' && part.innerRadius !== undefined && part.radius !== undefined && part.innerRadius >= part.radius) throw new Error(`空心圓筒「${part.id}」的內半徑必須小於外半徑`);
  }
}

export function normalizeAircraftVisualConfig(input: AircraftVisualInput): AircraftVisualConfig {
  if (input.version === 2) { validateAircraftVisualConfig(input); return input; }
  if (input.version !== 1 || !Array.isArray(input.parts)) throw new Error('不支援的模型 JSON 格式');
  const ids = new Set<string>(); const byId = new Map<string, LegacyAircraftVisualPart>();
  for (const part of input.parts) { if (!part.id || ids.has(part.id)) throw new Error(`零件 ID 無效或重複：${part.id}`); ids.add(part.id); byId.set(part.id, part); }
  for (const part of input.parts) {
    if (part.parent && !byId.has(part.parent)) throw new Error(`孤兒零件「${part.name ?? part.id}」：找不到父零件「${part.parent}」`);
    const visited = new Set([part.id]); let parent = part.parent;
    while (parent) { if (visited.has(parent)) throw new Error(`零件階層形成循環：${part.id}`); visited.add(parent); parent = byId.get(parent)?.parent; }
  }
  const components: AircraftVisualComponent[] = [{ id: 'aircraft-root', name: '飛機本體' }, ...input.parts.map((part) => ({ id: `component-${part.id}`, name: part.name?.trim() || part.id, parent: part.parent ? `component-${part.parent}` : 'aircraft-root', position: part.position ?? [0,0,0], rotation: part.rotation ?? [0,0,0], scale: part.scale ?? [1,1,1] }))];
  const parts: AircraftVisualPart[] = input.parts.map((part) => {
    const { parent: _parent, position: _position, rotation: _rotation, scale: _scale, ...geometry } = part;
    return { ...geometry, id: part.id, componentId: `component-${part.id}`, position: [0,0,0], rotation: [0,0,0], scale: [1,1,1] };
  });
  const migrated: AircraftVisualConfig = { version: 2, name: input.name, aircraftKey: input.aircraftKey, components, parts };
  validateAircraftVisualConfig(migrated); return migrated;
}

const vec = (value: Vec3Tuple | undefined, fallback: Vec3Tuple): Vec3Tuple => value ?? fallback;
const hex = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number.parseInt(value.replace(/^#/, ''), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function createGeometry(part: AircraftVisualPart): THREE.BufferGeometry {
  switch (part.shape) {
    case 'box':
      return new THREE.BoxGeometry(part.width ?? 1, part.height ?? 1, part.depth ?? 1);
    case 'cylinder':
      return new THREE.CylinderGeometry(part.radiusTop ?? part.radius ?? 0.3, part.radiusBottom ?? part.radius ?? 0.3, part.height ?? 1, part.radialSegments ?? 16);
    case 'hollowCylinder': {
      const outer = Math.max(0.02, part.radius ?? 0.5);
      const inner = THREE.MathUtils.clamp(part.innerRadius ?? outer * 0.65, 0.01, outer - 0.01);
      const shape = new THREE.Shape();
      shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
      const hole = new THREE.Path();
      hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: part.height ?? 1, bevelEnabled: false, steps: 1,
        curveSegments: part.radialSegments ?? 24,
      });
      geometry.translate(0, 0, -(part.height ?? 1) / 2);
      geometry.rotateX(Math.PI / 2);
      geometry.computeVertexNormals();
      return geometry;
    }
    case 'cone':
      return new THREE.ConeGeometry(part.radius ?? 0.3, part.height ?? 1, part.radialSegments ?? 16);
    case 'sphere':
      return new THREE.SphereGeometry(part.radius ?? 0.5, part.radialSegments ?? 16, Math.max(8, Math.floor((part.radialSegments ?? 16) * 0.65)));
    case 'torus':
      return new THREE.TorusGeometry(part.radius ?? 0.5, part.tube ?? 0.05, 8, part.tubularSegments ?? 24);
    case 'polygon': {
      if (!part.vertices || part.vertices.length < 3) throw new Error(`Polygon part "${part.id}" requires at least three vertices`);
      const shape = new THREE.Shape();
      shape.moveTo(part.vertices[0][0], part.vertices[0][1]);
      for (const [x, y] of part.vertices.slice(1)) shape.lineTo(x, y);
      shape.closePath();
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: part.depth ?? 0.12,
        bevelEnabled: false,
        steps: 1,
        curveSegments: 1,
      });
      // XZ polygons are convenient for wings: extrusion becomes thickness along Y.
      if (part.plane === 'xz') {
        geometry.translate(0, 0, -(part.depth ?? 0.12) / 2);
        geometry.rotateX(Math.PI / 2);
      } else {
        geometry.translate(0, 0, -(part.depth ?? 0.12) / 2);
      }
      geometry.computeVertexNormals();
      return geometry;
    }
  }
}

export function createAircraftPart(part: AircraftVisualPart): THREE.Group {
  const group = new THREE.Group();
  group.name = part.name ?? part.id;
  group.userData.partId = part.id;
  group.visible = part.visible ?? true;
  const material = new THREE.MeshStandardMaterial({
    color: hex(part.color, 0x738d83),
    metalness: part.metalness ?? 0.68,
    roughness: part.roughness ?? 0.32,
    transparent: (part.opacity ?? 1) < 1,
    opacity: part.opacity ?? 1,
  });
  const mesh = new THREE.Mesh(createGeometry(part), material);
  mesh.name = `${part.id}:mesh`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  group.position.set(...vec(part.position, [0, 0, 0]));
  group.rotation.set(...vec(part.rotation, [0, 0, 0]));
  group.scale.set(...vec(part.scale, [1, 1, 1]));
  return group;
}

/** Build a hard-surface aircraft from independently editable, hierarchical parts. */
export function createModularAircraft(input: AircraftVisualInput): THREE.Group {
  const config = normalizeAircraftVisualConfig(input);
  const root = new THREE.Group();
  root.name = config.name ?? 'Aircraft';
  const nodes = new Map<string, THREE.Group>();
  for (const component of config.components) {
    const node = new THREE.Group();
    node.name = component.name;
    node.userData.componentId = component.id;
    node.position.set(...vec(component.position, [0, 0, 0]));
    node.rotation.set(...vec(component.rotation, [0, 0, 0]));
    node.scale.set(...vec(component.scale, [1, 1, 1]));
    nodes.set(component.id, node);
  }
  for (const component of config.components) {
    const node = nodes.get(component.id)!;
    const parent = component.parent ? nodes.get(component.parent) : root;
    if (!parent) throw new Error(`孤兒組件：${component.name}`);
    parent.add(node);
  }
  for (const part of config.parts) {
    const component = nodes.get(part.componentId);
    if (!component) throw new Error(`孤兒細節：${part.name ?? part.id}`);
    component.add(createAircraftPart(part));
  }
  return root;
}

/** Editable fallback layout used by aircraft without a dedicated visuals JSON file. */
export function createProceduralAircraftConfig(id: number): LegacyAircraftVisualConfig {
  const palette = ['#738d83', '#8d9b92', '#586d78', '#536b78', '#899c88', '#59666b', '#7d8c95', '#596c75'];
  const body = palette[id % palette.length];
  const wing = palette[(id + 2) % palette.length];
  const twinEngine = id % 4 === 0 || id === 5 || id === 8 || id === 14;
  const canard = id % 3 === 0 || id === 12;
  const twinTail = id % 4 === 1 || id === 5 || id === 9 || id === 14;
  const delta = id % 5 === 2 || id === 3 || id === 10;
  const span = 2.5 + (id % 5) * 0.25;
  const sweep = delta ? 1.35 : 0.35 + (id % 4) * 0.18;
  const rear = delta ? 1.8 : 0.95 + (id % 3) * 0.2;
  const parts: LegacyAircraftVisualPart[] = [
    { id: 'fuselage', shape: 'cylinder', radiusTop: 0.27, radiusBottom: 0.39, height: 6.2, radialSegments: 20, rotation: [0, 0, -Math.PI / 2], color: body },
    { id: 'nose', shape: 'cone', radius: 0.27, height: 1.35, radialSegments: 20, position: [3.72, 0, 0], rotation: [0, 0, -Math.PI / 2], color: '#b9d2c4' },
    { id: 'rear-fairing', shape: 'cone', radius: 0.31, height: 0.95, radialSegments: 20, position: [-3.45, 0, 0], rotation: [0, 0, Math.PI / 2], color: body },
    { id: 'canopy', shape: 'sphere', radius: 1, radialSegments: 20, position: [0.95, 0.3, 0], scale: [1.18, 0.37, 0.47], color: '#4cae9b', opacity: 0.78, metalness: 0.45, roughness: 0.12 },
    { id: 'instrument-rail', shape: 'box', width: 1.05, height: 0.025, depth: 0.04, position: [-0.35, 0.27, 0], rotation: [0, 0, -0.02], color: '#b9d2c4' },
  ];
  for (const side of [-1, 1] as const) {
    parts.push({
      id: `main-wing-${side}`, shape: 'polygon', plane: 'xz', depth: 0.12, position: [0, -0.12, 0], color: wing,
      vertices: [[1.05, 0], [0.55 - sweep, side * span], [-rear - sweep * 0.18, side * span * 0.96], [-1.42, 0]],
    });
    if (canard) parts.push({
      id: `canard-${side}`, shape: 'polygon', plane: 'xz', depth: 0.1, position: [1.65, -0.02, 0], scale: [0.52, 1, 0.62], color: '#9aafa3',
      vertices: [[0.65, 0], [0.25, side * 1.1], [-0.42, side * 1.1], [-0.75, 0]],
    });
    if (twinTail || side === 1) parts.push({
      id: `vertical-fin-${side}`, shape: 'polygon', plane: 'xy', depth: 0.12,
      position: [0, 0.15, twinTail ? side * 0.48 : 0], color: body,
      vertices: [[-2.5, 0.18], [-1.2, 1.5], [-0.75, 1.42], [-0.85, 0.12]],
    });
    if (twinEngine || side === 1) {
      parts.push({ id: `engine-nozzle-${side}`, shape: 'cylinder', radiusTop: 0.19, radiusBottom: 0.24, height: 0.8, radialSegments: 16, position: [-2.75, -0.02, twinEngine ? side * 0.48 : 0], rotation: [0, 0, Math.PI / 2], color: '#273c3a', metalness: 0.9, roughness: 0.24 });
      parts.push({ id: `engine-inner-${side}`, shape: 'cylinder', radius: 0.13, height: 0.035, radialSegments: 16, position: [-3.17, -0.02, twinEngine ? side * 0.48 : 0], rotation: [0, 0, Math.PI / 2], color: '#6a9d8c' });
    }
  }
  return { version: 1, name: `Aircraft-${id}`, parts };
}
