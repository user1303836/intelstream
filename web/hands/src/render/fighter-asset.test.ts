import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import markerData from "../assets/fighter-markers.json";
import { FIGHTER_TEXTURE_DATA_URLS } from "../assets/fighter-textures";
import { BONE_ADAPTER, CLIP_NAMES, FIGHTER_MODEL_SCALE, type ClipName, loadBoxerGlb } from "./graph";

const EXPECTED_FRAMES: Readonly<Record<ClipName, number>> = {
  idle: 60,
  move_forward: 24,
  move_backward: 24,
  move_lateral: 24,
  guard_high: 30,
  guard_low: 30,
  jab_left: 17,
  jab_right: 17,
  straight_left: 22,
  straight_right: 22,
  hook_left: 26,
  hook_right: 26,
  uppercut_left: 27,
  uppercut_right: 27,
  block_head: 14,
  hit_head: 16,
  knockdown: 42,
  getup: 30,
};

function sourceJson(bytes: Buffer): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  expect(view.getUint32(4, true)).toBe(2);
  expect(view.getUint32(16, true)).toBe(0x4e4f534a);
  return JSON.parse(bytes.subarray(20, 20 + view.getUint32(12, true)).toString("utf8")) as Record<string, unknown>;
}

function skinnedMeshes(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) meshes.push(object);
  });
  return meshes;
}

function updateSkin(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  for (const mesh of skinnedMeshes(root)) mesh.skeleton.update();
}

function sampledVertices(root: THREE.Object3D): THREE.Vector3[] {
  updateSkin(root);
  const result: THREE.Vector3[] = [];
  for (const mesh of skinnedMeshes(root)) {
    const count = mesh.geometry.getAttribute("position").count;
    const step = Math.max(1, Math.floor(count / 32));
    for (let index = 0; index < count; index += step) {
      const point = mesh.getVertexPosition(index, new THREE.Vector3());
      result.push(mesh.localToWorld(point));
    }
  }
  return result;
}

function maximumDisplacement(left: readonly THREE.Vector3[], right: readonly THREE.Vector3[]): number {
  return Math.max(...left.map((point, index) => point.distanceTo(right[index]!)));
}

function poseAt(gltf: Awaited<ReturnType<typeof loadBoxerGlb>>, clipName: ClipName, time: number): THREE.Object3D {
  const root = cloneSkeleton(gltf.scene);
  const mixer = new THREE.AnimationMixer(root);
  const clip = THREE.AnimationClip.findByName(gltf.animations, clipName)!;
  mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play().clampWhenFinished = true;
  mixer.setTime(Math.min(time, clip.duration));
  updateSkin(root);
  return root;
}

describe("Texel Boxer source asset", () => {
  it("pins official provenance, license, and structural inventory", () => {
    const bytes = readFileSync(resolve(process.cwd(), "assets-src/Boxer.glb"));
    expect(bytes.byteLength).toBe(3_216_472);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe("545be2380b259698ca3ae864bba2b00a54aaaf987fd0837b8dde65cc18da3961");
    const gltf = sourceJson(bytes) as {
      asset: { version: string; extras: Record<string, string> };
      nodes: unknown[];
      meshes: unknown[];
      skins: { joints: number[] }[];
      materials: { name: string }[];
      images: unknown[];
      animations: { name: string }[];
      extensionsRequired?: string[];
    };
    expect(gltf.asset.version).toBe("2.0");
    expect(gltf.asset.extras).toMatchObject({
      author: "Texel, Inc. (https://sketchfab.com/texel)",
      license: "CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)",
      source: "https://sketchfab.com/3d-models/boxer-84767168720948b38728ff78ee6f6090",
      title: "Boxer",
    });
    expect(gltf.extensionsRequired ?? []).toEqual([]);
    expect(gltf.nodes).toHaveLength(48);
    expect(gltf.meshes).toHaveLength(5);
    expect(gltf.skins).toHaveLength(1);
    expect(gltf.skins[0]!.joints).toHaveLength(27);
    expect(gltf.materials.map((material) => material.name)).toEqual([
      "MHeadMat0", "GlovesMat0", "MBodyMat0", "ShoesMat0", "PantsMat0",
    ]);
    expect(gltf.images).toHaveLength(5);
    expect(gltf.animations.map((animation) => animation.name)).toEqual(["Animation"]);
  });

  it("pins extracted PNG dimensions, bytes, hashes, and runtime scale", () => {
    const expected = {
      head: [1024, 1024, 1_118_400, "e2f99ac2fc9332f250180492ad3dd1d70bef2872fd7da3587fc3e94d7850dbd0"],
      gloves: [256, 256, 57_215, "3e9b08a173fa288ddfd61b1d5662eb5c4fcdbe0174d72494fa1ed789b3b3c9e4"],
      body: [1024, 1024, 610_245, "cbfd4d637b6b8e8ee12b5dabb6e17eb087a7ca9352c982cf7176bfc673234416"],
      shoes: [256, 256, 78_886, "f1d0449390f23cd815d7009b64a0b8c3f9f4c5e1498ab5c624c90def72d0e012"],
      pants: [512, 512, 93_952, "7da721303a0c25d6192338298d7efcc43193a73d7e61494c2c45036f2a885a90"],
    } as const;
    expect(Object.keys(FIGHTER_TEXTURE_DATA_URLS)).toEqual(Object.keys(expected));
    for (const [name, [width, height, byteLength, sha256]] of Object.entries(expected)) {
      const dataUrl = FIGHTER_TEXTURE_DATA_URLS[name as keyof typeof FIGHTER_TEXTURE_DATA_URLS];
      expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
      const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(bytes.readUInt32BE(16)).toBe(width);
      expect(bytes.readUInt32BE(20)).toBe(height);
      expect(bytes.byteLength).toBe(byteLength);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
    }
    expect(FIGHTER_MODEL_SCALE).toBe(0.96);
  });
});

describe("generated fighter animation asset", () => {
  it("leaves facing and stance yaw to the runtime root", async () => {
    const gltf = await loadBoxerGlb();
    const hipsName = BONE_ADAPTER.hips!;
    const hips = gltf.scene.getObjectByName(hipsName)!;
    const idle = gltf.animations.find((clip) => clip.name === "idle")!;
    const track = idle.tracks.find((candidate) => candidate.name === `${hipsName}.quaternion`)!;
    const firstPose = new THREE.Quaternion().fromArray(track.values, 0);
    expect(hips.quaternion.angleTo(firstPose)).toBeLessThan(0.08);
  });

  it("has five smoothly skinned semantic parts with normalized weights", async () => {
    const gltf = await loadBoxerGlb();
    const meshes = skinnedMeshes(gltf.scene);
    expect(meshes.map((mesh) => mesh.name)).toEqual([
      "BoxerHead", "BoxerGloves", "BoxerBody", "BoxerShoes", "BoxerPants",
    ]);
    expect(meshes.map((mesh) => (mesh.material as THREE.Material).name)).toEqual([
      "MHeadMat0", "GlovesMat0", "MBodyMat0", "ShoesMat0", "PantsMat0",
    ]);
    let blendedVertices = 0;
    for (const mesh of meshes) {
      const joints = mesh.geometry.getAttribute("skinIndex");
      const weights = mesh.geometry.getAttribute("skinWeight");
      expect(joints.count).toBe(weights.count);
      expect(mesh.skeleton.bones).toHaveLength(27);
      for (let index = 0; index < weights.count; index += 1) {
        const values = [weights.getX(index), weights.getY(index), weights.getZ(index), weights.getW(index)];
        expect(values.every(Number.isFinite)).toBe(true);
        expect(values.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 5);
        if (values.filter((value) => value > 0.0001).length > 1) blendedVertices += 1;
      }
    }
    expect(blendedVertices).toBeGreaterThan(8_000);
  });

  it.each(CLIP_NAMES)("validates every keyframe and real skin deformation in %s", async (clipName) => {
    const gltf = await loadBoxerGlb();
    const clip = THREE.AnimationClip.findByName(gltf.animations, clipName)!;
    const frames = EXPECTED_FRAMES[clipName];
    expect(clip.tracks).toHaveLength(17);
    expect(clip.duration).toBeCloseTo((frames - 1) / 30, 5);
    const expectedTargets = new Set([
      ...Object.values(BONE_ADAPTER).map((bone) => `${bone}.quaternion`),
      `${BONE_ADAPTER.hips}.position`,
    ]);
    expect(new Set(clip.tracks.map((track) => track.name))).toEqual(expectedTargets);
    for (const track of clip.tracks) {
      expect(track.times).toHaveLength(frames);
      expect(track.times[0]).toBeCloseTo(0, 7);
      expect(track.times[frames - 1]).toBeCloseTo((frames - 1) / 30, 5);
      expect([...track.values].every(Number.isFinite)).toBe(true);
      if (track.ValueTypeName === "quaternion") {
        for (let index = 0; index < track.values.length; index += 4) {
          expect(Math.hypot(...track.values.slice(index, index + 4))).toBeCloseTo(1, 5);
        }
      }
    }

    const root = cloneSkeleton(gltf.scene);
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    let baseline: THREE.Vector3[] | null = null;
    let maximum = 0;
    for (let frame = 0; frame < frames; frame += 1) {
      mixer.setTime(frame / 30);
      const vertices = sampledVertices(root);
      baseline ??= vertices.map((point) => point.clone());
      maximum = Math.max(maximum, maximumDisplacement(baseline, vertices));
      const bounds = new THREE.Box3().setFromObject(root, true);
      expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(bounds.max.y).toBeLessThan(2.1);
      const size = bounds.getSize(new THREE.Vector3());
      expect(Math.max(size.x, size.y, size.z)).toBeLessThan(3);
    }
    expect(maximum).toBeGreaterThan(0.002);
  });

  it("keeps guards, punches, knockdown, and get-up semantically distinct and continuous", async () => {
    const gltf = await loadBoxerGlb();
    const handPosition = (root: THREE.Object3D, side: "left" | "right"): THREE.Vector3 =>
      root.getObjectByName(side === "left" ? BONE_ADAPTER.gloveL! : BONE_ADAPTER.gloveR!)!.getWorldPosition(new THREE.Vector3());
    const high = poseAt(gltf, "guard_high", 0);
    const low = poseAt(gltf, "guard_low", 0);
    expect(handPosition(high, "left").y - handPosition(low, "left").y).toBeGreaterThan(0.12);
    expect(handPosition(high, "right").y - handPosition(low, "right").y).toBeGreaterThan(0.12);

    for (const clipName of CLIP_NAMES.filter((name) => /^(jab|straight|hook|uppercut)_/.test(name))) {
      const side = clipName.endsWith("_left") ? "left" : "right";
      const start = poseAt(gltf, clipName, 0);
      const contact = poseAt(gltf, clipName, THREE.AnimationClip.findByName(gltf.animations, clipName)!.duration * 0.5);
      expect(handPosition(start, side).distanceTo(handPosition(contact, side)), clipName).toBeGreaterThan(0.25);
    }

    const idleStart = poseAt(gltf, "idle", 0);
    const knockdownStart = poseAt(gltf, "knockdown", 0);
    const knockdownEnd = poseAt(gltf, "knockdown", 10);
    const getupStart = poseAt(gltf, "getup", 0);
    const getupEnd = poseAt(gltf, "getup", 10);
    const head = (root: THREE.Object3D): THREE.Vector3 => root.getObjectByName(BONE_ADAPTER.head!)!.getWorldPosition(new THREE.Vector3());
    expect(head(idleStart).distanceTo(head(knockdownStart))).toBeLessThan(0.04);
    expect(head(knockdownEnd).distanceTo(head(getupStart))).toBeLessThan(0.04);
    expect(head(getupEnd).distanceTo(head(idleStart))).toBeLessThan(0.04);
    expect(head(knockdownEnd).y).toBeLessThan(head(idleStart).y - 0.8);
  });

  it("matches every generated punch marker to its live glove bone", async () => {
    const gltf = await loadBoxerGlb();
    const trajectories = markerData.trajectories as Record<string, { frames: number; left: number[][]; right: number[][] }>;
    for (const clipName of CLIP_NAMES.filter((name) => /^(jab|straight|hook|uppercut)_/.test(name))) {
      const [punchClass, side] = clipName.split("_") as [string, "left" | "right"];
      const trajectory = trajectories[`${punchClass}:${side}`]!;
      const root = cloneSkeleton(gltf.scene);
      const mixer = new THREE.AnimationMixer(root);
      const clip = THREE.AnimationClip.findByName(gltf.animations, clipName)!;
      const action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      expect(trajectory.frames).toBe(EXPECTED_FRAMES[clipName]);
      const markers = side === "left" ? trajectory.left : trajectory.right;
      expect(markers).toHaveLength(trajectory.frames);
      for (let frame = 0; frame < trajectory.frames; frame += 1) {
        mixer.setTime(frame / 30);
        root.updateMatrixWorld(true);
        const glove = root.getObjectByName(side === "left" ? BONE_ADAPTER.gloveL! : BONE_ADAPTER.gloveR!)!
          .getWorldPosition(new THREE.Vector3());
        expect(glove.distanceTo(new THREE.Vector3().fromArray(markers[frame]!)), `${clipName} frame ${frame}`).toBeLessThan(0.001);
      }
    }
  });

});
