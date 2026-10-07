import * as THREE from "three";
import { CROWD_TIERS, PARAPET_HEIGHT, PARAPET_SETBACK, buildCrowd } from "./crowd";
import { ARENA_FLOOR } from "./world";

export interface BuiltArena {
  readonly group: THREE.Group;
  readonly update: (time: number, dt: number, reducedMotion: boolean) => void;
  /** Raises crowd excitement (0..1); it decays over a few seconds. */
  readonly excite: (amount: number) => void;
  readonly excitement: () => number;
  /** Sheds the crowd's most expensive work when the client is struggling. */
  readonly setLowTier: (low: boolean) => void;
  readonly dispose: () => void;
}

const EXCITEMENT_DECAY_PER_SECOND = 0.3;
const BOARD_REPEATS = 6;
const BOARD_SCROLL_PER_SECOND = 0.012;

const seededRandom = (seed: number): (() => number) => () => {
  seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
};

export function buildArena(): BuiltArena {
  const group = new THREE.Group();
  group.name = "arena";
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const disposables: Array<{ dispose: () => void }> = [];

  const floorMat = new THREE.MeshStandardMaterial({ color: "#05070c", roughness: 0.95 });
  materials.push(floorMat);
  const floorGeo = new THREE.CircleGeometry(30, 40);
  geometries.push(floorGeo);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = ARENA_FLOOR;
  floor.receiveShadow = true;
  group.add(floor);

  const rand = seededRandom(20260727);
  const tiers = CROWD_TIERS;
  const crowd = buildCrowd(rand);
  group.add(crowd.group);

  const boardCanvas = document.createElement("canvas");
  boardCanvas.width = 1024;
  boardCanvas.height = 64;
  const boardCtx = boardCanvas.getContext("2d");
  if (boardCtx !== null) {
    boardCtx.fillStyle = "#070c1a";
    boardCtx.fillRect(0, 0, 1024, 64);
    boardCtx.fillStyle = "#13203f";
    boardCtx.fillRect(0, 0, 1024, 5);
    boardCtx.fillRect(0, 59, 1024, 5);
    boardCtx.textBaseline = "middle";
    boardCtx.font = "800 38px Inter, system-ui, sans-serif";
    boardCtx.fillStyle = "#e9c46a";
    boardCtx.fillText("H A N D S", 28, 33);
    boardCtx.fillStyle = "#c9d6f2";
    boardCtx.font = "600 26px Inter, system-ui, sans-serif";
    boardCtx.fillText("CHAMPIONSHIP BOXING", 300, 34);
    boardCtx.fillStyle = "#e9c46a";
    boardCtx.font = "800 30px Inter, system-ui, sans-serif";
    boardCtx.fillText("FIGHT NIGHT", 700, 34);
    boardCtx.fillStyle = "#b91c1c";
    boardCtx.fillRect(948, 22, 22, 22);
    boardCtx.fillStyle = "#1d4ed8";
    boardCtx.fillRect(978, 22, 22, 22);
  }
  const boardTexture = new THREE.CanvasTexture(boardCanvas);
  boardTexture.colorSpace = THREE.SRGBColorSpace;
  boardTexture.wrapS = THREE.RepeatWrapping;
  boardTexture.repeat.set(-BOARD_REPEATS, 1);
  disposables.push(boardTexture);
  const boardMat = new THREE.MeshBasicMaterial({ map: boardTexture, side: THREE.BackSide });
  materials.push(boardMat);
  const boardTop = tiers[0]!.y + PARAPET_HEIGHT;
  const boardGeo = new THREE.CylinderGeometry(tiers[0]!.radius - PARAPET_SETBACK - 0.03, tiers[0]!.radius - PARAPET_SETBACK - 0.03, boardTop - ARENA_FLOOR - 0.04, 72, 1, true);
  geometries.push(boardGeo);
  const boards = new THREE.Mesh(boardGeo, boardMat);
  boards.name = "boards";
  boards.position.y = (boardTop + ARENA_FLOOR) / 2 + 0.02;
  group.add(boards);

  const flashCount = 90;
  const flashPositions = new Float32Array(flashCount * 3);
  for (let i = 0; i < flashCount; i += 1) {
    const tier = tiers[Math.floor(rand() * tiers.length)]!;
    const angle = rand() * Math.PI * 2;
    flashPositions[i * 3] = Math.sin(angle) * tier.radius;
    flashPositions[i * 3 + 1] = tier.y + 0.9 + rand() * 0.5;
    flashPositions[i * 3 + 2] = Math.cos(angle) * tier.radius;
  }
  const flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute("position", new THREE.BufferAttribute(flashPositions, 3));
  geometries.push(flashGeo);
  const flashMat = new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.09, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
  materials.push(flashMat);
  const flashes = new THREE.Points(flashGeo, flashMat);
  group.add(flashes);

  const trussMat = new THREE.MeshStandardMaterial({ color: "#11151d", roughness: 0.6, metalness: 0.4 });
  materials.push(trussMat);
  const lampMat = new THREE.MeshStandardMaterial({ color: "#1a2230", emissive: "#dfe9ff", emissiveIntensity: 1.1, roughness: 0.4 });
  materials.push(lampMat);
  const coneMat = new THREE.MeshBasicMaterial({ color: "#a8c4ff", transparent: true, opacity: 0.006, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  materials.push(coneMat);
  const trussGeo = new THREE.BoxGeometry(9, 0.18, 0.18);
  geometries.push(trussGeo);
  const lampGeo = new THREE.CylinderGeometry(0.09, 0.14, 0.22, 10);
  geometries.push(lampGeo);
  const coneGeo = new THREE.ConeGeometry(1.7, 6.6, 20, 1, true);
  geometries.push(coneGeo);
  for (let trussIndex = 0; trussIndex < 2; trussIndex += 1) {
    const truss = new THREE.Mesh(trussGeo, trussMat);
    truss.position.set(0, 7.6, trussIndex === 0 ? -1.6 : 1.6);
    group.add(truss);
    for (let lamp = 0; lamp < 5; lamp += 1) {
      const x = -3.6 + lamp * 1.8;
      const fixture = new THREE.Mesh(lampGeo, lampMat);
      fixture.position.set(x, 7.45, truss.position.z);
      group.add(fixture);
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.set(x, 4.1, truss.position.z * 0.4);
      group.add(cone);
    }
  }

  const wallMat = new THREE.MeshStandardMaterial({ color: "#070a12", roughness: 1 });
  materials.push(wallMat);
  const wallGeo = new THREE.CylinderGeometry(24, 24, 14, 32, 1, true);
  geometries.push(wallGeo);
  const wall = new THREE.Mesh(wallGeo, wallMat);
  wall.position.y = 5;
  wall.material.side = THREE.BackSide;
  group.add(wall);

  const jumboCanvas = document.createElement("canvas");
  jumboCanvas.width = 512;
  jumboCanvas.height = 256;
  const jumboCtx = jumboCanvas.getContext("2d");
  if (jumboCtx !== null) {
    jumboCtx.fillStyle = "#04060c";
    jumboCtx.fillRect(0, 0, 512, 256);
    jumboCtx.strokeStyle = "#f1cc72";
    jumboCtx.lineWidth = 6;
    jumboCtx.strokeRect(14, 14, 484, 228);
    jumboCtx.fillStyle = "#f1cc72";
    jumboCtx.font = "800 84px Inter, system-ui, sans-serif";
    jumboCtx.textAlign = "center";
    jumboCtx.textBaseline = "middle";
    jumboCtx.fillText("H A N D S", 256, 104);
    jumboCtx.fillStyle = "#8fa3c8";
    jumboCtx.font = "600 30px Inter, system-ui, sans-serif";
    jumboCtx.fillText("CHAMPIONSHIP BOXING", 256, 186);
  }
  const jumboTexture = new THREE.CanvasTexture(jumboCanvas);
  jumboTexture.colorSpace = THREE.SRGBColorSpace;
  const jumboMat = new THREE.MeshBasicMaterial({ map: jumboTexture });
  materials.push(jumboMat);
  const jumboGeo = new THREE.BoxGeometry(4.6, 2.3, 0.3);
  geometries.push(jumboGeo);
  const jumbotron = new THREE.Mesh(jumboGeo, jumboMat);
  jumbotron.position.set(0, 6.4, -14.5);
  group.add(jumbotron);
  const jumboBack = new THREE.Mesh(jumboGeo, trussMat);
  jumboBack.position.set(0, 6.4, -14.65);
  group.add(jumboBack);
  disposables.push(jumboTexture);

  let flashTimer = 0;
  let flashOn = 0;
  let excitement = 0;
  let still = false;
  const update = (time: number, dt: number, reducedMotion: boolean): void => {
    excitement = Math.max(0, excitement - dt * EXCITEMENT_DECAY_PER_SECOND);
    // Reduced motion seats the crowd once, rather than leaving it in whatever pose it held.
    if (reducedMotion && !still) crowd.update(0, 0, true);
    still = reducedMotion;
    if (!reducedMotion) {
      crowd.update(time, excitement);
      boardTexture.offset.x = (time * BOARD_SCROLL_PER_SECOND) % 1;
      flashTimer -= dt;
      if (flashTimer <= 0) {
        flashOn = 0.09 + Math.random() * 0.08;
        flashTimer = (0.25 + Math.random() * 1.6) / (1 + excitement * 4);
      }
      flashOn = Math.max(0, flashOn - dt);
      flashMat.opacity = flashOn > 0 ? 0.85 : 0;
    }
  };

  const dispose = (): void => {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const disposable of disposables) disposable.dispose();
    crowd.dispose();
  };

  const excite = (amount: number): void => {
    excitement = Math.min(1, excitement + Math.max(0, amount));
  };

  return { group, update, excite, excitement: () => excitement, setLowTier: crowd.setLowTier, dispose };
}
