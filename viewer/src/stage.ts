import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createSkyMaterial } from './shaders';

export type Quality = 'high' | 'medium' | 'low';

interface Flight {
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toPos: THREE.Vector3;
  toTarget: THREE.Vector3;
  t: number;
  duration: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Renderer, camera, controls, post-processing and adaptive quality.
 * Quality steps down automatically when frames take too long (integrated GPUs, 4k screens).
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  quality: Quality = 'high';
  autoQuality = true;
  onResize: ((w: number, h: number) => void) | null = null;

  private flight: Flight | null = null;
  private frameTimes: number[] = [];
  private lastQualityChange = 0;
  private width = 1;
  private height = 1;
  private fixedSize: { w: number; h: number } | null = null;
  private onWindowResize = () => this.resize();

  constructor(readonly canvas: HTMLCanvasElement, radius: number) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor('#05060c');

    this.scene.fog = new THREE.FogExp2('#1c0f22', 1.0 / (radius * 3.2));

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, radius * 30);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 4;
    this.controls.maxDistance = radius * 6;
    this.controls.zoomSpeed = 1.2;
    this.controls.autoRotateSpeed = 0.25;
    this.controls.screenSpacePanning = false;

    const sky = new THREE.Mesh(new THREE.SphereGeometry(radius * 20, 32, 16), createSkyMaterial());
    sky.renderOrder = -1;
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.scene.add(this.stars(radius * 18));

    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.5, 0.55);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.home(radius);
    this.resize();
    window.addEventListener('resize', this.onWindowResize);
  }

  private stars(r: number): THREE.Points {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rnd() * Math.PI * 2;
      const v = 0.06 + rnd() * 0.94;
      const y = Math.pow(v, 0.7);
      const rr = Math.sqrt(1 - y * y);
      pos.set([Math.cos(u) * rr * r, y * r, Math.sin(u) * rr * r], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: '#c9d2ff', size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.55, fog: false, depthWrite: false });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  /** Default aerial three-quarter view. */
  home(radius: number, aspect = this.width / this.height): void {
    const dist = radius * (aspect < 1 ? 2.6 : 1.65);
    this.controls.target.set(0, radius * 0.04, 0);
    this.camera.position.set(dist * 0.62, dist * 0.55, dist * 0.78);
    this.controls.update();
  }

  homePose(radius: number, aspect: number): { pos: THREE.Vector3; target: THREE.Vector3 } {
    const dist = radius * (aspect < 1 ? 2.6 : 1.65);
    return { pos: new THREE.Vector3(dist * 0.62, dist * 0.55, dist * 0.78), target: new THREE.Vector3(0, radius * 0.04, 0) };
  }

  flyTo(target: THREE.Vector3, distance: number, duration = 1.4): void {
    const dir = this.camera.position.clone().sub(this.controls.target);
    dir.y = Math.max(dir.y, dir.length() * 0.45);
    dir.normalize();
    this.flight = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: target.clone().addScaledVector(dir, distance),
      toTarget: target.clone(),
      t: 0,
      duration,
    };
  }

  flyToPose(pose: { pos: THREE.Vector3; target: THREE.Vector3 }, duration = 1.4): void {
    this.flight = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: pose.pos.clone(),
      toTarget: pose.target.clone(),
      t: 0,
      duration,
    };
  }

  dispose(): void {
    window.removeEventListener('resize', this.onWindowResize);
    this.controls.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }

  get flying(): boolean {
    return this.flight !== null;
  }

  resize(): void {
    const w = this.fixedSize?.w ?? this.canvas.clientWidth ?? window.innerWidth;
    const h = this.fixedSize?.h ?? this.canvas.clientHeight ?? window.innerHeight;
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    const dprCap = this.fixedSize ? 1 : this.quality === 'high' ? 1.5 : this.quality === 'medium' ? 1 : 0.75;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(this.width, this.height);
    // Bloom at reduced resolution: it is blurry anyway and this is the most expensive pass.
    this.bloom.resolution.set((this.width * dpr) / 2, (this.height * dpr) / 2);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.onResize?.(this.width * dpr, this.height * dpr);
  }

  /** Render at an exact pixel size (exports). Pass null to go back to the window size. */
  setFixedSize(size: { w: number; h: number } | null): void {
    this.fixedSize = size;
    this.resize();
  }

  get size(): { w: number; h: number } {
    return { w: this.width, h: this.height };
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.bloom.enabled = q !== 'low';
    this.resize();
  }

  /** Call once per frame with the frame's duration (ms). */
  trackFrame(ms: number, now: number): void {
    if (!this.autoQuality || this.fixedSize) return;
    this.frameTimes.push(ms);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.frameTimes.length < 90 || now - this.lastQualityChange < 3000) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const median = sorted[45];
    if (median > 21 && this.quality !== 'low') {
      this.setQuality(this.quality === 'high' ? 'medium' : 'low');
      this.lastQualityChange = now;
      this.frameTimes.length = 0;
    }
  }

  update(dt: number): void {
    const f = this.flight;
    if (f) {
      f.t = Math.min(1, f.t + dt / f.duration);
      const e = ease(f.t);
      this.camera.position.lerpVectors(f.fromPos, f.toPos, e);
      // Arc up a little mid-flight for a nicer swoop.
      this.camera.position.y += Math.sin(e * Math.PI) * f.fromPos.distanceTo(f.toPos) * 0.12;
      this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
      if (f.t >= 1) this.flight = null;
    }
    this.controls.update();
  }

  render(): void {
    // Disabled passes (bloom on low quality) are skipped by the composer.
    this.composer.render();
  }
}
