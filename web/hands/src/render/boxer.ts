import * as THREE from "three";
import type { FighterPalette } from "./world";

export interface BoxerRig {
  readonly root: THREE.Group;
  readonly hips: THREE.Group;
  readonly spine: THREE.Group;
  readonly chest: THREE.Group;
  readonly head: THREE.Group;
  readonly shoulderL: THREE.Group;
  readonly elbowL: THREE.Group;
  readonly gloveL: THREE.Group;
  readonly shoulderR: THREE.Group;
  readonly elbowR: THREE.Group;
  readonly gloveR: THREE.Group;
  readonly hipL: THREE.Group;
  readonly kneeL: THREE.Group;
  readonly ankleL: THREE.Group;
  readonly hipR: THREE.Group;
  readonly kneeR: THREE.Group;
  readonly ankleR: THREE.Group;
  readonly chestMesh: THREE.Mesh;
  readonly headMesh: THREE.Mesh;
  readonly browL: THREE.Mesh;
  readonly browR: THREE.Mesh;
  readonly bruiseL: THREE.Mesh;
  readonly bruiseR: THREE.Mesh;
  readonly bodyBruise: THREE.Mesh;
  readonly cutL: THREE.Mesh;
  readonly cutR: THREE.Mesh;
  readonly swellL: THREE.Mesh;
  readonly swellR: THREE.Mesh;
  readonly cheekL: THREE.Mesh;
  readonly cheekR: THREE.Mesh;
  readonly streakL: THREE.Mesh;
  readonly streakR: THREE.Mesh;
  readonly noseStreak: THREE.Mesh;
  readonly mouthBlood: THREE.Mesh;
  readonly ribL: THREE.Mesh;
  readonly ribR: THREE.Mesh;
  readonly gloveLMesh: THREE.Mesh;
  readonly gloveRMesh: THREE.Mesh;
  readonly gloveLMaterial: THREE.MeshStandardMaterial;
  readonly gloveRMaterial: THREE.MeshStandardMaterial;
  readonly gloveBaseColor: THREE.Color;
  readonly skinMaterial: THREE.MeshPhysicalMaterial;
  readonly materials: readonly THREE.Material[];
  readonly geometries: readonly THREE.BufferGeometry[];
}

const UPPER_ARM = 0.3;
const FOREARM = 0.3;
export const ARM_LENGTHS = { upper: UPPER_ARM, fore: FOREARM } as const;

function capsule(radius: number, length: number, material: THREE.Material, geometries: THREE.BufferGeometry[]): THREE.Mesh {
  const geometry = new THREE.CapsuleGeometry(radius, length, 6, 14);
  geometries.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function sphere(radius: number, material: THREE.Material, geometries: THREE.BufferGeometry[], width = 18, height = 14): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, width, height);
  geometries.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

function box(width: number, height: number, depth: number, material: THREE.Material, geometries: THREE.BufferGeometry[]): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometries.push(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}

let sharedSkinBump: THREE.CanvasTexture | null = null;

function skinBumpTexture(): THREE.CanvasTexture {
  if (sharedSkinBump !== null) return sharedSkinBump;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx !== null) {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, 128, 128);
    let seed = 55_444_333;
    for (let i = 0; i < 2600; i += 1) {
      seed = (seed * 16_807) % 2_147_483_647;
      const x = seed % 128;
      seed = (seed * 16_807) % 2_147_483_647;
      const y = seed % 128;
      const shade = 108 + (seed % 40);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(x, y, 1 + (seed % 2), 1);
    }
  }
  sharedSkinBump = new THREE.CanvasTexture(canvas);
  sharedSkinBump.wrapS = THREE.RepeatWrapping;
  sharedSkinBump.wrapT = THREE.RepeatWrapping;
  sharedSkinBump.repeat.set(3, 3);
  return sharedSkinBump;
}

export function buildBoxer(palette: FighterPalette): BoxerRig {
  const geometries: THREE.BufferGeometry[] = [];
  const skin = new THREE.MeshPhysicalMaterial({ color: palette.skin, roughness: 0.58, metalness: 0.02, clearcoat: 0.25, clearcoatRoughness: 0.6, sheen: 0.3, sheenColor: new THREE.Color(0xd9a98c), sheenRoughness: 0.55, bumpMap: skinBumpTexture(), bumpScale: 0.0015 });
  const skinDark = new THREE.MeshStandardMaterial({ color: palette.skinShadow, roughness: 0.58, metalness: 0.02 });
  const trunks = new THREE.MeshStandardMaterial({ color: palette.trunks, roughness: 0.34, metalness: 0.05 });
  const trim = new THREE.MeshStandardMaterial({ color: palette.trunkTrim, roughness: 0.4, metalness: 0.1 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: palette.glove, roughness: 0.28, metalness: 0.04 });
  const gloveTrimMat = new THREE.MeshStandardMaterial({ color: palette.gloveTrim, roughness: 0.45 });
  const hairMat = new THREE.MeshStandardMaterial({ color: palette.hair, roughness: 0.72 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: palette.shoe, roughness: 0.5 });
  const bruiseMat = new THREE.MeshStandardMaterial({ color: 0x4a1c56, roughness: 0.9, transparent: true, opacity: 0 });
  const bruiseMatR = bruiseMat.clone();
  const bodyBruiseMat = bruiseMat.clone();
  const cutMat = new THREE.MeshStandardMaterial({ color: 0x7f0d14, roughness: 0.6, transparent: true, opacity: 0, emissive: 0x2a0306 });
  const cutMatR = cutMat.clone();
  const swellMat = new THREE.MeshStandardMaterial({ color: 0x6b3572, roughness: 0.75, transparent: true, opacity: 0 });
  const swellMatR = swellMat.clone();
  const cheekMat = swellMat.clone();
  const cheekMatR = swellMat.clone();
  const streakMat = new THREE.MeshStandardMaterial({ color: 0x8a0f16, roughness: 0.35, transparent: true, opacity: 0, emissive: 0x30040a });
  const streakMatR = streakMat.clone();
  const noseStreakMat = streakMat.clone();
  const mouthMat = streakMat.clone();
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x5c2450, roughness: 0.85, transparent: true, opacity: 0 });
  const ribMatR = ribMat.clone();
  const materials = [skin, skinDark, trunks, trim, gloveMat, gloveTrimMat, hairMat, shoeMat, bruiseMat, bruiseMatR, bodyBruiseMat, cutMat, cutMatR, swellMat, swellMatR, cheekMat, cheekMatR, streakMat, streakMatR, noseStreakMat, mouthMat, ribMat, ribMatR];

  const root = new THREE.Group();
  root.name = "boxer";

  const hips = new THREE.Group();
  hips.name = "hips";
  hips.position.y = 0.98;
  root.add(hips);

  const pelvis = capsule(0.145, 0.1, trunks, geometries);
  pelvis.scale.set(1.18, 1, 0.88);
  pelvis.position.y = 0.02;
  hips.add(pelvis);
  const waistband = new THREE.Mesh(new THREE.CylinderGeometry(0.168, 0.172, 0.035, 18), trim);
  geometries.push(waistband.geometry);
  waistband.scale.set(1.05, 1, 0.82);
  waistband.position.y = 0.1;
  waistband.castShadow = true;
  hips.add(waistband);

  const spine = new THREE.Group();
  spine.name = "spine";
  spine.position.y = 0.1;
  hips.add(spine);

  const chest = new THREE.Group();
  chest.name = "chest";
  spine.add(chest);

  const torsoProfile: Array<[number, number]> = [
    [0.138, -0.13], [0.146, -0.07], [0.134, 0.0], [0.148, 0.06], [0.172, 0.14],
    [0.19, 0.22], [0.186, 0.3], [0.152, 0.36], [0.102, 0.42], [0.062, 0.46],
  ];
  const torsoGeo = new THREE.LatheGeometry(torsoProfile.map(([r, y]) => new THREE.Vector2(r, y)), 24);
  geometries.push(torsoGeo);
  const chestMesh = new THREE.Mesh(torsoGeo, skin);
  chestMesh.scale.set(1.28, 1, 0.8);
  chestMesh.castShadow = true;
  chest.add(chestMesh);
  const pecL = sphere(0.062, skin, geometries);
  pecL.scale.set(1.05, 0.62, 0.42);
  pecL.position.set(0.085, 0.26, 0.125);
  chest.add(pecL);
  const pecR = pecL.clone();
  pecR.position.x = -0.085;
  chest.add(pecR);
  const deltL = sphere(0.075, skin, geometries);
  deltL.scale.set(1.05, 1.1, 0.95);
  deltL.position.set(0.215, 0.315, 0);
  chest.add(deltL);
  const deltR = deltL.clone();
  deltR.position.x = -0.215;
  chest.add(deltR);

  const bodyBruise = sphere(0.1, bodyBruiseMat, geometries);
  bodyBruise.scale.set(1.05, 1.35, 0.55);
  bodyBruise.position.set(0.02, 0.05, 0.1);
  bodyBruise.castShadow = false;
  chest.add(bodyBruise);

  const trapL = box(0.13, 0.06, 0.1, skin, geometries);
  trapL.position.set(0.115, 0.4, -0.02);
  trapL.rotation.z = -0.5;
  chest.add(trapL);
  const trapR = box(0.13, 0.06, 0.1, skin, geometries);
  trapR.position.set(-0.115, 0.4, -0.02);
  trapR.rotation.z = 0.5;
  chest.add(trapR);

  const head = new THREE.Group();
  head.name = "head";
  head.position.y = 0.44;
  chest.add(head);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.09, 12), skinDark);
  geometries.push(neck.geometry);
  neck.position.y = 0.02;
  neck.castShadow = true;
  head.add(neck);
  const skullProfile: Array<[number, number]> = [
    [0.05, 0.02], [0.076, 0.05], [0.096, 0.08], [0.106, 0.13], [0.102, 0.18], [0.072, 0.23], [0.02, 0.26],
  ];
  const skullGeo = new THREE.LatheGeometry(skullProfile.map(([r, y]) => new THREE.Vector2(r, y)), 22);
  geometries.push(skullGeo);
  const headMesh = new THREE.Mesh(skullGeo, skin);
  headMesh.scale.set(0.92, 1.05, 0.95);
  headMesh.castShadow = true;
  head.add(headMesh);
  const jaw = sphere(0.085, skin, geometries, 16, 12);
  jaw.scale.set(0.85, 0.72, 0.9);
  jaw.position.set(0, 0.075, 0.028);
  head.add(jaw);
  const nose = box(0.032, 0.045, 0.035, skinDark, geometries);
  nose.position.set(0, 0.12, 0.112);
  head.add(nose);
  const noseBridge = box(0.022, 0.05, 0.02, skin, geometries);
  noseBridge.position.set(0, 0.16, 0.104);
  head.add(noseBridge);
  const lips = box(0.045, 0.012, 0.012, skinDark, geometries);
  lips.position.set(0, 0.062, 0.104);
  head.add(lips);
  const chin = sphere(0.04, skin, geometries, 12, 10);
  chin.scale.set(0.9, 0.75, 0.8);
  chin.position.set(0, 0.035, 0.07);
  head.add(chin);
  const cheekboneL = sphere(0.028, skin, geometries, 10, 8);
  cheekboneL.scale.set(1.1, 0.7, 0.8);
  cheekboneL.position.set(0.07, 0.11, 0.075);
  head.add(cheekboneL);
  const cheekboneR = cheekboneL.clone();
  cheekboneR.position.x = -0.07;
  head.add(cheekboneR);
  const browL = box(0.052, 0.016, 0.02, skinDark, geometries);
  browL.position.set(0.048, 0.165, 0.1);
  head.add(browL);
  const browR = browL.clone();
  browR.position.x = -0.048;
  head.add(browR);
  const earL = sphere(0.026, skinDark, geometries, 10, 8);
  earL.scale.set(0.5, 1, 0.75);
  earL.position.set(0.104, 0.125, 0.01);
  head.add(earL);
  const earR = earL.clone();
  earR.position.x = -0.104;
  head.add(earR);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.35 });
  materials.push(eyeMat);
  const eyeL = sphere(0.016, eyeMat, geometries, 8, 8);
  eyeL.position.set(0.045, 0.145, 0.102);
  head.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = -0.045;
  head.add(eyeR);
  const hair = sphere(0.118, hairMat, geometries, 20, 14);
  hair.scale.set(0.94, 0.98, 1);
  hair.position.set(0, 0.165, -0.018);
  head.add(hair);
  const hairline = sphere(0.112, hairMat, geometries, 18, 12);
  hairline.scale.set(0.9, 0.58, 0.95);
  hairline.position.set(0, 0.198, 0.012);
  head.add(hairline);

  const bruiseL = sphere(0.042, bruiseMat, geometries, 12, 10);
  bruiseL.scale.set(1, 0.72, 0.5);
  bruiseL.position.set(0.05, 0.15, 0.085);
  bruiseL.castShadow = false;
  head.add(bruiseL);
  const bruiseR = sphere(0.042, bruiseMatR, geometries, 12, 10);
  bruiseR.scale.set(1, 0.72, 0.5);
  bruiseR.position.set(-0.05, 0.15, 0.085);
  bruiseR.castShadow = false;
  head.add(bruiseR);
  const cutL = box(0.05, 0.008, 0.01, cutMat, geometries);
  cutL.position.set(0.05, 0.178, 0.104);
  cutL.castShadow = false;
  head.add(cutL);
  const cutR = box(0.05, 0.008, 0.01, cutMatR, geometries);
  cutR.position.set(-0.05, 0.178, 0.104);
  cutR.castShadow = false;
  head.add(cutR);

  const swellL = sphere(0.035, swellMat, geometries, 12, 10);
  swellL.position.set(0.052, 0.155, 0.088);
  swellL.castShadow = false;
  head.add(swellL);
  const swellR = sphere(0.035, swellMatR, geometries, 12, 10);
  swellR.position.set(-0.052, 0.155, 0.088);
  swellR.castShadow = false;
  head.add(swellR);
  const cheekL = sphere(0.028, cheekMat, geometries, 10, 8);
  cheekL.position.set(0.068, 0.095, 0.075);
  cheekL.castShadow = false;
  head.add(cheekL);
  const cheekR = sphere(0.028, cheekMatR, geometries, 10, 8);
  cheekR.position.set(-0.068, 0.095, 0.075);
  cheekR.castShadow = false;
  head.add(cheekR);
  const streakL = box(0.014, 0.1, 0.006, streakMat, geometries);
  streakL.position.set(0.052, 0.115, 0.106);
  streakL.castShadow = false;
  head.add(streakL);
  const streakR = box(0.014, 0.1, 0.006, streakMatR, geometries);
  streakR.position.set(-0.052, 0.115, 0.106);
  streakR.castShadow = false;
  head.add(streakR);
  const noseStreak = box(0.011, 0.07, 0.006, noseStreakMat, geometries);
  noseStreak.position.set(0.008, 0.075, 0.118);
  noseStreak.castShadow = false;
  head.add(noseStreak);
  const mouthBlood = box(0.03, 0.012, 0.006, mouthMat, geometries);
  mouthBlood.position.set(0.02, 0.052, 0.104);
  mouthBlood.castShadow = false;
  head.add(mouthBlood);

  const ribL = sphere(0.09, ribMat, geometries, 12, 10);
  ribL.scale.set(0.5, 1.2, 0.7);
  ribL.position.set(0.16, 0.08, 0.02);
  ribL.castShadow = false;
  chest.add(ribL);
  const ribR = sphere(0.09, ribMatR, geometries, 12, 10);
  ribR.scale.set(0.5, 1.2, 0.7);
  ribR.position.set(-0.16, 0.08, 0.02);
  ribR.castShadow = false;
  chest.add(ribR);

  const buildArm = (side: 1 | -1): { shoulder: THREE.Group; elbow: THREE.Group; glove: THREE.Group; gloveMesh: THREE.Mesh } => {
    const shoulder = new THREE.Group();
    shoulder.name = side === 1 ? "shoulderL" : "shoulderR";
    shoulder.position.set(0.215 * side, 0.315, 0);
    chest.add(shoulder);
    const upper = capsule(0.056, UPPER_ARM - 0.12, skin, geometries);
    upper.scale.set(1.16, 1, 1.16);
    upper.position.y = -UPPER_ARM / 2;
    shoulder.add(upper);
    const elbow = new THREE.Group();
    elbow.name = side === 1 ? "elbowL" : "elbowR";
    elbow.position.y = -UPPER_ARM;
    shoulder.add(elbow);
    const elbowJoint = sphere(0.048, skin, geometries, 12, 10);
    elbow.add(elbowJoint);
    const fore = capsule(0.048, FOREARM - 0.13, skin, geometries);
    fore.scale.set(1.1, 1, 0.92);
    fore.position.y = -FOREARM / 2 + 0.01;
    elbow.add(fore);
    const glove = new THREE.Group();
    glove.name = side === 1 ? "gloveL" : "gloveR";
    glove.position.y = -FOREARM;
    elbow.add(glove);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.062, 0.07, 12), gloveTrimMat);
    geometries.push(cuff.geometry);
    cuff.position.y = 0.01;
    cuff.castShadow = true;
    glove.add(cuff);
    const gloveMesh = sphere(0.088, gloveMat, geometries, 18, 14);
    gloveMesh.scale.set(1, 1.12, 1.3);
    gloveMesh.position.set(0, -0.05, 0.02);
    glove.add(gloveMesh);
    const thumb = sphere(0.032, gloveMat, geometries, 10, 8);
    thumb.position.set(-0.05 * side, -0.045, 0.075);
    glove.add(thumb);
    const lace = box(0.05, 0.008, 0.012, gloveTrimMat, geometries);
    lace.position.set(0, -0.028, 0.1);
    glove.add(lace);
    return { shoulder, elbow, glove, gloveMesh };
  };
  const armL = buildArm(1);
  const armR = buildArm(-1);

  const buildLeg = (side: 1 | -1): { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group } => {
    const hip = new THREE.Group();
    hip.name = side === 1 ? "hipL" : "hipR";
    hip.position.set(0.105 * side, -0.02, 0);
    hips.add(hip);
    const thigh = capsule(0.078, 0.24, skin, geometries);
    thigh.scale.set(1.14, 1, 1.08);
    thigh.position.y = -0.21;
    hip.add(thigh);
    const trunkLeg = capsule(0.092, 0.16, trunks, geometries);
    trunkLeg.position.y = -0.14;
    hip.add(trunkLeg);
    const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.096, 0.1, 0.03, 14), trim);
    geometries.push(hem.geometry);
    hem.position.y = -0.24;
    hem.castShadow = true;
    hip.add(hem);
    const knee = new THREE.Group();
    knee.name = side === 1 ? "kneeL" : "kneeR";
    knee.position.y = -0.44;
    hip.add(knee);
    const kneeJoint = sphere(0.06, skin, geometries, 12, 10);
    kneeJoint.scale.set(0.95, 1.05, 1);
    knee.add(kneeJoint);
    const shin = capsule(0.058, 0.24, skin, geometries);
    shin.scale.set(1.05, 1, 1.12);
    shin.position.y = -0.21;
    knee.add(shin);
    const ankle = new THREE.Group();
    ankle.name = side === 1 ? "ankleL" : "ankleR";
    ankle.position.y = -0.44;
    knee.add(ankle);
    const shoe = box(0.095, 0.075, 0.26, shoeMat, geometries);
    shoe.position.set(0, -0.035, 0.055);
    ankle.add(shoe);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 0.08, 10), shoeMat);
    geometries.push(sock.geometry);
    sock.position.y = 0.01;
    sock.castShadow = true;
    ankle.add(sock);
    return { hip, knee, ankle };
  };
  const legL = buildLeg(1);
  const legR = buildLeg(-1);

  return {
    root,
    hips,
    spine,
    chest,
    head,
    shoulderL: armL.shoulder,
    elbowL: armL.elbow,
    gloveL: armL.glove,
    shoulderR: armR.shoulder,
    elbowR: armR.elbow,
    gloveR: armR.glove,
    hipL: legL.hip,
    kneeL: legL.knee,
    ankleL: legL.ankle,
    hipR: legR.hip,
    kneeR: legR.knee,
    ankleR: legR.ankle,
    chestMesh,
    headMesh,
    browL,
    browR,
    bruiseL,
    bruiseR,
    bodyBruise,
    cutL,
    cutR,
    swellL,
    swellR,
    cheekL,
    cheekR,
    streakL,
    streakR,
    noseStreak,
    mouthBlood,
    ribL,
    ribR,
    gloveLMesh: armL.gloveMesh,
    gloveRMesh: armR.gloveMesh,
    gloveLMaterial: gloveMat,
    gloveRMaterial: gloveMat,
    gloveBaseColor: new THREE.Color(palette.glove),
    skinMaterial: skin,
    materials,
    geometries,
  };
}

const scratchS = new THREE.Vector3();
const scratchT = new THREE.Vector3();
const scratchDir = new THREE.Vector3();
const scratchBend = new THREE.Vector3();
const scratchElbow = new THREE.Vector3();
const scratchPole = new THREE.Vector3();
const downAxis = new THREE.Vector3(0, -1, 0);
const scratchClamped = new THREE.Vector3();

export function solveArm(shoulderWorld: THREE.Vector3, targetWorld: THREE.Vector3, pole: THREE.Vector3, out: { elbowWorld: THREE.Vector3; targetWorld: THREE.Vector3 }): void {
  const l1 = UPPER_ARM;
  const l2 = FOREARM + 0.06;
  scratchS.copy(shoulderWorld);
  scratchT.copy(targetWorld);
  scratchDir.subVectors(scratchT, scratchS);
  const distance = THREE.MathUtils.clamp(scratchDir.length(), 0.12, l1 + l2 - 0.015);
  scratchDir.normalize();
  const a = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
  const h = Math.sqrt(Math.max(0.0001, l1 * l1 - a * a));
  scratchPole.copy(pole).normalize();
  scratchBend.copy(scratchPole).addScaledVector(scratchDir, -scratchPole.dot(scratchDir));
  if (scratchBend.lengthSq() < 0.0001) scratchBend.set(0, -1, 0).addScaledVector(scratchDir, scratchDir.y);
  scratchBend.normalize();
  scratchElbow.copy(scratchS).addScaledVector(scratchDir, a).addScaledVector(scratchBend, h);
  out.elbowWorld.copy(scratchElbow);
  scratchClamped.copy(scratchS).addScaledVector(scratchDir, distance);
  out.targetWorld.copy(scratchClamped);
}

const boneDir = new THREE.Vector3();
const parentWorldQuat = new THREE.Quaternion();
const worldQuat = new THREE.Quaternion();

export function aimBone(joint: THREE.Object3D, fromWorld: THREE.Vector3, toWorld: THREE.Vector3, twist = 0): void {
  boneDir.subVectors(toWorld, fromWorld);
  if (boneDir.lengthSq() < 0.000001) return;
  boneDir.normalize();
  worldQuat.setFromUnitVectors(downAxis, boneDir);
  if (twist !== 0) {
    const twistQuat = new THREE.Quaternion().setFromAxisAngle(boneDir, twist);
    worldQuat.premultiply(twistQuat);
  }
  const parent = joint.parent;
  if (parent === null) {
    joint.quaternion.copy(worldQuat);
    return;
  }
  parent.getWorldQuaternion(parentWorldQuat);
  joint.quaternion.copy(parentWorldQuat.invert().multiply(worldQuat));
}

export function buildReferee(): BoxerRig {
  const palette = {
    skin: 0xc79b76,
    skinShadow: 0xa87c5c,
    trunks: 0x14161c,
    trunkTrim: 0x14161c,
    glove: 0xc79b76,
    gloveTrim: 0xe8e9ec,
    hair: 0x2b2320,
    shoe: 0x101114,
  } satisfies FighterPalette;
  const rig = buildBoxer(palette);
  const shirt = new THREE.MeshStandardMaterial({ color: 0xbfc5cf, roughness: 0.72 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.7 });
  const shirtTorso = new THREE.Mesh(new THREE.CapsuleGeometry(0.175, 0.24, 6, 14), shirt);
  shirtTorso.scale.set(1.28, 1, 0.85);
  shirtTorso.position.y = 0.15;
  shirtTorso.castShadow = true;
  rig.chest.add(shirtTorso);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.05, 12), shirt);
  collar.position.y = 0.42;
  rig.chest.add(collar);
  const bowtie = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.02), pants);
  bowtie.position.set(0, 0.4, 0.09);
  rig.chest.add(bowtie);
  const addedGeometries: THREE.BufferGeometry[] = [shirtTorso.geometry, collar.geometry, bowtie.geometry];
  for (const shoulder of [rig.shoulderL, rig.shoulderR]) {
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.062, 0.16, 4, 10), shirt);
    sleeve.position.y = -0.12;
    sleeve.castShadow = true;
    shoulder.add(sleeve);
    addedGeometries.push(sleeve.geometry);
  }
  for (const hip of [rig.hipL, rig.hipR]) {
    const pantLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.26, 4, 10), pants);
    pantLeg.position.y = -0.21;
    pantLeg.castShadow = true;
    hip.add(pantLeg);
    addedGeometries.push(pantLeg.geometry);
  }
  for (const knee of [rig.kneeL, rig.kneeR]) {
    const pantShin = new THREE.Mesh(new THREE.CapsuleGeometry(0.066, 0.26, 4, 10), pants);
    pantShin.position.y = -0.21;
    pantShin.castShadow = true;
    knee.add(pantShin);
    addedGeometries.push(pantShin.geometry);
  }
  (rig.geometries as THREE.BufferGeometry[]).push(...addedGeometries);
  (rig.materials as THREE.Material[]).push(shirt, pants);
  return rig;
}

export function disposeBoxer(rig: BoxerRig): void {
  for (const geometry of rig.geometries) geometry.dispose();
  for (const material of rig.materials) material.dispose();
}

