import * as THREE from "three";

export interface BuiltArena {
  readonly group: THREE.Group;
  readonly update: (time: number, dt: number, reducedMotion: boolean) => void;
  readonly dispose: () => void;
}

const CROWD_BODY_COLORS = [0x2a3140, 0x3a2f2a, 0x26343a, 0x40312e, 0x2e3a2c, 0x38343e, 0x443c30, 0x5a5148, 0x31404a, 0x4a3542];
const CROWD_SKIN_COLORS = [0xc79b76, 0x8a5a3b, 0x6e4128, 0xe0b48f, 0x54301d, 0xa9744f];

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
  floor.position.y = -1.0;
  floor.receiveShadow = true;
  group.add(floor);

  const rand = seededRandom(20260727);
  const tiers = [
    { radius: 8.2, y: -0.55, count: 120, scale: 1 },
    { radius: 10.6, y: 0.35, count: 150, scale: 1.04 },
    { radius: 13.2, y: 1.35, count: 180, scale: 1.08 },
    { radius: 16.0, y: 2.45, count: 210, scale: 1.12 },
  ];
  const total = tiers.reduce((sum, tier) => sum + tier.count, 0);

  const bodyGeo = new THREE.CapsuleGeometry(0.19, 0.5, 4, 8);
  const headGeo = new THREE.SphereGeometry(0.115, 8, 7);
  geometries.push(bodyGeo, headGeo);
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const headMat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
  materials.push(bodyMat, headMat);
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, total);
  const heads = new THREE.InstancedMesh(headGeo, headMat, total);
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const phases = new Float32Array(total);
  const bases: Array<{ x: number; y: number; z: number; yaw: number; scale: number }> = [];
  let index = 0;
  for (const tier of tiers) {
    for (let i = 0; i < tier.count; i += 1) {
      const angle = (i / tier.count) * Math.PI * 2 + rand() * 0.03;
      const jitter = (rand() - 0.5) * 0.7;
      const x = Math.sin(angle) * (tier.radius + jitter);
      const z = Math.cos(angle) * (tier.radius + jitter);
      const y = tier.y + (rand() - 0.5) * 0.12;
      const yaw = Math.atan2(-x, -z) + (rand() - 0.5) * 0.5;
      const scale = tier.scale * (0.92 + rand() * 0.2);
      bases.push({ x, y, z, yaw, scale });
      phases[index] = rand() * Math.PI * 2;
      matrix.compose(new THREE.Vector3(x, y + 0.45 * scale, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale));
      bodies.setMatrixAt(index, matrix);
      matrix.compose(new THREE.Vector3(x, y + 0.95 * scale, z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      heads.setMatrixAt(index, matrix);
      color.setHex(CROWD_BODY_COLORS[Math.floor(rand() * CROWD_BODY_COLORS.length)]!).multiplyScalar(0.85 + rand() * 0.6);
      bodies.setColorAt(index, color);
      color.setHex(CROWD_SKIN_COLORS[Math.floor(rand() * CROWD_SKIN_COLORS.length)]!).multiplyScalar(0.85 + rand() * 0.35);
      heads.setColorAt(index, color);
      index += 1;
    }
  }
  bodies.instanceColor!.needsUpdate = true;
  heads.instanceColor!.needsUpdate = true;
  group.add(bodies, heads);

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
  const coneMat = new THREE.MeshBasicMaterial({ color: "#a8c4ff", transparent: true, opacity: 0.014, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
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
  const crowdMatrix = new THREE.Matrix4();
  const crowdPosition = new THREE.Vector3();
  const crowdQuaternion = new THREE.Quaternion();
  const crowdScale = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const update = (time: number, dt: number, reducedMotion: boolean): void => {
    if (!reducedMotion) {
      const subset = 90;
      const start = Math.floor((time * 30) % total);
      for (let n = 0; n < subset; n += 1) {
        const i = (start + n) % total;
        const base = bases[i]!;
        const sway = Math.sin(time * 1.6 + phases[i]!) * 0.05;
        const bounce = Math.abs(Math.sin(time * 2.3 + phases[i]! * 1.7)) * 0.05;
        crowdQuaternion.setFromAxisAngle(yAxis, base.yaw + sway);
        crowdMatrix.compose(
          crowdPosition.set(base.x, base.y + 0.45 * base.scale + bounce, base.z + sway * 0.4),
          crowdQuaternion,
          crowdScale.set(base.scale, base.scale, base.scale),
        );
        bodies.setMatrixAt(i, crowdMatrix);
        crowdQuaternion.setFromAxisAngle(yAxis, base.yaw + sway * 1.2);
        crowdMatrix.compose(
          crowdPosition.set(base.x, base.y + 0.95 * base.scale + bounce * 1.2, base.z + sway * 0.5),
          crowdQuaternion,
          crowdScale,
        );
        heads.setMatrixAt(i, crowdMatrix);
      }
      bodies.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
      flashTimer -= dt;
      if (flashTimer <= 0) {
        flashOn = 0.09 + Math.random() * 0.08;
        flashTimer = 0.25 + Math.random() * 1.6;
      }
      flashOn = Math.max(0, flashOn - dt);
      flashMat.opacity = flashOn > 0 ? 0.85 : 0;
    }
  };

  const dispose = (): void => {
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const disposable of disposables) disposable.dispose();
    bodies.dispose();
    heads.dispose();
  };

  return { group, update, dispose };
}
