import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ARENA_FLOOR } from "./world";

/**
 * The arena crowd: seated spectators in stepped stands behind a parapet. Each is a torso with
 * shoulders, a head with hair and a face, and two arms. They sway in their seats, and as the bout
 * excites them the keener ones get to their feet and throw their arms up first.
 */

export interface CrowdTier {
  readonly radius: number;
  /** Height of the tier's floor. */
  readonly y: number;
  readonly count: number;
  readonly scale: number;
}

export const CROWD_TIERS: readonly CrowdTier[] = [
  { radius: 8.2, y: -0.55, count: 120, scale: 1 },
  { radius: 10.6, y: 0.35, count: 150, scale: 1.04 },
  { radius: 13.2, y: 1.35, count: 180, scale: 1.08 },
  { radius: 16.0, y: 2.45, count: 210, scale: 1.12 },
];

/** How far in front of a row its parapet stands, and how high it rises above the row's floor. */
export const PARAPET_SETBACK = 0.95;
export const PARAPET_HEIGHT = 0.42;
const SHIRT_COLORS = [0x3a4660, 0x5a4538, 0x35505c, 0x6a3f3a, 0x46603f, 0x544d63, 0x6e5f44, 0x8a8074, 0x47627a, 0x74486a, 0x9a3a3a, 0xb4b8c2, 0x2f5fb0, 0xb09a3e, 0x23262e, 0x23262e];
const SKIN_COLORS = [0xc79b76, 0x8a5a3b, 0x6e4128, 0xe0b48f, 0x54301d, 0xa9744f];
const HAIR_COLORS = [0x15100c, 0x2a1b12, 0x4a3220, 0x6b5a48, 0x8e8a84, 0xb08a4e];

const SHOULDER_HEIGHT = 0.9;
const SHOULDER_HALF_WIDTH = 0.235;
const ARM_REST = -0.35;
const ARM_RAISED = -2.7;
const STANDING_RISE = 0.32;
const HOUSE_LIGHT = 0.26;
/** The broadcast camera pulls back as far as 14 m on a tall screen, over the first three rows. */
export const CAMERA_PLATFORM_REACH = 14.5;
export const CAMERA_PLATFORM_HALF_ANGLE = 0.3;
/**
 * A camera this far out on the platform's side is up in the stands, in front of the first row's seats, and
 * once there it has to come this much nearer to leave, so a shot hovering at the edge does not flicker them.
 */
export const CAMERA_PLATFORM_START = 6.2;
const CAMERA_PLATFORM_LEAVE = 0.3;

/**
 * Whether a camera at (x, z) stands on the broadcast platform, where the seats on it would be in its way:
 * whatever the shot (the broadcast, the decision, the arm raised after a stoppage), by where it stands.
 */
export function cameraOnPlatform(x: number, z: number, from = CAMERA_PLATFORM_START): boolean {
  return z > 0 && Math.hypot(x, z) > from && Math.abs(Math.atan2(x, z)) < CAMERA_PLATFORM_HALF_ANGLE;
}
const RIG_HEIGHT = 7.5;

const SPILL_VERTEX = /* glsl */ `
#ifdef USE_INSTANCING
  vec4 crowdWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#else
  vec4 crowdWorld = modelMatrix * vec4(transformed, 1.0);
#endif
vCrowdLight = vec3(-crowdWorld.x, ${RIG_HEIGHT.toFixed(1)} - crowdWorld.y, -crowdWorld.z);
`;

const SPILL_FRAGMENT = /* glsl */ `
#ifdef USE_COLOR
  totalEmissiveRadiance *= vColor.rgb * (0.22 + 0.78 * max(0.0, dot(inverseTransformDirection(normal, viewMatrix), normalize(vCrowdLight))));
#endif
`;

export interface Spectator {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly phase: number;
  /** 0..1: how little it takes to get this one out of the seat. */
  readonly keen: number;
  /** How much of the ring's light reaches this row. */
  readonly light: number;
  /** Sits on the broadcast camera's platform, and makes way while the camera stands there. */
  readonly platform: boolean;
}

export interface SpectatorPose {
  /** Metres above the seat. */
  rise: number;
  /** Rotation of each arm about the shoulder, from hanging forward (rest) to overhead. */
  armLeft: number;
  armRight: number;
  sway: number;
}

const smooth = (from: number, to: number, value: number): number => {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

export function seatSpectators(tiers: readonly CrowdTier[], rand: () => number): Spectator[] {
  const seated: Spectator[] = [];
  for (const [row, tier] of tiers.entries()) {
    for (let seat = 0; seat < tier.count; seat += 1) {
      const angle = (seat / tier.count) * Math.PI * 2 + rand() * 0.03;
      const reach = tier.radius + (rand() - 0.5) * 0.5;
      const x = Math.sin(angle) * reach;
      const z = Math.cos(angle) * reach;
      const spectator = { keen: rand(), phase: rand() * Math.PI * 2, scale: tier.scale * (0.92 + rand() * 0.2), lean: (rand() - 0.5) * 0.5, lift: (rand() - 0.5) * 0.06 };
      seated.push({
        x,
        y: tier.y + spectator.lift,
        z,
        yaw: Math.atan2(-x, -z) + spectator.lean,
        scale: spectator.scale,
        phase: spectator.phase,
        keen: spectator.keen,
        light: Math.max(0.45, 1 - row * 0.17),
        // The broadcast camera works from a platform in the stands: whoever sits in front of it makes way for it.
        platform: tier.radius < CAMERA_PLATFORM_REACH && z > 0 && Math.abs(Math.atan2(x, z)) < CAMERA_PLATFORM_HALF_ANGLE,
      });
    }
  }
  return seated;
}

export function spectatorPose(spectator: Spectator, time: number, excitement: number, out: SpectatorPose = { rise: 0, armLeft: 0, armRight: 0, sway: 0 }): SpectatorPose {
  const threshold = 0.2 + 0.7 * (1 - spectator.keen);
  const up = smooth(threshold - 0.12, threshold + 0.12, excitement);
  const bounce = Math.abs(Math.sin(time * (2.3 + excitement * 3.2) + spectator.phase * 1.7)) * (0.02 + 0.1 * up);
  const wave = Math.sin(time * 6.2 + spectator.phase) * 0.32 * up;
  const arm = ARM_REST + (ARM_RAISED - ARM_REST) * up;
  out.rise = up * STANDING_RISE + bounce;
  out.armLeft = arm + wave;
  out.armRight = arm - wave * 0.8;
  out.sway = Math.sin(time * 1.6 + spectator.phase) * (0.04 + excitement * 0.05);
  return out;
}

/** The parts are merged as they are built, with their indices: a spectator is a few hundred triangles, six hundred times over. */
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const result = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (result === null) throw new Error("crowd geometry could not be merged");
  return result;
}

export function buildTorsoGeometry(): THREE.BufferGeometry {
  const chest = new THREE.CapsuleGeometry(0.16, 0.28, 2, 8);
  chest.scale(1.35, 1, 0.8);
  chest.translate(0, 0.64, 0);
  const shoulders = new THREE.CapsuleGeometry(0.078, 0.3, 1, 5);
  shoulders.rotateZ(Math.PI / 2);
  shoulders.translate(0, SHOULDER_HEIGHT - 0.01, 0);
  const lap = new THREE.CapsuleGeometry(0.11, 0.26, 1, 5);
  lap.rotateX(Math.PI / 2);
  lap.scale(1.7, 1, 1);
  lap.translate(0, 0.4, 0.17);
  return merged([chest, shoulders, lap]);
}

export function buildHeadGeometry(): THREE.BufferGeometry {
  const head = new THREE.SphereGeometry(0.105, 10, 6);
  head.rotateY(-Math.PI / 2);
  head.scale(0.92, 1.12, 1);
  head.translate(0, 1.12, 0.01);
  const neck = new THREE.CylinderGeometry(0.048, 0.056, 0.1, 5, 1, true);
  neck.translate(0, 0.99, 0);
  const neckUv = neck.getAttribute("uv");
  for (let index = 0; index < neckUv.count; index += 1) neckUv.setXY(index, 0.02, 0.02);
  return merged([head, neck]);
}

export function buildHairGeometry(): THREE.BufferGeometry {
  const hair = new THREE.SphereGeometry(0.112, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.52);
  hair.scale(0.95, 1.1, 1.04);
  hair.rotateX(-0.42);
  hair.translate(0, 1.128, -0.006);
  return hair;
}

/** One arm hanging from the shoulder at the origin. */
export function buildArmGeometry(): THREE.BufferGeometry {
  const arm = new THREE.CapsuleGeometry(0.046, 0.43, 2, 5);
  arm.translate(0, -0.25, 0);
  const hand = new THREE.SphereGeometry(0.048, 5, 3);
  hand.translate(0, -0.53, 0);
  return merged([arm, hand]);
}

/** A face for a head mapped with the seam at the back: eyes, brows and a mouth on white, tinted per spectator. */
export function faceTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 64, 32);
    ctx.fillStyle = "rgba(60,30,20,0.28)";
    ctx.fillRect(24, 9, 16, 10);
    ctx.fillStyle = "#2a1a14";
    ctx.fillRect(26.5, 13, 3.4, 1.8);
    ctx.fillRect(34.1, 13, 3.4, 1.8);
    ctx.fillStyle = "rgba(40,20,14,0.7)";
    ctx.fillRect(26, 11, 4.4, 1);
    ctx.fillRect(33.6, 11, 4.4, 1);
    ctx.fillStyle = "rgba(90,30,28,0.75)";
    ctx.fillRect(29, 20.5, 6, 1.4);
    ctx.fillStyle = "rgba(60,30,20,0.35)";
    ctx.fillRect(31.2, 14.5, 1.6, 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Stepped stands: a floor for every row and a parapet in front of it that hides the legs. */
export function buildStandsGeometry(tiers: readonly CrowdTier[]): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = [];
  let floor = ARENA_FLOOR;
  for (const tier of tiers) {
    const front = tier.radius - PARAPET_SETBACK;
    profile.push(new THREE.Vector2(front, floor), new THREE.Vector2(front, tier.y + PARAPET_HEIGHT), new THREE.Vector2(front + 0.12, tier.y + PARAPET_HEIGHT), new THREE.Vector2(front + 0.12, tier.y));
    floor = tier.y;
  }
  const last = tiers.at(-1)!;
  profile.push(new THREE.Vector2(last.radius + 1.4, last.y), new THREE.Vector2(last.radius + 1.4, last.y + 3));
  return new THREE.LatheGeometry(profile, 72);
}

export interface BuiltCrowd {
  readonly group: THREE.Group;
  readonly spectators: readonly Spectator[];
  readonly update: (time: number, excitement: number, everyone?: boolean) => void;
  /** At the low quality tier the crowd moves a quarter at a time and drops the arms, which are a third of its triangles. */
  readonly setLowTier: (low: boolean) => void;
  /**
   * Clears the seats on the broadcast camera's platform while the camera stands there (see `cameraOnPlatform`),
   * and fills them again for every other shot, which may look into that part of the stands.
   */
  readonly makeRoomForCamera: (camera: { readonly x: number; readonly z: number }) => void;
  readonly dispose: () => void;
}

export function buildCrowd(rand: () => number, tiers: readonly CrowdTier[] = CROWD_TIERS): BuiltCrowd {
  const group = new THREE.Group();
  group.name = "crowd";
  const spectators = seatSpectators(tiers, rand);
  const total = spectators.length;
  const face = faceTexture();
  const geometries = [buildTorsoGeometry(), buildHeadGeometry(), buildHairGeometry(), buildArmGeometry(), buildStandsGeometry(tiers)] as const;
  const cloth = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, emissive: 0xffffff, emissiveIntensity: HOUSE_LIGHT });
  const skin = new THREE.MeshStandardMaterial({ map: face, emissiveMap: face, roughness: 0.75, metalness: 0, emissive: 0xffffff, emissiveIntensity: HOUSE_LIGHT });
  const hairMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, emissive: 0xffffff, emissiveIntensity: HOUSE_LIGHT });
  for (const material of [cloth, skin, hairMaterial]) {
    // The ring's lights fall off before the stands, so the spill from the rig over the ring is
    // drawn as a glow in each spectator's own colours, shaded by which way the surface faces.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vCrowdLight;")
        .replace("#include <project_vertex>", `#include <project_vertex>\n${SPILL_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vCrowdLight;")
        .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${SPILL_FRAGMENT}`);
    };
    material.customProgramCacheKey = () => "hands-crowd";
  }
  const concrete = new THREE.MeshStandardMaterial({ color: 0x0b0e15, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
  const torsos = new THREE.InstancedMesh(geometries[0], cloth, total);
  const heads = new THREE.InstancedMesh(geometries[1], skin, total);
  const hair = new THREE.InstancedMesh(geometries[2], hairMaterial, total);
  const armsLeft = new THREE.InstancedMesh(geometries[3], cloth, total);
  const armsRight = new THREE.InstancedMesh(geometries[3], cloth, total);
  const meshes = [torsos, heads, hair, armsLeft, armsRight];
  const bodies = [torsos, heads, hair];
  for (const mesh of meshes) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
  }
  const color = new THREE.Color();
  for (let index = 0; index < total; index += 1) {
    const light = spectators[index]!.light;
    color.setHex(SHIRT_COLORS[Math.floor(rand() * SHIRT_COLORS.length)]!).multiplyScalar((0.75 + rand() * 0.5) * light);
    torsos.setColorAt(index, color);
    armsLeft.setColorAt(index, color);
    armsRight.setColorAt(index, color);
    color.setHex(SKIN_COLORS[Math.floor(rand() * SKIN_COLORS.length)]!).multiplyScalar((0.85 + rand() * 0.35) * light);
    heads.setColorAt(index, color);
    if (rand() > 0.12) color.setHex(HAIR_COLORS[Math.floor(rand() * HAIR_COLORS.length)]!).multiplyScalar((0.8 + rand() * 0.4) * light);
    hair.setColorAt(index, color);
  }
  for (const mesh of meshes) mesh.instanceColor!.needsUpdate = true;
  const stands = new THREE.Mesh(geometries[4], concrete);
  stands.name = "stands";
  stands.receiveShadow = false;
  group.add(stands, ...meshes);

  const up = new THREE.Vector3(0, 1, 0);
  const position = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const body = new THREE.Matrix4();
  const limb = new THREE.Matrix4();
  const shoulder = new THREE.Matrix4();
  const swing = new THREE.Matrix4();
  const pose: SpectatorPose = { rise: 0, armLeft: 0, armRight: 0, sway: 0 };
  const hang = (mesh: THREE.InstancedMesh, index: number, side: number, angle: number): void => {
    shoulder.makeTranslation(side * SHOULDER_HALF_WIDTH, SHOULDER_HEIGHT, 0);
    swing.makeRotationX(angle);
    limb.multiplyMatrices(body, shoulder).multiply(swing);
    mesh.setMatrixAt(index, limb);
  };
  let pass = 0;
  let lowTier = false;
  let refreshAll = false;
  let platformClear = false;
  let poseTime = 0;
  let poseExcitement = 0;
  const platformSeats = spectators.flatMap((spectator, index) => (spectator.platform ? [index] : []));
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const place = (index: number, armed: boolean): void => {
    const spectator = spectators[index]!;
    if (platformClear && spectator.platform) {
      for (const mesh of armed ? meshes : bodies) mesh.setMatrixAt(index, hidden);
      return;
    }
    spectatorPose(spectator, poseTime, poseExcitement, pose);
    turn.setFromAxisAngle(up, spectator.yaw + pose.sway);
    body.compose(position.set(spectator.x, spectator.y + pose.rise * spectator.scale, spectator.z), turn, size.setScalar(spectator.scale));
    torsos.setMatrixAt(index, body);
    heads.setMatrixAt(index, body);
    hair.setMatrixAt(index, body);
    if (armed) {
      hang(armsLeft, index, 1, pose.armLeft);
      hang(armsRight, index, -1, pose.armRight);
    }
  };
  // Half the crowd moves on each call (a quarter at the low tier), which cannot be seen, and only the
  // block that moved is uploaded.
  const update = (time: number, excitement: number, everyone = false): void => {
    const all = everyone || refreshAll;
    refreshAll = false;
    const parts = all ? 1 : lowTier ? 4 : 2;
    const block = Math.ceil(total / parts);
    const first = (pass % parts) * block;
    const last = Math.min(total, first + block);
    pass += 1;
    poseTime = time;
    poseExcitement = excitement;
    // A pass over everyone poses the arms too, even while the low tier hides them: reduced motion seats the
    // crowd once and then stops updating it, so arms left raised would come back floating over seated bodies.
    const armed = !lowTier || all;
    for (let index = first; index < last; index += 1) place(index, armed);
    for (const mesh of armed ? meshes : bodies) {
      const matrices = mesh.instanceMatrix;
      matrices.clearUpdateRanges();
      if (!all) matrices.addUpdateRange(first * 16, (last - first) * 16);
      matrices.needsUpdate = true;
    }
  };
  const setLowTier = (low: boolean): void => {
    if (low === lowTier) return;
    lowTier = low;
    armsLeft.visible = !low;
    armsRight.visible = !low;
    // Arms that were not moved while hidden catch up with everyone else at once.
    if (!low) refreshAll = true;
  };
  // Only at a cut: the seats on the platform are written at once, in the pose of the last update (reduced
  // motion stops updating the crowd), and the whole crowd is uploaded with them.
  const makeRoomForCamera = (camera: { readonly x: number; readonly z: number }): void => {
    const clear = cameraOnPlatform(camera.x, camera.z, platformClear ? CAMERA_PLATFORM_START - CAMERA_PLATFORM_LEAVE : CAMERA_PLATFORM_START);
    if (clear === platformClear) return;
    platformClear = clear;
    for (const index of platformSeats) place(index, true);
    for (const mesh of meshes) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  update(0, 0, true);

  const dispose = (): void => {
    for (const geometry of geometries) geometry.dispose();
    for (const material of [cloth, skin, hairMaterial, concrete]) material.dispose();
    face.dispose();
    for (const mesh of meshes) mesh.dispose();
  };
  return { group, spectators, update, setLowTier, makeRoomForCamera, dispose };
}
