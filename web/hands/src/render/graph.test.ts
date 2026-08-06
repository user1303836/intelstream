import * as THREE from "three";
import { BoxingGraph, CLIP_NAMES, SkinnedBoxer, aimBoneLocal, loadBoxerGlb } from "./graph";
import { worldMapping } from "./world";
import { fighter } from "../test/fixtures";
import type { FighterSnapshot } from "../types";

const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 330 });

const withAction = (
  base: FighterSnapshot,
  action: "jab" | "straight",
  id: string,
  startTick: number,
  startup = 3,
  active = 2,
  recovery = 8,
): FighterSnapshot => ({
  ...base,
  action,
  action_hand: "left",
  action_target: "head",
  action_power: "normal",
  action_id: id,
  action_key: `${action}:left:head:normal`,
  action_start_tick: startTick,
  action_startup_ticks: startup,
  action_active_ticks: active,
  action_recovery_ticks: recovery,
  action_contact_tick: null,
});

describe("skinned GLB humanoid and animation graph", () => {
  it("loads the embedded GLB with the full clip set and skeleton", async () => {
    const gltf = await loadBoxerGlb();
    expect(gltf.animations.map((clip) => clip.name).sort()).toEqual([...CLIP_NAMES].sort());
    let skinned = 0;
    const boneNames = new Set<string>();
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) skinned += 1;
      if (object instanceof THREE.Bone) boneNames.add(object.name);
    });
    expect(skinned).toBe(6);
    for (const name of ["hips", "spine", "chest", "head", "upperarml", "lowerarml", "wristl", "upperlegl", "lowerlegl", "footl"]) {
      expect(boneNames.has(name), name).toBe(true);
    }
  });

  it("drives locomotion blending and committed punch playback with phase locking", async () => {
    const gltf = await loadBoxerGlb();
    const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
    const graph = new BoxingGraph(boxer, mapping);
    const two = fighter("two");
    for (let i = 0; i < 20; i += 1) graph.update(fighter("one"), two, 1 / 60, i / 60, false, "full", i / 2);
    const idleAction = boxer.actions.get("idle")!;
    expect(idleAction.getEffectiveWeight()).toBeGreaterThan(0.8);

    const moving = { ...fighter("one"), velocity_x: 6 };
    for (let i = 0; i < 40; i += 1) graph.update(moving, two, 1 / 60, 1 + i / 60, false, "full", 10 + i / 2);
    expect(boxer.actions.get("move_forward")!.getEffectiveWeight()).toBeGreaterThan(0.6);

    const punching = withAction(fighter("one"), "jab", "a1", 30, 3, 2, 8);
    for (let i = 0; i < 12; i += 1) graph.update(punching, two, 1 / 60, 2 + i / 60, false, "full", 30 + Math.floor(i / 2));
    const jab = boxer.actions.get("jab_left")!;
    expect(jab.isRunning()).toBe(true);
    expect(jab.time).toBeGreaterThan(0.12);
    expect(jab.time).toBeLessThan(0.3);
    boxer.dispose();
  });

  it("restarts identical actions on new instance ids and locks phase to start ticks", async () => {
    const gltf = await loadBoxerGlb();
    const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
    const graph = new BoxingGraph(boxer, mapping);
    const two = fighter("two");
    const first = withAction(fighter("one"), "jab", "a1", 0, 3, 2, 8);
    for (let i = 0; i < 10; i += 1) graph.update(first, two, 1 / 60, i / 60, false, "full", Math.floor(i / 2));
    const jab = boxer.actions.get("jab_left")!;
    const timeBefore = jab.time;
    expect(timeBefore).toBeGreaterThan(0.05);
    const second = withAction(fighter("one"), "jab", "a2", 6, 3, 2, 8);
    graph.update(second, two, 1 / 60, 12 / 60, false, "full", 6);
    expect(jab.time).toBeLessThan(timeBefore);
    boxer.dispose();
  });

  it("plays knockdown and getup states and reaction clips on contact", async () => {
    const gltf = await loadBoxerGlb();
    const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
    const graph = new BoxingGraph(boxer, mapping);
    const two = fighter("two");
    const downed = { ...fighter("one"), is_downed: true };
    for (let i = 0; i < 30; i += 1) graph.update(downed, two, 1 / 60, i / 60, false, "full", i / 2);
    expect(boxer.actions.get("knockdown")!.isRunning()).toBe(true);
    graph.react("hit");
    expect(boxer.actions.get("hit_head")!.isRunning()).toBe(true);
    for (let i = 0; i < 90; i += 1) graph.update(fighter("one"), two, 1 / 60, 1 + i / 60, false, "full", 20 + i / 2);
    expect(boxer.actions.get("knockdown")!.isRunning()).toBe(false);
    boxer.dispose();
  });
});

it("keeps fighters independent: one animating does not move or restyle the other", async () => {
  const gltf = await loadBoxerGlb();
  const boxerA = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
  const boxerB = new SkinnedBoxer(gltf, { skin: 0x6e4128, gear: 0xb91c1c });
  const graphA = new BoxingGraph(boxerA, mapping);
  const graphB = new BoxingGraph(boxerB, mapping);
  const two = fighter("two");
  const punching = withAction(fighter("one"), "jab", "shared-1", 0, 3, 2, 8);
  for (let i = 0; i < 10; i += 1) {
    graphA.update(punching, two, 1 / 60, i / 60, false, "full", Math.floor(i / 2));
    graphB.update(fighter("two"), fighter("one"), 1 / 60, i / 60, false, "full", Math.floor(i / 2));
  }
  expect(boxerA.actions.get("jab_left")!.isRunning()).toBe(true);
  expect(boxerB.actions.get("jab_left")!.isRunning()).toBe(false);
  const headA = boxerA.bone("head")!.getWorldPosition(new THREE.Vector3());
  const headB = boxerB.bone("head")!.getWorldPosition(new THREE.Vector3());
  expect(headB.distanceTo(headA)).toBeGreaterThan(0);
  boxerA.gloveGear.color.setHex(0x101010);
  expect(boxerB.gloveGear.color.getHex()).toBe(new THREE.Color(0xb91c1c).getHex());
  boxerA.dispose();
  boxerB.dispose();
});

it("embedded GLB matches its recorded sha256", async () => {
  const { createHash } = await import("node:crypto");
  const { FIGHTER_GLB_BASE64, FIGHTER_GLB_SHA256 } = await import("../assets/fighter-glb");
  expect(createHash("sha256").update(FIGHTER_GLB_BASE64).digest("hex")).toBe(FIGHTER_GLB_SHA256);
});

it("aiming a bone at its child's current position is a no-op (+Y rig convention)", async () => {
  const gltf = await loadBoxerGlb();
  const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
  new BoxingGraph(boxer, mapping);
  boxer.root.updateMatrixWorld(true);
  const shoulder = boxer.bone("shoulderL")!;
  const elbow = boxer.bone("elbowL")!;
  const elbowBefore = elbow.getWorldPosition(new THREE.Vector3());
  const shoulderPos = shoulder.getWorldPosition(new THREE.Vector3());
  aimBoneLocal(shoulder, shoulderPos, elbowBefore.clone());
  boxer.root.updateMatrixWorld(true);
  const elbowAfter = elbow.getWorldPosition(new THREE.Vector3());
  expect(elbowAfter.distanceTo(elbowBefore)).toBeLessThan(0.01);
  boxer.dispose();
});
