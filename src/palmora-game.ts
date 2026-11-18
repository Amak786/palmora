/**
 * PALMORA: The Living Silence
 * "A world without a voice. Two hands to bring it back."
 *
 * A seated, hands-only VR experience. A dark miniature world floats in front
 * of the player: two dormant islands and a sleeping Heart. Three stages:
 *
 *  1. Palm of Attraction: open a palm and luminous seeds drift into it.
 *     Lower the palm onto the first island to plant them. Three seeds
 *     make it bloom.
 *  2. The Living Bridge: hold one open palm over each island. An energy
 *     bridge forms between your hands and a wisp crosses it, waking the
 *     second island.
 *  3. Pinch to Weave: pinch two broken energy crystals and set each into
 *     its glowing socket to repair the paths to the Heart.
 *  4. Two-Hand Resonance: cradle the Heart between both open palms. Ripples
 *     build. The closer your hands, the faster. The Heart awakens.
 *
 * Living Echo: every seed you gather becomes a wisp that circles the Heart
 * at the end, and each stage adds a layer to the music.
 *
 * All input comes from real hand tracking (see hands.ts). A small, clearly
 * labelled simulator for automated testing is exposed only with ?debug in
 * the page URL.
 */

import {
  createSystem,
  DomeGradient,
  Entity,
  PokeInteractable,
  Pressed,
  RayInteractable,
} from '@iwsdk/core';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  OctahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  QuadraticBezierCurve3,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { chord, setMusicLayers, tone } from './audio.js';
import { HandReader, HandState } from './hands.js';
import { ReplayButton } from './palmora-components.js';

// ---------- layout (metres; player at origin facing -Z, seated) ----------
const ISLAND_A = new Vector3(-0.2, 0.96, -0.42);
const ISLAND_B = new Vector3(0.2, 0.96, -0.42);
const HEART = new Vector3(0, 1.1, -0.5);
const ISLAND_RADIUS = 0.085;

// ---------- tuning ----------
const SEED_COUNT = 9;
const SEEDS_NEEDED = 3;
const ATTRACT_RADIUS = 0.3;
const CATCH_RADIUS = 0.06;
const DEPOSIT_REACH = ISLAND_RADIUS + 0.04;
const DEPOSIT_HEIGHT = 0.13; // palm within this height above an island top
const SEED_RESPAWN = 5;
const BRIDGE_MIN = 0.15;
const BRIDGE_MAX = 0.8;
const BRIDGE_ANCHOR = 0.13; // palm this close to an island anchors the bridge
const WISP_CROSS_TIME = 2.6;
const CRADLE_REACH = 0.19;
const RESONANCE_TIME = 3.2;
const BRIDGE_BEADS = 28;
const NODE_GRAB_RADIUS = 0.06; // pinch this close to a crystal to take it
const SOCKET_SNAP = 0.05; // release this close to the socket to lock it in

type Stage = 'seeds' | 'bridge' | 'weave' | 'resonance' | 'complete';
type Side = 'left' | 'right';

const SEED_FLOAT = 0;
const SEED_DRAWN = 1;
const SEED_HELD = 2;
const SEED_SINKING = 3;
const SEED_GONE = 4;

interface Seed {
  mesh: Mesh;
  mat: MeshStandardMaterial;
  home: Vector3;
  state: number;
  side: Side;
  angle: number;
  timer: number;
}

interface Island {
  center: Vector3;
  root: Group;
  rock: MeshStandardMaterial;
  ring: MeshBasicMaterial;
  spires: Mesh[];
  tint: Color;
  bloom: number; // 0 dormant .. 1 restored (animated)
  restored: boolean;
  seeds: number;
}

interface EnergyNode {
  mesh: Mesh;
  mat: MeshStandardMaterial;
  start: Vector3;
  socket: Vector3;
  socketMesh: Mesh;
  socketMat: MeshBasicMaterial;
  locked: boolean;
  heldBy: Side | null;
}

interface Ripple {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  age: number;
}

interface Panel {
  mesh: Mesh;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
}

function makePanel(width: number, height: number, pos: Vector3): Panel {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round(512 * (height / width));
  const ctx = canvas.getContext('2d')!;
  const tex = new CanvasTexture(canvas);
  const mesh = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.position.copy(pos);
  return { mesh, canvas, ctx, tex };
}

/** Simulated hand input, for automated tests only. */
export interface SimHand {
  tracked: boolean;
  open: boolean;
  pinch?: boolean;
  palm: [number, number, number]; // also used as the pinch point
}

export class PalmoraSystem extends createSystem({
  replayPressed: { required: [ReplayButton, Pressed] },
  domes: { required: [DomeGradient] },
}) {
  private hands = new HandReader();
  private sim: { left: SimHand; right: SimHand } | null = null;
  private stage: Stage = 'seeds';
  private clock = 0;
  private stageClock = 0;
  private elapsed = 0;
  private seedsGathered = 0;
  private depositCooldown = 0;
  private noHandsTime = 0;

  private seeds: Seed[] = [];
  private islands!: [Island, Island];
  private heart!: Group;
  private heartCore!: MeshStandardMaterial;
  private heartShell!: MeshStandardMaterial;
  private resonance = 0;
  private rippleTimer = 0;
  private ripples: Ripple[] = [];
  private rippleGeo = new TorusGeometry(0.06, 0.0025, 6, 48);

  private bridge!: InstancedMesh;
  private bridgeMat!: MeshBasicMaterial;
  private bridgeCurve = new QuadraticBezierCurve3(new Vector3(), new Vector3(), new Vector3());
  private wisp!: Mesh;
  private wispT = 0;
  private wispActive = false;

  private nodes: EnergyNode[] = [];
  private spark!: Mesh;
  private echoWisps: Mesh[] = [];
  private threads: Mesh[] = [];
  private palmGlow!: { left: Mesh; right: Mesh };
  private hint!: Panel;
  private hintText = '';
  private hintSub = '';
  private replay!: Entity;
  private replayMesh!: Mesh;
  private dust!: Points;

  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private dummy = new Object3D();

  init(): void {
    this.scene.background = new Color(0x06051a);
    // The default sky is a pale gradient; turn it into a deep indigo void.
    this.queries.domes.subscribe('qualify', (e: Entity) => this.darkenDome(e));
    for (const e of this.queries.domes.entities) this.darkenDome(e);
    this.buildSky();
    this.islands = [
      this.buildIsland(ISLAND_A, new Color(0x3ff2d6)),
      this.buildIsland(ISLAND_B, new Color(0xb47cff)),
    ];
    this.buildHeart();
    this.buildSeeds();
    this.buildBridge();
    this.buildNodes();
    this.buildPalmGlows();

    this.hint = makePanel(0.42, 0.11, new Vector3(0, 1.3, -0.72));
    this.world.createTransformEntity(this.hint.mesh);

    // Replay crystal, placed before it is registered so pokes reach it.
    this.replayMesh = new Mesh(
      new IcosahedronGeometry(0.03, 0),
      new MeshStandardMaterial({ color: 0xffd36b, emissive: new Color(0xffb02e), emissiveIntensity: 1.2, flatShading: true }),
    );
    this.replayMesh.position.set(0, 0.9, -0.3);
    this.replay = this.world.createTransformEntity(this.replayMesh);
    this.replay.addComponent(ReplayButton);
    this.replay.addComponent(RayInteractable);
    this.replay.addComponent(PokeInteractable);

    this.queries.replayPressed.subscribe('qualify', () => {
      if (this.stage === 'complete') this.restart();
    });

    if (typeof location !== 'undefined' && location.search.includes('debug')) {
      (window as unknown as Record<string, unknown>).__palmora = {
        system: this,
        /** SIMULATOR ONLY: drive hands from tests. Not real hand tracking. */
        sim: (left: SimHand, right: SimHand) => {
          this.sim = { left, right };
        },
        stopSim: () => {
          this.sim = null;
        },
      };
    }

    this.restart();
  }

  // ======================= building the world =======================

  private darkenDome(e: Entity): void {
    e.getVectorView(DomeGradient, 'sky').set([0.02, 0.015, 0.07, 1]);
    e.getVectorView(DomeGradient, 'equator').set([0.07, 0.035, 0.16, 1]);
    e.getVectorView(DomeGradient, 'ground').set([0.008, 0.006, 0.025, 1]);
  }

  private buildSky(): void {
    const count = 500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 6 + Math.random() * 6;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    const stars = new Points(geo, new PointsMaterial({ color: 0xcfd8ff, size: 0.04, sizeAttenuation: true }));
    this.world.createTransformEntity(stars);

    // Floating dust motes around the miniature world.
    const dustCount = 90;
    const dustPos = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = (Math.random() - 0.5) * 1.2;
      dustPos[i * 3 + 1] = (Math.random() - 0.5) * 0.6;
      dustPos[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
    }
    const dustGeo = new BufferGeometry();
    dustGeo.setAttribute('position', new BufferAttribute(dustPos, 3));
    this.dust = new Points(
      dustGeo,
      new PointsMaterial({ color: 0x8fe9ff, size: 0.006, transparent: true, opacity: 0.6, blending: AdditiveBlending, depthWrite: false }),
    );
    this.dust.position.set(0, 1.05, -0.45);
    this.world.createTransformEntity(this.dust);
  }

  private buildIsland(center: Vector3, tint: Color): Island {
    const root = new Group();
    root.position.copy(center);

    const rock = new MeshStandardMaterial({ color: 0x4a4678, roughness: 0.85, flatShading: true, emissive: new Color(0x000000) });
    const top = new Mesh(new CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS * 0.75, 0.03, 7), rock);
    const under = new Mesh(new ConeGeometry(ISLAND_RADIUS * 0.75, 0.09, 7), rock);
    under.rotation.x = Math.PI;
    under.position.y = -0.06;
    root.add(top, under);

    const ring = new MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.15, blending: AdditiveBlending, depthWrite: false });
    const halo = new Mesh(new TorusGeometry(ISLAND_RADIUS + 0.012, 0.003, 6, 40), ring);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.017;
    root.add(halo);

    const spireMat = new MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.9, flatShading: true });
    const spires: Mesh[] = [];
    for (let i = 0; i < 7; i++) {
      const h = 0.03 + Math.random() * 0.045;
      const spire = new Mesh(new ConeGeometry(0.006 + Math.random() * 0.004, h, 5), spireMat);
      const a = (i / 7) * Math.PI * 2 + Math.random() * 0.4;
      const r = 0.02 + Math.random() * 0.05;
      spire.position.set(Math.cos(a) * r, 0.015 + h / 2, Math.sin(a) * r);
      spire.scale.setScalar(0.001);
      root.add(spire);
      spires.push(spire);
    }

    this.world.createTransformEntity(root);
    return { center: center.clone(), root, rock, ring, spires, tint, bloom: 0, restored: false, seeds: 0 };
  }

  private buildHeart(): void {
    this.heart = new Group();
    this.heart.position.copy(HEART);
    this.heartShell = new MeshStandardMaterial({
      color: 0x2a2350,
      emissive: new Color(0x6a3cff),
      emissiveIntensity: 0.15,
      flatShading: true,
      transparent: true,
      opacity: 0.85,
    });
    const shell = new Mesh(new IcosahedronGeometry(0.045, 0), this.heartShell);
    this.heartCore = new MeshStandardMaterial({ color: 0xffd36b, emissive: new Color(0xffb02e), emissiveIntensity: 0.1 });
    const core = new Mesh(new SphereGeometry(0.018, 16, 12), this.heartCore);
    this.heart.add(shell, core);
    this.world.createTransformEntity(this.heart);

    // Light threads that appear when the world reconnects.
    const threadMat = new MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false });
    for (const island of [ISLAND_A, ISLAND_B]) {
      const length = island.distanceTo(HEART);
      const thread = new Mesh(new CylinderGeometry(0.0025, 0.0025, length, 6), threadMat.clone());
      thread.position.copy(island).add(HEART).multiplyScalar(0.5);
      thread.lookAt(HEART);
      thread.rotateX(Math.PI / 2);
      this.world.createTransformEntity(thread);
      this.threads.push(thread);
    }
  }

  private buildSeeds(): void {
    const geo = new SphereGeometry(0.012, 14, 10);
    for (let i = 0; i < SEED_COUNT; i++) {
      const angle = (i / SEED_COUNT) * Math.PI * 2;
      const home = new Vector3(
        Math.cos(angle) * 0.3,
        1.02 + (i % 3) * 0.06,
        -0.4 + Math.sin(angle) * 0.14,
      );
      const gold = i % 2 === 0;
      const mat = new MeshStandardMaterial({
        color: gold ? 0xffd36b : 0x7ff7e8,
        emissive: new Color(gold ? 0xffa21f : 0x22e3cf),
        emissiveIntensity: 1,
      });
      const mesh = new Mesh(geo, mat);
      mesh.position.copy(home);
      this.world.createTransformEntity(mesh);
      this.seeds.push({ mesh, mat, home, state: SEED_FLOAT, side: 'left', angle, timer: 0 });
    }
  }

  private buildBridge(): void {
    this.bridgeMat = new MeshBasicMaterial({ color: 0x7fe7ff, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
    this.bridge = new InstancedMesh(new SphereGeometry(0.006, 8, 6), this.bridgeMat, BRIDGE_BEADS);
    this.bridge.frustumCulled = false;
    this.bridge.visible = false;
    this.world.createTransformEntity(this.bridge);

    this.wisp = new Mesh(
      new SphereGeometry(0.014, 16, 12),
      new MeshStandardMaterial({ color: 0xffffff, emissive: new Color(0x9ffcff), emissiveIntensity: 2 }),
    );
    this.wisp.visible = false;
    this.world.createTransformEntity(this.wisp);
  }

  private buildNodes(): void {
    const geo = new OctahedronGeometry(0.02, 0);
    const socketGeo = new TorusGeometry(0.026, 0.003, 6, 32);
    const offsets = [new Vector3(-0.1, -0.05, 0.12), new Vector3(0.1, -0.05, 0.12)];
    [ISLAND_A, ISLAND_B].forEach((island, i) => {
      const socket = island.clone().setY(island.y + 0.03).add(HEART).multiplyScalar(0.5);
      const socketMat = new MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false });
      const socketMesh = new Mesh(socketGeo, socketMat);
      socketMesh.position.copy(socket);
      socketMesh.visible = false;
      this.world.createTransformEntity(socketMesh);

      const mat = new MeshStandardMaterial({ color: 0xffe2a0, emissive: new Color(0xff9a2e), emissiveIntensity: 0.8, flatShading: true });
      const mesh = new Mesh(geo, mat);
      const start = socket.clone().add(offsets[i]);
      mesh.position.copy(start);
      mesh.visible = false;
      this.world.createTransformEntity(mesh);
      this.nodes.push({ mesh, mat, start, socket, socketMesh, socketMat, locked: false, heldBy: null });
    });

    // Small contact spark shown at the pinch point while holding a crystal.
    this.spark = new Mesh(
      new SphereGeometry(0.008, 10, 8),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false }),
    );
    this.spark.visible = false;
    this.world.createTransformEntity(this.spark);
  }

  private buildPalmGlows(): void {
    const geo = new SphereGeometry(0.035, 16, 12);
    const make = (): Mesh => {
      const mesh = new Mesh(
        geo,
        new MeshBasicMaterial({ color: 0x7fe7ff, transparent: true, opacity: 0.22, blending: AdditiveBlending, depthWrite: false }),
      );
      mesh.visible = false;
      this.world.createTransformEntity(mesh);
      return mesh;
    };
    this.palmGlow = { left: make(), right: make() };
  }

  // ======================= game flow =======================

  private restart(): void {
    this.stage = 'seeds';
    this.stageClock = 0;
    this.elapsed = 0;
    this.seedsGathered = 0;
    this.resonance = 0;
    this.wispActive = false;
    this.wisp.visible = false;
    for (const island of this.islands) {
      island.bloom = 0;
      island.restored = false;
      island.seeds = 0;
    }
    for (const seed of this.seeds) {
      seed.state = SEED_FLOAT;
      seed.mesh.visible = true;
      seed.mesh.position.copy(seed.home);
    }
    for (const w of this.echoWisps) w.visible = false;
    for (const n of this.nodes) {
      n.locked = false;
      n.heldBy = null;
      n.mesh.position.copy(n.start);
      n.mesh.visible = false;
      n.socketMesh.visible = false;
    }
    this.spark.visible = false;
    for (const r of this.ripples) r.mesh.visible = false;
    this.replayMesh.visible = false;
    setMusicLayers(1);
    this.setHint('Open your palm toward the light', 'Seeds 0/3');
  }

  private enterStage(stage: Stage): void {
    this.stage = stage;
    this.stageClock = 0;
    if (stage === 'bridge') {
      this.wispActive = true;
      this.wispT = 0;
      this.wisp.visible = true;
      this.setHint('Hold one open palm over each island', 'Build a bridge for the wisp');
    } else if (stage === 'weave') {
      for (const n of this.nodes) {
        n.mesh.visible = true;
        n.socketMesh.visible = true;
      }
      this.setHint('Pinch a broken crystal', 'Set each one into its glowing socket');
    } else if (stage === 'resonance') {
      this.setHint('Cradle the Heart with both hands', 'Closer hands resonate faster');
    } else if (stage === 'complete') {
      this.setHint('The world remembers you', this.timeText());
      this.replayMesh.visible = true;
      this.spawnEcho();
      chord(220, [1, 1.25, 1.5, 2, 2.5, 3]);
      setMusicLayers(4);
    }
  }

  private bloom(island: Island): void {
    island.restored = true;
    chord(island === this.islands[0] ? 330 : 415);
    setMusicLayers(island === this.islands[0] ? 2 : 3);
  }

  private timeText(): string {
    const m = Math.floor(this.elapsed / 60);
    const s = Math.floor(this.elapsed % 60).toString().padStart(2, '0');
    return `Restored in ${m}:${s} with ${this.seedsGathered} seeds`;
  }

  // ======================= input =======================

  private hand(side: Side): HandState {
    return side === 'left' ? this.hands.left : this.hands.right;
  }

  private applySim(): void {
    if (this.sim == null) return;
    for (const side of ['left', 'right'] as const) {
      const src = this.sim[side];
      const dst = this.hand(side);
      dst.tracked = src.tracked;
      dst.pinch = src.tracked && src.pinch === true;
      dst.open = src.tracked && src.open && !dst.pinch;
      dst.palm.set(src.palm[0], src.palm[1], src.palm[2]);
      dst.pinchPoint.copy(dst.palm);
    }
  }

  // ======================= frame loop =======================

  update(delta: number): void {
    const dt = Math.min(delta, 0.05);
    this.clock += dt;
    this.stageClock += dt;
    if (this.stage !== 'complete') this.elapsed += dt;

    if (this.sim != null) this.applySim();
    else this.hands.update(this.renderer, this.player, dt);

    const anyHand = this.hands.left.tracked || this.hands.right.tracked;
    this.noHandsTime = anyHand ? 0 : this.noHandsTime + dt;

    this.updateSeeds(dt);
    this.updateIslands(dt);
    this.updateBridge(dt);
    this.updateWeave(dt);
    this.updateHeart(dt);
    this.updatePalmGlows();
    this.dust.rotation.y += dt * 0.03;
    this.drawHint();
  }

  // ---------- stage 1: Palm of Attraction ----------

  private updateSeeds(dt: number): void {
    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    for (const seed of this.seeds) {
      const pos = seed.mesh.position;
      switch (seed.state) {
        case SEED_GONE:
          seed.timer -= dt;
          if (seed.timer <= 0) {
            seed.state = SEED_FLOAT;
            pos.copy(seed.home);
            seed.mesh.visible = true;
          }
          continue;
        case SEED_SINKING: {
          seed.timer -= dt;
          pos.lerp(this.tmp.copy(this.islands[0].center).setY(this.islands[0].center.y + 0.02), ease(6));
          seed.mesh.scale.setScalar(Math.max(0.05, seed.timer / 0.6));
          if (seed.timer <= 0) {
            seed.state = SEED_GONE;
            seed.timer = SEED_RESPAWN;
            seed.mesh.visible = false;
            seed.mesh.scale.setScalar(1);
          }
          continue;
        }
        case SEED_FLOAT: {
          this.tmp.copy(seed.home);
          this.tmp.y += Math.sin(this.clock * 1.3 + seed.angle) * 0.015;
          this.tmp.x += Math.cos(this.clock * 0.7 + seed.angle) * 0.01;
          pos.lerp(this.tmp, ease(2.5));
          for (const side of ['left', 'right'] as const) {
            const h = this.hand(side);
            if (h.tracked && h.open && h.palm.distanceTo(pos) < ATTRACT_RADIUS) {
              seed.state = SEED_DRAWN;
              seed.side = side;
              break;
            }
          }
          break;
        }
        default: {
          const h = this.hand(seed.side);
          if (!h.tracked || !h.open) {
            seed.state = SEED_FLOAT; // drift home gently on tracking loss or closed hand
          } else if (seed.state === SEED_DRAWN) {
            pos.lerp(h.palm, ease(3.5));
            if (pos.distanceTo(h.palm) < CATCH_RADIUS) {
              seed.state = SEED_HELD;
              tone(880 + Math.random() * 220, 0.15);
            }
          } else {
            const a = seed.angle + this.clock * 2.6;
            this.tmp.set(Math.cos(a) * 0.045, 0.03 + Math.sin(this.clock * 2 + seed.angle) * 0.012, Math.sin(a) * 0.045);
            pos.lerp(this.tmp.add(h.palm), ease(9));
          }
        }
      }
      seed.mat.emissiveIntensity = seed.state === SEED_HELD ? 2.8 : seed.state === SEED_DRAWN ? 1.9 : 1 + Math.sin(this.clock * 3 + seed.angle) * 0.3;
    }

    // Planting: lower an open palm holding seeds onto an island.
    this.depositCooldown = Math.max(0, this.depositCooldown - dt);
    if (this.depositCooldown > 0) return;
    for (const side of ['left', 'right'] as const) {
      const h = this.hand(side);
      if (!h.tracked || !h.open) continue;
      const held = this.seeds.find((s) => s.state === SEED_HELD && s.side === side);
      if (held == null) continue;
      for (const island of this.islands) {
        if (!this.palmOverIsland(h, island)) continue;
        if (island === this.islands[1] && !island.restored) {
          this.setHint('This island is sealed', 'Restore the first island, then build a bridge');
          this.depositCooldown = 1.2;
          continue;
        }
        if (island === this.islands[0] && this.stage === 'seeds') {
          held.state = SEED_SINKING;
          held.timer = 0.6;
          island.seeds += 1;
          this.seedsGathered += 1;
          this.depositCooldown = 0.45;
          tone(520 + island.seeds * 110, 0.3, 'triangle');
          this.setHint('The island stirs', `Seeds ${island.seeds}/${SEEDS_NEEDED}`);
          if (island.seeds >= SEEDS_NEEDED) {
            this.bloom(island);
            this.enterStage('bridge');
          }
          return;
        }
        if (island.restored) {
          // Extra seeds still feed the world's memory (Living Echo).
          held.state = SEED_SINKING;
          held.timer = 0.6;
          this.seedsGathered += 1;
          this.depositCooldown = 0.45;
          tone(660, 0.25, 'triangle');
          return;
        }
      }
    }
  }

  private palmOverIsland(h: HandState, island: Island): boolean {
    const dx = h.palm.x - island.center.x;
    const dz = h.palm.z - island.center.z;
    const above = h.palm.y - (island.center.y + 0.015);
    return Math.hypot(dx, dz) < DEPOSIT_REACH && above > -0.03 && above < DEPOSIT_HEIGHT;
  }

  private updateIslands(dt: number): void {
    for (const island of this.islands) {
      const target = island.restored ? 1 : Math.min(island.seeds / SEEDS_NEEDED, 1) * 0.35;
      island.bloom += (target - island.bloom) * (1 - Math.exp(-2 * dt));
      const b = island.bloom;
      island.rock.emissive.copy(island.tint).multiplyScalar(0.06 + b * 0.35);
      island.ring.opacity = 0.12 + b * 0.6 + Math.sin(this.clock * 2) * 0.05 * b;
      island.spires.forEach((spire, i) => {
        const grow = Math.min(1, Math.max(0, b * 1.4 - i * 0.06));
        spire.scale.setScalar(Math.max(0.001, grow));
      });
      island.root.position.y = island.center.y + Math.sin(this.clock * 0.8 + island.center.x * 10) * 0.004;
    }
  }

  // ---------- stage 2: The Living Bridge ----------

  private updateBridge(dt: number): void {
    const L = this.hands.left;
    const R = this.hands.right;
    const sep = L.palm.distanceTo(R.palm);
    const formed = L.tracked && R.tracked && L.open && R.open && sep > BRIDGE_MIN && sep < BRIDGE_MAX;

    this.bridge.visible = formed;
    let anchored = false;
    let fromA: HandState = L;
    let toB: HandState = R;
    if (formed) {
      // Which palm is over which island?
      const lA = L.palm.distanceTo(ISLAND_A);
      const rA = R.palm.distanceTo(ISLAND_A);
      fromA = lA <= rA ? L : R;
      toB = fromA === L ? R : L;
      anchored = fromA.palm.distanceTo(ISLAND_A) < BRIDGE_ANCHOR + 0.05 && toB.palm.distanceTo(ISLAND_B) < BRIDGE_ANCHOR + 0.05;

      const mid = this.tmp.copy(fromA.palm).add(toB.palm).multiplyScalar(0.5);
      mid.y += 0.08 + sep * 0.1;
      this.bridgeCurve.v0.copy(fromA.palm);
      this.bridgeCurve.v1.copy(mid);
      this.bridgeCurve.v2.copy(toB.palm);
      for (let i = 0; i < BRIDGE_BEADS; i++) {
        const t = i / (BRIDGE_BEADS - 1);
        this.bridgeCurve.getPoint(t, this.dummy.position);
        const pulse = 0.7 + 0.5 * Math.sin(this.clock * 8 - t * 10);
        this.dummy.scale.setScalar(pulse);
        this.dummy.updateMatrix();
        this.bridge.setMatrixAt(i, this.dummy.matrix);
      }
      this.bridge.instanceMatrix.needsUpdate = true;
      this.bridgeMat.color.setHex(anchored ? 0x7fffe0 : 0x9a7cff);
      this.bridgeMat.opacity = anchored ? 0.95 : 0.55;
    }

    if (!this.wispActive) return;
    const pulse = 1 + Math.sin(this.clock * 5) * 0.15;
    this.wisp.scale.setScalar(pulse);

    if (this.stage === 'bridge' && formed && anchored) {
      this.wispT = Math.min(1, this.wispT + dt / WISP_CROSS_TIME);
      this.bridgeCurve.getPoint(this.wispT, this.wisp.position);
      if (Math.random() < dt * 6) tone(600 + this.wispT * 500, 0.08, 'sine', 0.05);
      if (this.wispT >= 1) {
        this.wispActive = false;
        this.wisp.visible = false;
        this.bloom(this.islands[1]);
        this.enterStage('weave');
      }
    } else if (this.stage === 'bridge') {
      // Bridge broken: the wisp waits on the first island, ready to try again.
      this.wispT = Math.max(0, this.wispT - dt * 0.6);
      this.tmp2.copy(ISLAND_A);
      this.tmp2.y += 0.05 + Math.sin(this.clock * 2) * 0.01;
      if (this.wispT === 0) this.wisp.position.lerp(this.tmp2, 1 - Math.exp(-4 * dt));
      if (this.stageClock > 8 && !formed) this.setHint('Open both hands, one over each island', 'The wisp will cross between them');
    }
  }

  // ---------- stage 3: Pinch to Weave ----------

  private updateWeave(dt: number): void {
    if (this.stage !== 'weave') return;
    const ease = 1 - Math.exp(-20 * dt);
    let sparkAt: Vector3 | null = null;

    for (const side of ['left', 'right'] as const) {
      const h = this.hand(side);
      const held = this.nodes.find((n) => n.heldBy === side);

      if (held != null) {
        if (!h.tracked) {
          held.heldBy = null; // tracking lost: leave it floating where it is
        } else if (h.pinch) {
          held.mesh.position.lerp(h.pinchPoint, ease);
          sparkAt = h.pinchPoint;
        } else {
          held.heldBy = null;
          if (held.mesh.position.distanceTo(held.socket) < SOCKET_SNAP) {
            held.locked = true;
            held.mesh.position.copy(held.socket);
            chord(392, [1, 1.5, 2]);
            const left = this.nodes.filter((n) => !n.locked).length;
            this.setHint(
              left === 0 ? 'The paths are whole' : 'One more crystal',
              left === 0 ? '' : 'Pinch it and set it in its socket',
            );
          } else {
            tone(240, 0.15, 'triangle', 0.08); // dropped short of the socket
          }
        }
        continue;
      }

      if (h.tracked && h.pinch) {
        const target = this.nodes.find(
          (n) => !n.locked && n.heldBy == null && n.mesh.position.distanceTo(h.pinchPoint) < NODE_GRAB_RADIUS,
        );
        if (target != null) {
          target.heldBy = side;
          tone(700, 0.12);
        }
      }
    }

    for (const n of this.nodes) {
      if (n.locked) {
        n.mesh.rotation.y += dt * 2;
        n.mat.emissiveIntensity = 2.2;
        n.socketMat.opacity = 0.9;
        continue;
      }
      const near = (['left', 'right'] as const).some((side) => {
        const h = this.hand(side);
        return h.tracked && h.pinchPoint.distanceTo(n.mesh.position) < NODE_GRAB_RADIUS * 1.5;
      });
      n.mesh.rotation.y += dt * (n.heldBy ? 4 : 0.8);
      n.mat.emissiveIntensity = n.heldBy ? 2.4 : near ? 1.6 : 0.8 + Math.sin(this.clock * 3) * 0.2;
      const closeToSocket = n.mesh.position.distanceTo(n.socket) < SOCKET_SNAP;
      n.socketMat.opacity = closeToSocket ? 0.85 : 0.3 + Math.sin(this.clock * 2.5) * 0.12;
    }

    this.spark.visible = sparkAt != null;
    if (sparkAt != null) {
      this.spark.position.copy(sparkAt);
      this.spark.scale.setScalar(1 + Math.sin(this.clock * 20) * 0.3);
    }

    if (this.nodes.every((n) => n.locked)) {
      this.spark.visible = false;
      this.enterStage('resonance');
    }
  }

  // ---------- stage 4: Two-Hand Resonance ----------

  private updateHeart(dt: number): void {
    const L = this.hands.left;
    const R = this.hands.right;
    const awake = this.stage === 'complete';
    let cradled = false;
    let separation = 1;

    if (this.stage === 'resonance') {
      const lNear = L.tracked && L.open && L.palm.distanceTo(HEART) < CRADLE_REACH;
      const rNear = R.tracked && R.open && R.palm.distanceTo(HEART) < CRADLE_REACH;
      const opposite = (L.palm.x - HEART.x) * (R.palm.x - HEART.x) < 0;
      cradled = lNear && rNear && opposite;
      separation = L.palm.distanceTo(R.palm);
      if (cradled) {
        // Hands closer together resonate faster (0.6x to 1.6x).
        const speed = Math.min(1.6, Math.max(0.6, (0.4 - separation) / 0.2 + 0.8));
        this.resonance = Math.min(1, this.resonance + (dt / RESONANCE_TIME) * speed);
        this.rippleTimer -= dt;
        if (this.rippleTimer <= 0) {
          this.rippleTimer = 0.45 - this.resonance * 0.25;
          this.spawnRipple();
          tone(220 * (1 + this.resonance), 0.25, 'sine', 0.06);
        }
        this.setHint('Resonating…', `${Math.round(this.resonance * 100)}%`);
        if (this.resonance >= 1) this.enterStage('complete');
      } else {
        this.resonance = Math.max(0, this.resonance - dt * 0.15);
      }
    }

    // Heart visuals.
    const energy = awake ? 1 : this.resonance;
    const beat = 1 + Math.sin(this.clock * (2 + energy * 4)) * (0.04 + energy * 0.06);
    this.heart.scale.setScalar(beat * (awake ? 1.5 : 1));
    this.heart.rotation.y += dt * (0.3 + energy * 2);
    this.heartCore.emissiveIntensity = 0.1 + energy * 3;
    this.heartShell.emissiveIntensity = 0.15 + energy * 1.2;
    this.heartShell.emissive.setHex(cradled || awake ? 0xffb02e : 0x6a3cff);

    this.threads.forEach((thread, i) => {
      const mat = thread.material as MeshBasicMaterial;
      const target = awake ? 0.55 + Math.sin(this.clock * 3) * 0.15 : this.nodes[i]?.locked ? 0.25 : 0;
      mat.opacity += (target - mat.opacity) * (1 - Math.exp(-2 * dt));
    });

    for (const r of this.ripples) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      const t = r.age / 1.1;
      r.mesh.scale.setScalar(1 + t * 3);
      r.mat.opacity = Math.max(0, 0.7 * (1 - t));
      if (t >= 1) r.mesh.visible = false;
    }

    // Living Echo: wisps circle the awakened Heart.
    this.echoWisps.forEach((w, i) => {
      if (!w.visible) return;
      const a = this.clock * (0.8 + (i % 3) * 0.25) + (i / this.echoWisps.length) * Math.PI * 2;
      const r = 0.1 + (i % 4) * 0.035;
      w.position.set(HEART.x + Math.cos(a) * r, HEART.y + Math.sin(a * 1.7 + i) * 0.04, HEART.z + Math.sin(a) * r);
    });
  }

  private spawnRipple(): void {
    let ripple = this.ripples.find((r) => !r.mesh.visible);
    if (ripple == null) {
      const mat = new MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.7, blending: AdditiveBlending, depthWrite: false });
      const mesh = new Mesh(this.rippleGeo, mat);
      this.world.createTransformEntity(mesh);
      ripple = { mesh, mat, age: 0 };
      this.ripples.push(ripple);
    }
    ripple.age = 0;
    ripple.mesh.visible = true;
    ripple.mesh.position.copy(HEART);
    ripple.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
  }

  private spawnEcho(): void {
    const count = Math.max(3, Math.min(this.seedsGathered, 12));
    while (this.echoWisps.length < count) {
      const gold = this.echoWisps.length % 2 === 0;
      const mesh = new Mesh(
        new SphereGeometry(0.008, 10, 8),
        new MeshStandardMaterial({ color: gold ? 0xffd36b : 0x7ff7e8, emissive: new Color(gold ? 0xffa21f : 0x22e3cf), emissiveIntensity: 2.5 }),
      );
      this.world.createTransformEntity(mesh);
      this.echoWisps.push(mesh);
    }
    this.echoWisps.forEach((w, i) => (w.visible = i < count));
  }

  // ---------- feedback ----------

  private updatePalmGlows(): void {
    for (const side of ['left', 'right'] as const) {
      const h = this.hand(side);
      const glow = this.palmGlow[side];
      glow.visible = h.tracked && h.open;
      if (!glow.visible) continue;
      glow.position.copy(h.palm);
      const holding = this.seeds.some((s) => s.state === SEED_HELD && s.side === side);
      glow.scale.setScalar(holding ? 1.25 + Math.sin(this.clock * 6) * 0.1 : 0.9);
    }
  }

  private setHint(text: string, sub: string): void {
    this.hintText = text;
    this.hintSub = sub;
  }

  private lastDrawn = '';
  private drawHint(): void {
    const inXR = this.renderer.xr.isPresenting;
    let text = this.hintText;
    let sub = this.hintSub;
    if (!inXR && this.sim == null) {
      text = 'PALMORA: The Living Silence';
      sub = 'Enter VR on Meta Quest. Hands only.';
    } else if (inXR && this.noHandsTime > 1.5) {
      text = 'Show your hands';
      sub = 'Put controllers down. Hands only.';
    }
    const key = `${text}|${sub}`;
    if (key === this.lastDrawn) return;
    this.lastDrawn = key;

    const { ctx, canvas, tex } = this.hint;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(10, 8, 30, 0.55)';
    ctx.beginPath();
    ctx.roundRect(4, 4, w - 8, h - 8, 28);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e9f6ff';
    ctx.font = '600 34px sans-serif';
    ctx.fillText(text, w / 2, h * 0.45);
    ctx.fillStyle = '#ffd36b';
    ctx.font = '24px sans-serif';
    ctx.fillText(sub, w / 2, h * 0.8);
    tex.needsUpdate = true;
  }
}

