import * as THREE from 'three';

export type Vec3Tuple = [number, number, number];
export type AircraftPartShape = 'box' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'polygon';
export interface AircraftVisualPart {
  id: string;
  name?: string;
  shape: AircraftPartShape;
  parent?: string;
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
  radiusTop?: number;
  radiusBottom?: number;
  radialSegments?: number;
  tube?: number;
  tubularSegments?: number;
  vertices?: [number, number][];
  plane?: 'xy' | 'xz';
}
export interface AircraftVisualConfig {
  version: 1;
  name?: string;
  parts: AircraftVisualPart[];
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
export function createModularAircraft(config: AircraftVisualConfig): THREE.Group {
  if (config.version !== 1 || !Array.isArray(config.parts)) throw new Error('Unsupported aircraft visual config');
  const root = new THREE.Group();
  root.name = config.name ?? 'Aircraft';
  const nodes = new Map<string, THREE.Group>();
  for (const part of config.parts) {
    if (!part.id || nodes.has(part.id)) throw new Error(`Aircraft visual part IDs must be unique: ${part.id}`);
    nodes.set(part.id, createAircraftPart(part));
  }
  for (const part of config.parts) {
    const node = nodes.get(part.id)!;
    const parent = part.parent ? nodes.get(part.parent) : undefined;
    // Missing parents fall back to the aircraft root instead of losing geometry.
    (parent && parent !== node ? parent : root).add(node);
  }
  return root;
}

/** Editable fallback layout used by aircraft without a dedicated visuals JSON file. */
export function createProceduralAircraftConfig(id: number): AircraftVisualConfig {
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
  const parts: AircraftVisualPart[] = [
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
    parts.push({
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
