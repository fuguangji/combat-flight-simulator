import * as THREE from 'three';
import viperSample from '../aircraft/visuals/viper-t21.json';
import { AircraftModelController } from '../aircraft/builder/aircraftAnimation';
import {
  createModularAircraft,
  normalizeAircraftVisualConfig,
  type AircraftVisualConfig,
  type AircraftVisualInput,
  type AircraftVisualComponent,
  type AircraftVisualPart,
  type AircraftPartShape,
} from '../aircraft/builder/modularAircraft';
import './style.css';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing editor element: #${id}`);
  return element as T;
};
const canvas = $('preview') as HTMLCanvasElement;
const viewport = $('viewport');
const partsList = $('parts-list');
const inspector = $('inspector') as HTMLFormElement;
const toast = $('toast');
const STORAGE_KEY = 'cfs-aircraft-visual-editor-v1';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const radians = Math.PI / 180;
const degrees = 180 / Math.PI;

const defaultConfig = (): AircraftVisualConfig => ({
  version: 2,
  name: 'Untitled Aircraft',
  components: [{ id: 'aircraft-root', name: '飛機本體' }],
  parts: [],
});
let config: AircraftVisualConfig = defaultConfig();
let previewController: AircraftModelController | null = null;
let selectedId: string | null = null;
let selectedComponentId = 'aircraft-root';
let history: AircraftVisualConfig[] = [];
let historyIndex = -1;
let toastTimer = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x121720);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
let cameraYaw = 0.72;
let cameraPitch = 0.38;
let cameraDistance = 11;
const updateCamera = (): void => {
  const horizontal = Math.cos(cameraPitch) * cameraDistance;
  camera.position.set(Math.sin(cameraYaw) * horizontal, Math.sin(cameraPitch) * cameraDistance, Math.cos(cameraYaw) * horizontal);
  camera.lookAt(0, 0, 0);
};
updateCamera();

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
scene.add(new THREE.HemisphereLight(0xe0e9f5, 0x252d39, 2.1));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(7, 10, 8);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x8fb7e8, 1.5);
rimLight.position.set(-7, 3, -6);
scene.add(rimLight);
const grid = new THREE.GridHelper(24, 24, 0x71849b, 0x303b4b);
grid.position.y = -1.7;
scene.add(grid);
const axes = new THREE.AxesHelper(3.5);
scene.add(axes);
const modelRoot = new THREE.Group();
scene.add(modelRoot);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let dragging = false;
let lastPointer = { x: 0, y: 0 };
let dragDistance = 0;

const disposeModel = (): void => {
  modelRoot.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
    else if (mesh.material) mesh.material.dispose();
  });
  modelRoot.clear();
};

const partLabel = (part: AircraftVisualPart): string => part.name?.trim() || part.id;
const selectedPart = (): AircraftVisualPart | undefined => config.parts.find((part) => part.id === selectedId);
const uniqueId = (base: string): string => {
  const clean = base.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '') || 'part';
  let id = clean;
  let index = 2;
  while (config.parts.some((part) => part.id === id) || config.components.some((component) => component.id === id)) id = `${clean}-${index++}`;
  return id;
};

const saveHistory = (): void => {
  history = history.slice(0, historyIndex + 1);
  history.push(clone(config));
  if (history.length > 60) history.shift();
  historyIndex = history.length - 1;
  updateHistoryButtons();
};
const updateHistoryButtons = (): void => {
  ($('undo') as HTMLButtonElement).disabled = historyIndex <= 0;
  ($('redo') as HTMLButtonElement).disabled = historyIndex >= history.length - 1;
};
const persist = (): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    $('autosave-status').textContent = '已自動暫存於此瀏覽器';
  } catch {
    $('autosave-status').textContent = '本機儲存不可用；請記得匯出 JSON';
  }
};
const notify = (message: string): void => {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1900);
};

const renderModel = (): void => {
  disposeModel();
  try {
    const model = createModularAircraft(config);
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const partGroup = object.parent;
      if (partGroup?.userData.partId === selectedId) {
        const original = object.material as THREE.MeshStandardMaterial;
        const highlighted = original.clone();
        highlighted.emissive = new THREE.Color(0x426fa8);
        highlighted.emissiveIntensity = 0.48;
        object.material = highlighted;
      }
    });
    modelRoot.add(model);
    previewController = new AircraftModelController(model, config.components);
    $('empty-hint').toggleAttribute('hidden', config.parts.length > 0);
  } catch (error) {
    notify(error instanceof Error ? error.message : '模型建立失敗');
    $('empty-hint').removeAttribute('hidden');
  }
  setValue('model-name-input', config.name || 'Untitled Aircraft');
  $('selection-status').textContent = selectedPart() ? `細節：${selectedPart()!.name ?? selectedPart()!.id}` : `組件：${config.components.find((item) => item.id === selectedComponentId)?.name ?? '未選取'}`;
};

const shapeSymbol: Record<AircraftPartShape, string> = { box: '▧', cylinder: '▤', hollowCylinder: '◉', cone: '△', sphere: '●', torus: '◎', polygon: '⬡' };
const renderPartsList = (): void => {
  partsList.replaceChildren();
  const byId = new Map(config.components.map((component) => [component.id, component]));
  const children = new Map<string, AircraftVisualComponent[]>();
  for (const component of config.components) {
    if (!component.parent) continue;
    const list = children.get(component.parent) ?? [];
    list.push(component);
    children.set(component.parent, list);
  }
  const details = new Map<string, AircraftVisualPart[]>();
  for (const part of config.parts) {
    const list = details.get(part.componentId) ?? [];
    list.push(part);
    details.set(part.componentId, list);
  }
  const appendComponent = (component: AircraftVisualComponent, depth: number): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `part-entry component-entry${component.id === selectedComponentId && !selectedId ? ' selected' : ''}`;
    button.style.paddingLeft = `${10 + depth * 15}px`;
    const icon = document.createElement('span');
    icon.className = 'part-icon';
    icon.textContent = '▣';
    const label = document.createElement('span');
    label.textContent = component.name;
    button.append(icon, label);
    button.addEventListener('click', () => selectComponent(component.id));
    partsList.append(button);
    for (const part of details.get(component.id) ?? []) {
      const detail = document.createElement('button');
      detail.type = 'button';
      detail.className = `part-entry detail-entry${part.id === selectedId ? ' selected' : ''}`;
      detail.style.paddingLeft = `${25 + (depth + 1) * 15}px`;
      const detailIcon = document.createElement('span');
      detailIcon.className = 'part-icon';
      detailIcon.textContent = shapeSymbol[part.shape];
      const detailLabel = document.createElement('span');
      detailLabel.textContent = partLabel(part);
      detail.append(detailIcon, detailLabel);
      detail.addEventListener('click', () => selectPart(part.id));
      partsList.append(detail);
    }
    for (const child of children.get(component.id) ?? []) appendComponent(child, depth + 1);
  };
  const roots = config.components.filter((component) => !component.parent);
  for (const root of roots) appendComponent(root, 0);
  $('part-count').textContent = `${config.components.length} 個組件 · ${config.parts.length} 個細節`;
  document.querySelectorAll<HTMLButtonElement>('[data-add-detail]').forEach((button) => {
    button.disabled = !selectedComponentId || !byId.has(selectedComponentId);
  });
};

const setValue = (id: string, value: string | number): void => {
  ($(id) as HTMLInputElement).value = String(value);
};
const readNumber = (id: string, fallback: number): number => {
  const value = Number(($(id) as HTMLInputElement).value);
  return Number.isFinite(value) ? value : fallback;
};
const fillInspector = (): void => {
  const part = selectedPart();
  const component = config.components.find((item) => item.id === selectedComponentId);
  $('inspector-empty').toggleAttribute('hidden', Boolean(part || component));
  inspector.hidden = !part;
  $('component-inspector').toggleAttribute('hidden', !component || Boolean(part));
  if (component && !part) {
    setValue('component-name', component.name);
    setValue('component-id', component.id);
    const position = component.position ?? [0, 0, 0];
    const rotation = component.rotation ?? [0, 0, 0];
    ['x', 'y', 'z'].forEach((axis, index) => {
      setValue(`component-pos-${axis}`, position[index]);
      setValue(`component-rot-${axis}`, Number((rotation[index] * degrees).toFixed(2)));
    });
    setValue('component-animation-channel', component.animation?.channel ?? '');
    setValue('component-animation-axis', component.animation?.axis ?? 'x');
    setValue('component-animation-min', Number(((component.animation?.min ?? 0) * degrees).toFixed(2)));
    setValue('component-animation-max', Number(((component.animation?.max ?? Math.PI / 4) * degrees).toFixed(2)));
    return;
  }
  if (!part) return;
  setValue('part-name', part.name ?? part.id);
  setValue('part-id', part.id);
  setValue('part-shape', part.shape);
  const position = part.position ?? [0, 0, 0];
  const rotation = part.rotation ?? [0, 0, 0];
  const scale = part.scale ?? [1, 1, 1];
  ['x', 'y', 'z'].forEach((axis, index) => {
    setValue(`pos-${axis}`, position[index]);
    setValue(`rot-${axis}`, Number((rotation[index] * degrees).toFixed(2)));
    setValue(`scale-${axis}`, scale[index]);
  });
  setValue('dim-width', part.width ?? 1);
  setValue('dim-height', part.height ?? 1);
  setValue('dim-depth', part.depth ?? 0.12);
  setValue('dim-radius', part.radius ?? 0.5);
  setValue('dim-inner-radius', part.innerRadius ?? (part.radius ?? 0.5) * 0.65);
  setValue('dim-radius-top', part.radiusTop ?? part.radius ?? 0.3);
  setValue('dim-radius-bottom', part.radiusBottom ?? part.radius ?? 0.3);
  setValue('dim-tube', part.tube ?? 0.05);
  setValue('dim-segments', part.radialSegments ?? part.tubularSegments ?? 16);
  setValue('part-vertices', JSON.stringify(part.vertices ?? [[1, 0], [0, 1], [-1, 0]], null, 2));
  setValue('part-color', part.color ?? '#738d83');
  setValue('part-metalness', part.metalness ?? 0.68);
  setValue('part-roughness', part.roughness ?? 0.32);
  setValue('part-opacity', part.opacity ?? 1);
  ($('part-visible') as HTMLInputElement).checked = part.visible ?? true;
  ['metalness', 'roughness', 'opacity'].forEach((key) => {
    $(`${key}-value`).textContent = Number((part as unknown as Record<string, number>)[key] ?? (key === 'opacity' ? 1 : key === 'metalness' ? .68 : .32)).toFixed(2);
  });
};
const selectComponent = (id: string): void => {
  selectedComponentId = id;
  selectedId = null;
  renderPartsList();
  fillInspector();
  renderModel();
};
const selectPart = (id: string | null): void => {
  selectedId = id;
  if (id) selectedComponentId = config.parts.find((part) => part.id === id)?.componentId ?? selectedComponentId;
  renderPartsList();
  fillInspector();
  renderModel();
};

const commitEdit = (): void => {
  const part = selectedPart();
  if (!part) return;
  const nextId = ($( 'part-id') as HTMLInputElement).value.trim();
  if (!nextId || (nextId !== part.id && (config.parts.some((item) => item.id === nextId) || config.components.some((item) => item.id === nextId)))) {
    notify('ID 不可空白或與其他零件重複');
    setValue('part-id', part.id);
    return;
  }
  const oldId = part.id;
  part.id = nextId;
  if (oldId !== nextId) {
    selectedId = nextId;
  }
  part.name = ($('part-name') as HTMLInputElement).value.trim() || part.id;
  part.shape = ($('part-shape') as HTMLSelectElement).value as AircraftPartShape;
  part.position = ['x', 'y', 'z'].map((axis) => readNumber(`pos-${axis}`, 0)) as [number, number, number];
  part.rotation = ['x', 'y', 'z'].map((axis) => readNumber(`rot-${axis}`, 0) * radians) as [number, number, number];
  part.scale = ['x', 'y', 'z'].map((axis) => Math.max(.01, readNumber(`scale-${axis}`, 1))) as [number, number, number];
  part.width = Math.max(.01, readNumber('dim-width', 1));
  part.height = Math.max(.01, readNumber('dim-height', 1));
  part.depth = Math.max(.01, readNumber('dim-depth', .12));
  part.radius = Math.max(.01, readNumber('dim-radius', .5));
  part.innerRadius = Math.max(.01, Math.min(part.radius - .01, readNumber('dim-inner-radius', part.radius * .65)));
  part.radiusTop = Math.max(0, readNumber('dim-radius-top', .3));
  part.radiusBottom = Math.max(0, readNumber('dim-radius-bottom', .3));
  part.tube = Math.max(.01, readNumber('dim-tube', .05));
  part.radialSegments = Math.max(3, Math.min(96, Math.round(readNumber('dim-segments', 16))));
  part.tubularSegments = part.radialSegments;
  try {
    const vertices = JSON.parse(($('part-vertices') as HTMLTextAreaElement).value) as unknown;
    if (!Array.isArray(vertices) || vertices.length < 3 || !vertices.every((point) => Array.isArray(point) && point.length === 2 && point.every((v) => typeof v === 'number' && Number.isFinite(v)))) {
      throw new Error('頂點必須是至少 3 組 [x, y] 數值');
    }
    part.vertices = vertices as [number, number][];
  } catch (error) {
    notify(error instanceof Error ? error.message : '頂點 JSON 格式錯誤');
    return;
  }
  part.color = ($('part-color') as HTMLInputElement).value;
  part.metalness = readNumber('part-metalness', .68);
  part.roughness = readNumber('part-roughness', .32);
  part.opacity = readNumber('part-opacity', 1);
  part.visible = ($('part-visible') as HTMLInputElement).checked;
  renderPartsList();
  renderModel();
  persist();
};

const addComponent = (): void => {
  const parent = config.components.find((item) => item.id === selectedComponentId);
  if (!parent) { notify('請先選取一個有效組件'); return; }
  const index = config.components.length;
  const component: AircraftVisualComponent = {
    id: uniqueId(`component-${index + 1}`),
    name: `新組件 ${index + 1}`,
    parent: parent.id,
  };
  config.components.push(component);
  saveHistory(); persist();
  selectComponent(component.id);
  notify('已新增子組件；可在右側修改名稱');
};
const addPart = (shape: AircraftPartShape): void => {
  if (!config.components.some((component) => component.id === selectedComponentId)) {
    notify('請先選取要新增細節的組件'); return;
  }
  const index = config.parts.length + 1;
  const shapeNames: Record<AircraftPartShape, string> = {
    box: '方塊', cylinder: '圓柱', hollowCylinder: '空心圓筒',
    cone: '圓錐', sphere: '球體', torus: '圓環', polygon: '擠出輪廓',
  };
  const part: AircraftVisualPart = {
    id: uniqueId(`${shape}-${index}`),
    name: `${shapeNames[shape]} ${index}`,
    shape,
    componentId: selectedComponentId,
    position: [0, 0, 0],
    color: '#8795a8',
    metalness: .68,
    roughness: .32,
  };
  if (shape === 'hollowCylinder') {
    part.radius = 0.5;
    part.innerRadius = 0.32;
    part.height = 1;
    part.radialSegments = 32;
    part.color = '#aab4c2';
  }
  if (shape === 'polygon') {
    part.plane = 'xz';
    part.depth = .12;
    part.vertices = [[.9, 0], [.2, 1.8], [-1.2, 1.8], [-1.45, 0]];
  }
  config.parts.push(part);
  saveHistory();
  persist();
  selectPart(part.id);
};
const addCannonVisual = (): void => {
  const component: AircraftVisualComponent = {
    id: uniqueId('cannon'),
    name: '機炮',
    parent: selectedComponentId,
  };
  config.components.push(component);
  selectedComponentId = component.id;
  saveHistory(); persist(); selectComponent(component.id);
  notify('已新增機炮組件；現在可新增其幾何細節');
};
const addCockpitInterior = (): void => {
  const parent = config.components.find((component) => component.id === selectedComponentId);
  if (!parent) { notify('請先選取飛機本體或有效組件'); return; }
  if (config.components.some((component) => component.id === 'cockpit-interior')) {
    notify('模型中已存在座艙內飾組件'); return;
  }
  const addComponentNode = (id: string, name: string, position: [number, number, number], animation?: AircraftVisualComponent['animation']): string => {
    const actualId = uniqueId(id);
    config.components.push({ id: actualId, name, parent: parent.id, position, animation });
    return actualId;
  };
  const addDetail = (componentId: string, id: string, name: string, shape: AircraftPartShape, values: Partial<AircraftVisualPart>): void => {
    config.parts.push({
      id: uniqueId(id), componentId, name, shape, color: '#303b42',
      metalness: .42, roughness: .58, ...values,
    });
  };
  const interior = addComponentNode('cockpit-interior', '座艙內飾', [0, 0, 0]);
  const tub = addComponentNode('cockpit-tub', '座艙底槽', [0, 0, 0]);
  config.components[config.components.length - 1].parent = interior;
  addDetail(tub, 'cockpit-floor', '座艙地板', 'box', { width: 2.8, height: .16, depth: 1.55, position: [-.2, -.22, 0], color: '#202a2e' });
  addDetail(tub, 'cockpit-sidewall-left', '左側內壁', 'box', { width: 2.35, height: .62, depth: .12, position: [-.15, .12, -.7], color: '#39464b' });
  addDetail(tub, 'cockpit-sidewall-right', '右側內壁', 'box', { width: 2.35, height: .62, depth: .12, position: [-.15, .12, .7], color: '#39464b' });

  const panel = addComponentNode('instrument-panel', '儀表板', [.88, .48, 0]);
  config.components[config.components.length - 1].parent = interior;
  addDetail(panel, 'instrument-panel-body', '儀表板本體', 'box', { width: .18, height: .72, depth: 1.48, rotation: [0, 0, -.16], color: '#151d22' });
  for (const [side, z] of [['left', -.39], ['right', .39]] as const) {
    addDetail(panel, `mfd-${side}`, side === 'left' ? '左多功能顯示器' : '右多功能顯示器', 'box', {
      width: .055, height: .31, depth: .43, position: [-.105, .08, z], color: '#102d32',
      metalness: .18, roughness: .22,
    });
  }
  for (const z of [-.66, .66]) {
    addDetail(panel, `panel-dial-${z}`, '圓形儀表', 'cylinder', {
      radius: .105, height: .045, radialSegments: 24, position: [-.11, -.18, z], rotation: [0, 0, Math.PI / 2], color: '#aab5ad',
    });
  }
  addDetail(panel, 'panel-center-display', '中央狀態顯示器', 'box', { width: .05, height: .2, depth: .25, position: [-.11, .34, 0], color: '#183c3d', metalness: .12 });

  const hud = addComponentNode('hud', '抬頭顯示器', [1.22, .92, 0]);
  config.components[config.components.length - 1].parent = interior;
  addDetail(hud, 'hud-combiner', 'HUD 透明反射片', 'box', { width: .025, height: .34, depth: .42, position: [0, .05, 0], color: '#76c9ad', opacity: .22, metalness: .05, roughness: .12 });
  addDetail(hud, 'hud-frame', 'HUD 支架', 'box', { width: .12, height: .06, depth: .52, position: [-.04, -.15, 0], color: '#69777a' });

  const seat = addComponentNode('pilot-seat', '飛行員座椅', [-.62, .02, 0]);
  config.components[config.components.length - 1].parent = interior;
  addDetail(seat, 'seat-cushion', '座椅坐墊', 'box', { width: .82, height: .2, depth: .78, position: [0, .04, 0], color: '#303b3b' });
  addDetail(seat, 'seat-back', '座椅靠背', 'box', { width: .2, height: .88, depth: .78, position: [-.28, .48, 0], rotation: [0, 0, -.12], color: '#263232' });
  addDetail(seat, 'seat-headrest', '頭枕', 'box', { width: .2, height: .24, depth: .42, position: [-.39, .98, 0], color: '#45514d' });

  const stick = addComponentNode('control-stick', '操縱桿', [.02, .02, 0], { channel: 'pitch', axis: 'z', min: -12 * radians, max: 12 * radians });
  config.components[config.components.length - 1].parent = interior;
  addDetail(stick, 'stick-base', '操縱桿底座', 'cylinder', { radius: .14, height: .1, position: [0, .02, 0], color: '#64716b' });
  addDetail(stick, 'stick-shaft', '操縱桿桿身', 'cylinder', { radius: .035, height: .48, position: [0, .27, 0], color: '#9aa49d' });
  addDetail(stick, 'stick-grip', '操縱桿握把', 'box', { width: .14, height: .16, depth: .12, position: [0, .53, 0], color: '#222b2b' });

  const throttle = addComponentNode('throttle-quadrant', '油門控制台', [.05, .04, .57]);
  config.components[config.components.length - 1].parent = interior;
  addDetail(throttle, 'throttle-base', '油門底座', 'box', { width: .72, height: .22, depth: .34, color: '#252f32' });
  addDetail(throttle, 'throttle-lever', '油門桿', 'cylinder', { radius: .035, height: .34, position: [0, .25, 0], rotation: [0, 0, -.2], color: '#aab4ad' });
  addDetail(throttle, 'throttle-grip', '油門握把', 'sphere', { radius: .085, position: [-.035, .42, 0], color: '#3e514a' });

  for (const [side, z] of [['left', -.69], ['right', .69]] as const) {
    const consoleId = addComponentNode(`${side}-console`, side === 'left' ? '左側控制台' : '右側控制台', [-.05, .08, z]);
    config.components[config.components.length - 1].parent = interior;
    addDetail(consoleId, `${side}-console-base`, '側邊控制台', 'box', { width: 1.6, height: .2, depth: .28, color: '#303b3e' });
    for (let i = 0; i < 4; i++) addDetail(consoleId, `${side}-switch-${i + 1}`, '實體開關', 'cylinder', {
      radius: .035, height: .1, radialSegments: 10, position: [-.48 + i * .3, .13, 0], color: '#a8b5ac',
    });
  }

  const canopy = addComponentNode('canopy', '座艙罩', [-.35, .55, 0], { channel: 'canopy', axis: 'z', min: 0, max: 48 * radians });
  config.components[config.components.length - 1].parent = interior;
  addDetail(canopy, 'canopy-glass', '座艙罩透明罩', 'sphere', {
    radius: 1, scale: [1.55, .68, .86], position: [.35, .12, 0], color: '#73b9c6',
    opacity: .14, metalness: .08, roughness: .12,
  });
  addDetail(canopy, 'canopy-frame', '座艙罩邊框', 'torus', {
    radius: .82, tube: .035, position: [.35, .1, 0], rotation: [Math.PI / 2, 0, 0], scale: [1.8, 1, 1], color: '#657b80',
  });

  saveHistory(); persist(); selectComponent(interior);
  notify('已建立座艙內飾：儀表、MFD、HUD、操縱桿、油門、座椅、側台與座艙罩');
};

const duplicateSelected = (mirror = false): void => {
  const source = selectedPart();
  if (!source) return;
  const copyPart = clone(source);
  copyPart.id = uniqueId(`${source.id}-copy`);
  copyPart.name = `${partLabel(source)} 複本`;
  if (copyPart.position) {
    copyPart.position[0] += mirror ? 0 : .35;
    copyPart.position[2] = mirror ? -copyPart.position[2] : copyPart.position[2] + .35;
  }
  if (mirror) {
    if (copyPart.plane === 'xz' && copyPart.vertices) copyPart.vertices = copyPart.vertices.map(([x, y]) => [x, -y]);
    else if (copyPart.plane === 'xy') copyPart.scale = [copyPart.scale?.[0] ?? 1, copyPart.scale?.[1] ?? 1, -(copyPart.scale?.[2] ?? 1)];
    else if (copyPart.rotation) copyPart.rotation[1] *= -1;
  }
  config.parts.push(copyPart);
  saveHistory();
  persist();
  selectPart(copyPart.id);
};
const deleteSelected = (): void => {
  if (selectedId) {
    config.parts = config.parts.filter((part) => part.id !== selectedId);
    saveHistory(); persist(); selectComponent(selectedComponentId);
    return;
  }
  if (!selectedComponentId) return;
  const component = config.components.find((item) => item.id === selectedComponentId);
  if (!component || !component.parent) { notify('飛機本體根組件不可刪除'); return; }
  const removeIds = new Set<string>([component.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const child of config.components) {
      if (child.parent && removeIds.has(child.parent) && !removeIds.has(child.id)) {
        removeIds.add(child.id); changed = true;
      }
    }
  }
  config.components = config.components.filter((item) => !removeIds.has(item.id));
  config.parts = config.parts.filter((part) => !removeIds.has(part.componentId));
  selectedComponentId = component.parent;
  selectedId = null;
  saveHistory(); persist(); selectComponent(selectedComponentId);
  notify('已刪除組件及其所有子組件與細節');
};
const loadConfig = (input: AircraftVisualInput, message: string): void => {
  const next = normalizeAircraftVisualConfig(input);
  const testModel = createModularAircraft(next);
  testModel.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material.dispose());
    else if (mesh.material) mesh.material.dispose();
  });
  config = clone(next);
  selectedId = null;
  selectedComponentId = config.components.find((component) => !component.parent)!.id;
  saveHistory(); persist();
  renderPartsList(); fillInspector(); renderModel();
  notify(message);
};

const jsonPanel = $('json-panel');
const jsonText = $('json-text') as HTMLTextAreaElement;
const openJsonPanel = (mode: 'import' | 'export'): void => {
  $('json-title').textContent = mode === 'import' ? '貼上模型 JSON' : '模型 JSON（可複製）';
  $('json-help').textContent = mode === 'import'
    ? '將完整模型 JSON 貼在下方，再按「載入文字」。載入成功後會取代目前模型。'
    : '以下是目前模型的完整資料。選取文字後複製即可，不會下載檔案。';
  jsonText.value = mode === 'export' ? JSON.stringify(config, null, 2) : '';
  ($('json-load') as HTMLButtonElement).hidden = mode !== 'import';
  ($('json-copy') as HTMLButtonElement).hidden = mode !== 'export';
  jsonPanel.hidden = false;
  jsonText.focus();
};
$('export').addEventListener('click', () => openJsonPanel('export'));
$('import').addEventListener('click', () => openJsonPanel('import'));
$('json-close').addEventListener('click', () => { jsonPanel.hidden = true; });
$('json-load').addEventListener('click', () => {
  try {
    loadConfig(JSON.parse(jsonText.value) as AircraftVisualInput, '模型文字載入成功');
    $('json-error').textContent = '';
    $('json-error').hidden = true;
    jsonPanel.hidden = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'JSON 格式錯誤';
    $('json-error').textContent = message;
    $('json-error').hidden = false;
    notify(message);
  }
});
$('json-copy').addEventListener('click', () => {
  jsonText.focus();
  jsonText.select();
  const copied = document.execCommand('copy');
  notify(copied ? 'JSON 已複製' : '請手動選取文字並複製');
});

document.querySelectorAll<HTMLButtonElement>('[data-add-detail]').forEach((button) => button.addEventListener('click', () => addPart(button.dataset.addDetail as AircraftPartShape)));
$('add-component').addEventListener('click', addComponent);
$('add-cannon').addEventListener('click', addCannonVisual);
$('add-cockpit').addEventListener('click', addCockpitInterior);

$('duplicate').addEventListener('click', () => duplicateSelected(false));
$('mirror').addEventListener('click', () => duplicateSelected(true));
$('delete').addEventListener('click', deleteSelected);
$('clear-model').addEventListener('click', () => {
  if (!config.parts.length && config.components.length <= 1) return;
  if (!window.confirm('確定清空目前模型的所有組件與細節？')) return;
  config.components = [{ id: 'aircraft-root', name: '飛機本體' }];
  config.parts = [];
  selectedComponentId = 'aircraft-root';
  selectedId = null;
  saveHistory();
  persist();
  selectPart(null);
});
$('load-viper').addEventListener('click', () => loadConfig(viperSample as AircraftVisualInput, '已載入 Viper T21 範例'));
$('undo').addEventListener('click', () => {
  if (historyIndex <= 0) return;
  historyIndex--;
  config = clone(history[historyIndex]);
  selectedId = config.parts.find((part) => part.id === selectedId)?.id ?? null;
  selectedComponentId = config.components.find((component) => component.id === selectedComponentId)?.id ?? config.components[0]?.id ?? 'aircraft-root';
  renderPartsList(); fillInspector(); renderModel(); persist(); updateHistoryButtons();
});
$('redo').addEventListener('click', () => {
  if (historyIndex >= history.length - 1) return;
  historyIndex++;
  config = clone(history[historyIndex]);
  selectedId = config.parts.find((part) => part.id === selectedId)?.id ?? null;
  selectedComponentId = config.components.find((component) => component.id === selectedComponentId)?.id ?? config.components[0]?.id ?? 'aircraft-root';
  renderPartsList(); fillInspector(); renderModel(); persist(); updateHistoryButtons();
});

inspector.addEventListener('input', (event) => {
  const target = event.target as HTMLElement;
  if (['part-name', 'part-id', 'part-vertices'].includes(target.id)) return;
  commitEdit();
});
inspector.addEventListener('change', () => {
  commitEdit();
  saveHistory();
});
$('part-name').addEventListener('change', () => { commitEdit(); saveHistory(); });
$('part-id').addEventListener('change', () => { commitEdit(); saveHistory(); });
$('part-shape').addEventListener('change', () => { commitEdit(); saveHistory(); });
$('part-metalness').addEventListener('input', () => $('metalness-value').textContent = readNumber('part-metalness', .68).toFixed(2));
$('part-roughness').addEventListener('input', () => $('roughness-value').textContent = readNumber('part-roughness', .32).toFixed(2));
$('part-opacity').addEventListener('input', () => $('opacity-value').textContent = readNumber('part-opacity', 1).toFixed(2));

const commitComponentEdit = (): void => {
  const component = config.components.find((item) => item.id === selectedComponentId);
  if (!component) return;
  const nextId = ($('component-id') as HTMLInputElement).value.trim();
  if (!nextId || (nextId !== component.id && (config.components.some((item) => item.id === nextId) || config.parts.some((part) => part.id === nextId)))) {
    notify('組件 ID 不可空白或重複'); setValue('component-id', component.id); return;
  }
  const oldId = component.id;
  component.id = nextId;
  if (oldId !== nextId) {
    for (const item of config.components) if (item.parent === oldId) item.parent = nextId;
    for (const part of config.parts) if (part.componentId === oldId) part.componentId = nextId;
    selectedComponentId = nextId;
  }
  component.name = ($('component-name') as HTMLInputElement).value.trim() || component.id;
  component.position = ['x','y','z'].map((axis) => readNumber(`component-pos-${axis}`, 0)) as [number,number,number];
  component.rotation = ['x','y','z'].map((axis) => readNumber(`component-rot-${axis}`, 0) * radians) as [number,number,number];
  const channel = ($('component-animation-channel') as HTMLSelectElement).value;
  if (channel) {
    component.animation = {
      channel: channel as NonNullable<AircraftVisualComponent['animation']>['channel'],
      axis: ($('component-animation-axis') as HTMLSelectElement).value as 'x' | 'y' | 'z',
      min: readNumber('component-animation-min', 0) * radians,
      max: readNumber('component-animation-max', 45) * radians,
    };
  } else {
    delete component.animation;
  }
  renderPartsList(); renderModel(); persist();
};
$('component-inspector').addEventListener('input', (event) => {
  if ((event.target as HTMLElement).id === 'component-name' || (event.target as HTMLElement).id === 'component-id') return;
  commitComponentEdit();
});
$('component-inspector').addEventListener('change', () => { commitComponentEdit(); saveHistory(); });
$('component-name').addEventListener('change', () => { commitComponentEdit(); saveHistory(); });
$('component-id').addEventListener('change', () => { commitComponentEdit(); saveHistory(); });
['component-animation-channel', 'component-animation-axis', 'component-animation-min', 'component-animation-max'].forEach((id) => {
  $(id).addEventListener('change', () => { commitComponentEdit(); saveHistory(); });
});

$('model-name-input').addEventListener('change', () => {
  config.name = ($('model-name-input') as HTMLInputElement).value.trim() || 'Untitled Aircraft';
  saveHistory();
  persist();
});
$('view-reset').addEventListener('click', () => { cameraYaw = .72; cameraPitch = .38; cameraDistance = 11; updateCamera(); });
const readAnimationSliders = (): void => {
  previewController?.setControls({
    pitch: readNumber('anim-pitch', 0), roll: readNumber('anim-roll', 0), yaw: readNumber('anim-yaw', 0),
    gear: readNumber('anim-gear', 0), flaps: readNumber('anim-flaps', 0), canopy: readNumber('anim-canopy', 0),
  });
};
['pitch', 'roll', 'yaw', 'gear', 'flaps', 'canopy'].forEach((channel) => {
  $(`anim-${channel}`).addEventListener('input', readAnimationSliders);
});
$('animation-reset').addEventListener('click', () => {
  ['pitch', 'roll', 'yaw', 'gear', 'flaps', 'canopy'].forEach((channel) => setValue(`anim-${channel}`, 0));
  previewController?.reset();
  readAnimationSliders();
});

$('toggle-grid').addEventListener('click', () => { grid.visible = !grid.visible; $('toggle-grid').classList.toggle('active', grid.visible); });
$('toggle-axes').addEventListener('click', () => { axes.visible = !axes.visible; $('toggle-axes').classList.toggle('active', axes.visible); });

canvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  dragDistance = 0;
  lastPointer = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const dx = event.clientX - lastPointer.x;
  const dy = event.clientY - lastPointer.y;
  dragDistance += Math.abs(dx) + Math.abs(dy);
  lastPointer = { x: event.clientX, y: event.clientY };
  if (dragDistance > 3) {
    cameraYaw -= dx * .008;
    cameraPitch = THREE.MathUtils.clamp(cameraPitch + dy * .006, -.1, 1.35);
    updateCamera();
  }
});
canvas.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  if (dragDistance < 6) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(modelRoot.children, true);
    let object: THREE.Object3D | null = hits[0]?.object ?? null;
    while (object && !object.userData.partId && !object.userData.componentId) object = object.parent;
    if (object?.userData.partId) selectPart(String(object.userData.partId));
    else if (object?.userData.componentId) selectComponent(String(object.userData.componentId));
  }
});
canvas.addEventListener('pointercancel', () => { dragging = false; });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  cameraDistance = THREE.MathUtils.clamp(cameraDistance * (event.deltaY > 0 ? 1.08 : .92), 4, 35);
  updateCamera();
}, { passive: false });

const resize = (): void => {
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};
new ResizeObserver(resize).observe(viewport);
window.addEventListener('resize', resize);
let previousFrame = performance.now();
const animate = (): void => {
  requestAnimationFrame(animate);
  const now = performance.now();
  previewController?.update(Math.min((now - previousFrame) / 1000, 0.1));
  previousFrame = now;
  renderer.render(scene, camera);
};
resize();
animate();

try {
  const stored = localStorage.getItem(STORAGE_KEY);
  config = stored
    ? normalizeAircraftVisualConfig(JSON.parse(stored) as AircraftVisualInput)
    : normalizeAircraftVisualConfig(viperSample as AircraftVisualInput);
} catch (error) {
  config = clone(defaultConfig());
  notify(error instanceof Error ? `本機模型載入失敗：${error.message}` : '本機模型載入失敗');
}
saveHistory();
selectedId = null;
selectedComponentId = config.components.find((component) => !component.parent)?.id ?? 'aircraft-root';
renderPartsList();
fillInspector();
renderModel();
