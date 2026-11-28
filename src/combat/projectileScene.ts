import * as THREE from 'three';
import type { CameraState } from '../rendering/Renderer';
import { getMissileDefinition } from './missileCatalog';
import type { CombatBullet, CombatImpact, CombatMissile } from './simulation';

interface ImpactVisualProfile {
  rings: number;
  rays: number;
  particles: number;
  flattened?: boolean;
  arc?: boolean;
  beam?: boolean;
}

interface MissileVisual {
  body: THREE.Group;
  trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

interface BulletVisual {
  body: THREE.Group;
  tracer: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
}

interface ImpactVisual {
  root: THREE.Group;
  shell: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  rings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[];
  rays: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> | null;
}

const IMPACT_PROFILES: Record<string, ImpactVisualProfile> = {
  'PULSE BURST': { rings: 2, rays: 8, particles: 12 },
  'COMET TRAIL': { rings: 1, rays: 5, particles: 18 },
  'EMBER ARC': { rings: 3, rays: 10, particles: 24, arc: true },
  'TIDAL RING': { rings: 2, rays: 0, particles: 12, flattened: true },
  'SPARK DART': { rings: 0, rays: 12, particles: 10 },
  'STATIC WAVE': { rings: 3, rays: 0, particles: 18 },
  'SKY LANCE': { rings: 1, rays: 6, particles: 10, beam: true },
  'FROST TRACE': { rings: 2, rays: 6, particles: 20 },
  'IMPACT HALO': { rings: 2, rays: 4, particles: 16, flattened: true },
  'PHOENIX WAKE': { rings: 1, rays: 16, particles: 32 },
  'CANNON BURST': { rings: 0, rays: 8, particles: 8 },
  'AIRCRAFT EXPLOSION': { rings: 2, rays: 12, particles: 28 },
};

const MISSILE_BODY = new THREE.CylinderGeometry(0.7, 1, 0.62, 8);
const MISSILE_NOSE = new THREE.ConeGeometry(0.7, 0.55, 8);
const MISSILE_FIN = new THREE.BoxGeometry(1.05, 0.08, 0.42);
const BULLET_BODY = new THREE.CylinderGeometry(0.045, 0.065, 0.48, 6);
const BULLET_CORE = new THREE.SphereGeometry(0.07, 8, 6);
const IMPACT_SHELL = new THREE.SphereGeometry(1, 16, 12);
const UNIT_Z = new THREE.Vector3(0, 0, 1);

function colorValue(color: string): THREE.Color {
  return new THREE.Color(color);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) material.forEach((item) => item.dispose());
  else material.dispose();
}

export class CombatProjectileScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.08, 100_000);
  private readonly canvas: HTMLCanvasElement;
  private readonly missiles = new Map<number, MissileVisual>();
  private readonly bullets = new Map<number, BulletVisual>();
  private readonly impacts = new Map<CombatImpact, ImpactVisual>();
  private width = 1;
  private height = 1;

  constructor(host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '3',
      display: 'none',
    });
    host.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: false,
      powerPreference: 'low-power',
      premultipliedAlpha: false,
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2);
    keyLight.position.set(-1, 2, 1);
    this.scene.add(keyLight);
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('beforeunload', this.dispose, { once: true });
  }

  render(
    camera: CameraState | null,
    missiles: readonly CombatMissile[],
    bullets: readonly CombatBullet[],
    impacts: readonly CombatImpact[],
    visible: boolean,
  ): void {
    this.canvas.style.display = visible ? 'block' : 'none';
    this.syncMissiles(missiles);
    this.syncBullets(bullets);
    this.syncImpacts(impacts);
    if (!visible || !camera) return;

    this.camera.position.set(...camera.position);
    this.camera.up.set(...camera.up);
    this.camera.lookAt(
      camera.position[0] + camera.forward[0],
      camera.position[1] + camera.forward[1],
      camera.position[2] + camera.forward[2],
    );
    this.camera.fov = THREE.MathUtils.radToDeg(camera.fovY);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    for (const missile of missiles) this.updateMissile(missile, this.missiles.get(missile.id)!);
    for (const bullet of bullets) this.updateBullet(bullet, this.bullets.get(bullet.id)!);
    for (const impact of impacts) this.updateImpact(impact, this.impacts.get(impact)!);
    this.renderer.render(this.scene, this.camera);
  }

  dispose = (): void => {
    window.removeEventListener('resize', this.resize);
    for (const visual of this.missiles.values()) this.removeMissile(visual);
    for (const visual of this.bullets.values()) this.removeBullet(visual);
    for (const visual of this.impacts.values()) this.removeImpact(visual);
    this.missiles.clear();
    this.bullets.clear();
    this.impacts.clear();
    this.renderer.dispose();
    this.canvas.remove();
  };

  private syncMissiles(missiles: readonly CombatMissile[]): void {
    const active = new Set(missiles.map((missile) => missile.id));
    for (const [id, visual] of this.missiles) {
      if (active.has(id)) continue;
      this.removeMissile(visual);
      this.missiles.delete(id);
    }
    for (const missile of missiles) {
      if (!this.missiles.has(missile.id)) this.missiles.set(missile.id, this.createMissile(missile));
    }
  }

  private syncBullets(bullets: readonly CombatBullet[]): void {
    const active = new Set(bullets.map((bullet) => bullet.id));
    for (const [id, visual] of this.bullets) {
      if (active.has(id)) continue;
      this.removeBullet(visual);
      this.bullets.delete(id);
    }
    for (const bullet of bullets) {
      if (!this.bullets.has(bullet.id)) this.bullets.set(bullet.id, this.createBullet());
    }
  }

  private syncImpacts(impacts: readonly CombatImpact[]): void {
    const active = new Set(impacts);
    for (const [impact, visual] of this.impacts) {
      if (active.has(impact)) continue;
      this.removeImpact(visual);
      this.impacts.delete(impact);
    }
    for (const impact of impacts) {
      if (!this.impacts.has(impact)) this.impacts.set(impact, this.createImpact(impact));
    }
  }

  private createMissile(missile: CombatMissile): MissileVisual {
    const profile = getMissileDefinition(missile.equipmentId).model;
    const root = new THREE.Group();
    const color = colorValue(missile.color);
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xd8e2e8,
      metalness: 0.72,
      roughness: 0.28,
      emissive: color,
      emissiveIntensity: 0.22,
    });
    const accentMaterial = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.35,
      roughness: 0.35,
      emissive: color,
      emissiveIntensity: 0.8,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x20262c, metalness: 0.55, roughness: 0.45 });
    const unitScale = profile.radius;
    const body = new THREE.Mesh(MISSILE_BODY, bodyMaterial);
    body.rotation.x = Math.PI / 2;
    body.scale.set(unitScale, profile.length / 0.62, unitScale);
    root.add(body);

    const nose = new THREE.Mesh(MISSILE_NOSE, accentMaterial);
    nose.rotation.x = Math.PI / 2;
    nose.position.z = profile.length * 0.52;
    nose.scale.set(unitScale, 0.5, unitScale);
    root.add(nose);

    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.2, 8), darkMaterial);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.z = -profile.length * 0.48;
    nozzle.scale.set(unitScale, 0.6, unitScale);
    root.add(nozzle);

    for (let i = 0; i < profile.fins; i++) {
      const fin = new THREE.Mesh(MISSILE_FIN, accentMaterial);
      fin.position.set(unitScale * 0.65, 0, -profile.length * 0.34);
      fin.scale.set(unitScale, unitScale * 0.2, profile.length * 0.12);
      fin.rotation.z = (Math.PI * 2 * i) / profile.fins;
      root.add(fin);
    }

    const trailMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: missile.effect === 'COMET TRAIL' || missile.effect === 'PHOENIX WAKE' ? 0.8 : 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const trail = new THREE.Line(new THREE.BufferGeometry(), trailMaterial);
    trail.frustumCulled = false;
    this.scene.add(root, trail);
    return { body: root, trail };
  }

  private createBullet(): BulletVisual {
    const root = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: 0xffe7a3,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const body = new THREE.Mesh(BULLET_BODY, material);
    body.rotation.x = Math.PI / 2;
    root.add(body);
    const core = new THREE.Mesh(BULLET_CORE, material);
    core.position.z = 0.2;
    root.add(core);
    const tracer = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: 0xffd17e,
        transparent: true,
        opacity: 0.56,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    tracer.frustumCulled = false;
    this.scene.add(root, tracer);
    return { body: root, tracer };
  }

  private createImpact(impact: CombatImpact): ImpactVisual {
    const profile = IMPACT_PROFILES[impact.effect] ?? IMPACT_PROFILES['AIRCRAFT EXPLOSION'];
    const color = colorValue(impact.color);
    const root = new THREE.Group();
    const shellMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const shell = new THREE.Mesh(IMPACT_SHELL, shellMaterial);
    root.add(shell);

    const rings: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>[] = [];
    for (let i = 0; i < profile.rings; i++) {
      const geometry = new THREE.TorusGeometry(1, 0.035, 6, 40, profile.arc ? Math.PI * 1.45 : Math.PI * 2);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const ring = new THREE.Mesh(geometry, material);
      if (profile.flattened) ring.rotation.x = Math.PI / 2;
      else ring.rotation.set(i * 0.71, i * 0.93, i * 0.38);
      rings.push(ring);
      root.add(ring);
    }

    const rayPositions: THREE.Vector3[] = [];
    for (let i = 0; i < profile.rays; i++) {
      const angle = (i / profile.rays) * Math.PI * 2;
      const elevation = Math.sin(i * 2.399) * 0.72;
      const planar = Math.sqrt(1 - elevation * elevation);
      rayPositions.push(
        new THREE.Vector3(Math.cos(angle) * planar * 0.22, elevation * 0.22, Math.sin(angle) * planar * 0.22),
        new THREE.Vector3(Math.cos(angle) * planar, elevation, Math.sin(angle) * planar),
      );
    }
    const rayMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const rays = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rayPositions), rayMaterial);
    root.add(rays);

    const particlePositions: THREE.Vector3[] = [];
    for (let i = 0; i < profile.particles; i++) {
      const y = 1 - (i / Math.max(1, profile.particles - 1)) * 2;
      const planar = Math.sqrt(1 - y * y);
      const angle = i * 2.399963229728653;
      particlePositions.push(new THREE.Vector3(Math.cos(angle) * planar, y, Math.sin(angle) * planar));
    }
    const particleMaterial = new THREE.PointsMaterial({
      color,
      size: 2.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const particles = new THREE.Points(new THREE.BufferGeometry().setFromPoints(particlePositions), particleMaterial);
    root.add(particles);

    let beam: ImpactVisual['beam'] = null;
    if (profile.beam) {
      const beamMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      beam = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.5, 1, 8), beamMaterial);
      root.add(beam);
    }

    this.scene.add(root);
    return { root, shell, rings, rays, particles, beam };
  }

  private updateMissile(missile: CombatMissile, visual: MissileVisual): void {
    visual.body.position.set(...missile.position);
    const direction = new THREE.Vector3(...missile.velocity).normalize();
    visual.body.quaternion.setFromUnitVectors(UNIT_Z, direction.lengthSq() > 0 ? direction : UNIT_Z);
    visual.trail.geometry.setFromPoints(missile.trail.map((point) => new THREE.Vector3(...point)));
    visual.trail.visible = missile.trail.length > 1;
  }

  private updateBullet(bullet: CombatBullet, visual: BulletVisual): void {
    visual.body.position.set(...bullet.position);
    const direction = new THREE.Vector3(...bullet.velocity).normalize();
    visual.body.quaternion.setFromUnitVectors(UNIT_Z, direction.lengthSq() > 0 ? direction : UNIT_Z);
    visual.tracer.geometry.setFromPoints([
      new THREE.Vector3(...bullet.previousPosition),
      new THREE.Vector3(...bullet.position),
    ]);
  }

  private updateImpact(impact: CombatImpact, visual: ImpactVisual): void {
    const progress = THREE.MathUtils.clamp(impact.age / impact.life, 0, 1);
    const expansion = 0.12 + progress * 1.25;
    const fade = (1 - progress) ** 1.25;
    const radius = impact.radius;
    visual.root.position.set(...impact.position);

    visual.shell.scale.setScalar(radius * expansion);
    visual.shell.material.opacity = fade * 0.72;
    visual.rings.forEach((ring, i) => {
      const ringScale = radius * (0.22 + progress * (1.05 + i * 0.28));
      ring.scale.setScalar(ringScale);
      ring.rotation.y += 0.012 * (i + 1);
      ring.material.opacity = fade * 0.9;
    });
    visual.rays.scale.setScalar(radius * (0.18 + progress * 1.25));
    visual.rays.material.opacity = fade;
    visual.particles.scale.setScalar(radius * (0.25 + progress * 2.1));
    visual.particles.material.opacity = fade;
    if (visual.beam) {
      const height = radius * (0.4 + (1 - progress) * 1.8);
      visual.beam.scale.set(radius * 0.18, height, radius * 0.18);
      visual.beam.position.y = height * 0.5;
      visual.beam.material.opacity = fade * 0.78;
    }
  }

  private removeMissile(visual: MissileVisual): void {
    this.scene.remove(visual.body, visual.trail);
    visual.body.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      disposeMaterial(object.material);
      if (object.geometry !== MISSILE_BODY && object.geometry !== MISSILE_NOSE && object.geometry !== MISSILE_FIN) {
        object.geometry.dispose();
      }
    });
    visual.trail.geometry.dispose();
    visual.trail.material.dispose();
  }

  private removeBullet(visual: BulletVisual): void {
    this.scene.remove(visual.body, visual.tracer);
    visual.body.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      disposeMaterial(object.material);
    });
    visual.tracer.geometry.dispose();
    visual.tracer.material.dispose();
  }

  private removeImpact(visual: ImpactVisual): void {
    this.scene.remove(visual.root);
    visual.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points) && !(object instanceof THREE.LineSegments)) return;
      disposeMaterial(object.material);
      if (object.geometry !== IMPACT_SHELL) object.geometry.dispose();
    });
  }

  private resize = (): void => {
    this.width = Math.max(1, Math.round(window.innerWidth));
    this.height = Math.max(1, Math.round(window.innerHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setSize(Math.round(this.width * dpr), Math.round(this.height * dpr), false);
  };
}
