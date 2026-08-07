import * as THREE from "three";
import { FIGHTER_TEXTURE_DATA_URLS } from "../assets/fighter-textures";
import { BONE_ADAPTER, BoxingGraph, CLIP_NAMES, FIGHTER_MODEL_SCALE, SkinnedBoxer, aimBoneLocal, loadBoxerGlb } from "./graph";
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
    for (const name of Object.values(BONE_ADAPTER)) {
      expect(boneNames.has(name), name).toBe(true);
    }
    expect(boneNames.has("Neck_012"), "decapitation stump anchor").toBe(true);
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

    const movingLeft = { ...fighter("one"), velocity_y: -4 };
    for (let i = 0; i < 40; i += 1) graph.update(movingLeft, two, 1 / 60, 2 + i / 60, false, "full", 30 + i / 2);
    expect(boxer.actions.get("move_lateral_left")!.getEffectiveWeight()).toBeGreaterThan(0.6);
    expect(boxer.actions.get("move_lateral_right")!.getEffectiveWeight()).toBeLessThan(0.01);
    const movingRight = { ...fighter("one"), velocity_y: 4 };
    for (let i = 0; i < 40; i += 1) graph.update(movingRight, two, 1 / 60, 3 + i / 60, false, "full", 50 + i / 2);
    expect(boxer.actions.get("move_lateral_right")!.getEffectiveWeight()).toBeGreaterThan(0.6);
    expect(boxer.actions.get("move_lateral_left")!.getEffectiveWeight()).toBeLessThan(0.01);

    const punching = withAction(fighter("one"), "jab", "a1", 30, 3, 2, 8);
    for (let i = 0; i < 12; i += 1) graph.update(punching, two, 1 / 60, 2 + i / 60, false, "full", 30 + Math.floor(i / 2));
    const jab = boxer.actions.get("jab_left")!;
    expect(jab.getEffectiveWeight()).toBeCloseTo(1, 5);
    expect(jab.time).toBeGreaterThan(0.12);
    expect(jab.time).toBeLessThan(0.3);
    boxer.dispose();
  });

  it("scales gait blend and cadence through maximum legal X and Y velocities", async () => {
    const gltf = await loadBoxerGlb();
    const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
    const graph = new BoxingGraph(boxer, mapping);
    const opponent = fighter("two");
    const forwardSamples: Array<{ weight: number; rate: number }> = [];
    for (const [sample, velocity] of [1, 2, 6, 7].entries()) {
      const moving = { ...fighter("one"), velocity_x: velocity };
      for (let frame = 0; frame < 50; frame += 1) {
        graph.update(moving, opponent, 1 / 60, sample + frame / 60, false, "full", sample * 50 + frame / 2);
      }
      const action = boxer.actions.get("move_forward")!;
      forwardSamples.push({ weight: action.getEffectiveWeight(), rate: action.getEffectiveTimeScale() });
    }
    expect(forwardSamples[0]!.weight).toBeGreaterThan(0.1);
    expect(forwardSamples[0]!.weight).toBeLessThan(forwardSamples[1]!.weight);
    expect(forwardSamples[1]!.weight).toBeLessThan(forwardSamples[2]!.weight);
    expect(forwardSamples[0]!.rate).toBeLessThan(forwardSamples[1]!.rate);
    expect(forwardSamples[1]!.rate).toBeLessThan(forwardSamples[2]!.rate);
    expect(forwardSamples[2]!.rate).toBeLessThan(forwardSamples[3]!.rate);
    expect(forwardSamples[2]!.weight).toBeGreaterThan(0.95);
    expect(forwardSamples[3]!.weight).toBeGreaterThan(0.95);

    const lateralRates: number[] = [];
    for (const [sample, velocity] of [4, 7].entries()) {
      const moving = { ...fighter("one"), velocity_y: velocity };
      for (let frame = 0; frame < 50; frame += 1) {
        graph.update(moving, opponent, 1 / 60, 5 + sample + frame / 60, false, "full", 220 + sample * 50 + frame / 2);
      }
      const action = boxer.actions.get("move_lateral_right")!;
      expect(action.getEffectiveWeight()).toBeGreaterThan(0.95);
      lateralRates.push(action.getEffectiveTimeScale());
    }
    expect(lateralRates[0]!).toBeLessThan(lateralRates[1]!);
    expect(lateralRates[1]!).toBeLessThanOrEqual(1.5);
    boxer.dispose();
  });

  it("keeps low-stamina locomotion and authoritative guards visible", async () => {
    const gltf = await loadBoxerGlb();
    const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
    const graph = new BoxingGraph(boxer, mapping);
    const opponent = fighter("two");
    const exhausted = { ...fighter("one"), stamina: 60 };
    for (let frame = 0; frame < 30; frame += 1) {
      graph.update(exhausted, opponent, 1 / 60, frame / 60, false, "full", frame / 2);
    }
    expect(boxer.actions.get("exhausted")!.getEffectiveWeight()).toBeGreaterThan(0.95);

    const moving = { ...exhausted, velocity_x: 6 };
    for (let frame = 0; frame < 40; frame += 1) {
      graph.update(moving, opponent, 1 / 60, 1 + frame / 60, false, "full", 30 + frame / 2);
    }
    expect(boxer.actions.get("exhausted")!.getEffectiveWeight()).toBe(0);
    expect(boxer.actions.get("move_forward")!.getEffectiveWeight()).toBeGreaterThan(0.9);

    const guarding = { ...exhausted, defense: "guard_high" as const };
    for (let frame = 0; frame < 40; frame += 1) {
      graph.update(guarding, opponent, 1 / 60, 2 + frame / 60, false, "full", 50 + frame / 2);
    }
    expect(boxer.actions.get("exhausted")!.getEffectiveWeight()).toBe(0);
    expect(boxer.actions.get("guard_high")!.getEffectiveWeight()).toBeGreaterThan(0.95);
    boxer.dispose();
  });

  it("keeps full-body layers normalized and reaches the authored knockdown pose", async () => {
    const gltf = await loadBoxerGlb();
    const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
    const graph = new BoxingGraph(boxer, mapping);
    const two = fighter("two");
    const totalWeight = (): number => [...boxer.actions.values()]
      .reduce((total, action) => total + action.getEffectiveWeight(), 0);

    graph.update(fighter("one"), two, 1 / 60, 0, false, "full", 0);
    expect(totalWeight()).toBeCloseTo(1, 5);
    const punching = withAction(fighter("one"), "jab", "normalized", 0, 3, 2, 8);
    graph.update(punching, two, 1 / 60, 1 / 60, false, "full", 0);
    expect(totalWeight()).toBeCloseTo(1, 5);

    const downed = { ...fighter("one"), is_downed: true };
    for (let frame = 0; frame < 100; frame += 1) {
      graph.update(downed, two, 1 / 60, frame / 60, false, "full", frame / 2);
    }
    expect(totalWeight()).toBeCloseTo(1, 5);
    expect(boxer.actions.get("knockdown")!.getEffectiveWeight()).toBeCloseTo(1, 5);

    const reference = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
    const knockdown = reference.actions.get("knockdown")!;
    knockdown.setEffectiveWeight(1).play();
    reference.mixer.setTime(knockdown.getClip().duration);
    reference.root.updateMatrixWorld(true);
    boxer.root.updateMatrixWorld(true);
    const expectedHeadY = reference.bone("head")!.getWorldPosition(new THREE.Vector3()).y;
    const actualHeadY = boxer.bone("head")!.getWorldPosition(new THREE.Vector3()).y;
    expect(actualHeadY).toBeCloseTo(expectedHeadY, 2);
    reference.dispose();
    boxer.dispose();
  });

  it.each([
    ["slip_left", { defense: "slip_left" }],
    ["slip_right", { defense: "slip_right" }],
    ["weave", { defense: "weave" }],
    ["pull", { defense: "pull" }],
    ["clinch", { clinch_ticks: 20 }],
    ["foul_recovery", { is_foul_recovery_target: true }],
    ["stunned", { stunned_ticks: 20 }],
    ["exhausted", { stamina: 60 }],
    ["taunt", { taunt_ticks: 40 }],
  ] as const)("presents the %s snapshot state instead of idling", async (clipName, state) => {
    const gltf = await loadBoxerGlb();
    const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
    const graph = new BoxingGraph(boxer, mapping);
    const one = { ...fighter("one"), ...state } as FighterSnapshot;
    for (let frame = 0; frame < 30; frame += 1) {
      graph.update(one, fighter("two"), 1 / 60, frame / 60, false, "full", frame / 2);
    }
    expect(boxer.actions.get(clipName)!.getEffectiveWeight()).toBeGreaterThan(0.95);
    boxer.dispose();
  });

  it("crossfades taunt entry and recovery without dropping total pose weight", async () => {
    const gltf = await loadBoxerGlb();
    const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
    const graph = new BoxingGraph(boxer, mapping);
    const opponent = fighter("two");
    const totalWeight = (): number => [...boxer.actions.values()]
      .reduce((total, action) => total + action.getEffectiveWeight(), 0);
    for (let frame = 0; frame < 20; frame += 1) {
      graph.update(fighter("one"), opponent, 1 / 60, frame / 60, false, "full", frame / 2);
    }

    const taunting = { ...fighter("one"), taunt_ticks: 60 };
    expect(boxer.actions.get("taunt")!.loop).toBe(THREE.LoopOnce);
    expect(boxer.actions.get("taunt")!.clampWhenFinished).toBe(true);
    graph.update(taunting, opponent, 1 / 60, 1, false, "full", 20);
    expect(boxer.actions.get("taunt")!.getEffectiveWeight()).toBeGreaterThan(0);
    expect(boxer.actions.get("taunt")!.getEffectiveWeight()).toBeLessThan(0.5);
    expect(boxer.actions.get("idle")!.getEffectiveWeight()).toBeGreaterThan(0.5);
    expect(totalWeight()).toBeCloseTo(1, 5);
    for (let frame = 0; frame < 30; frame += 1) {
      graph.update(taunting, opponent, 1 / 60, 1 + frame / 60, false, "full", 21 + frame / 2);
    }
    expect(boxer.actions.get("taunt")!.getEffectiveWeight()).toBeGreaterThan(0.95);

    graph.update(fighter("one"), opponent, 1 / 60, 2, false, "full", 50);
    expect(boxer.actions.get("taunt")!.getEffectiveWeight()).toBeGreaterThan(0.5);
    expect(boxer.actions.get("idle")!.getEffectiveWeight()).toBeGreaterThan(0);
    expect(totalWeight()).toBeCloseTo(1, 5);
    for (let frame = 0; frame < 45; frame += 1) {
      graph.update(fighter("one"), opponent, 1 / 60, 2 + frame / 60, false, "full", 51 + frame / 2);
    }
    expect(boxer.actions.get("taunt")!.getEffectiveWeight()).toBe(0);
    expect(boxer.actions.get("idle")!.getEffectiveWeight()).toBeGreaterThan(0.99);
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
    expect(boxer.actions.get("hit_head_right")!.isRunning()).toBe(true);
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
  expect(boxerA.actions.get("jab_left")!.getEffectiveWeight()).toBeCloseTo(1, 5);
  expect(boxerB.actions.get("jab_left")!.getEffectiveWeight()).toBe(0);
  const headA = boxerA.bone("head")!.getWorldPosition(new THREE.Vector3());
  const headB = boxerB.bone("head")!.getWorldPosition(new THREE.Vector3());
  expect(headB.distanceTo(headA)).toBeGreaterThan(0);
  boxerA.gloveGear.color.setHex(0x101010);
  expect(boxerB.gloveGear.color.getHex()).toBe(new THREE.Color(0xb91c1c).getHex());
  boxerA.dispose();
  boxerB.dispose();
});

it("preloads the five mapped textures and keeps every fighter material independent", async () => {
  const gltf = await loadBoxerGlb();
  const boxerA = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
  const boxerB = new SkinnedBoxer(gltf, { skin: 0x6e4128, gear: 0xb91c1c });
  const materials = (boxer: SkinnedBoxer): Map<string, THREE.MeshStandardMaterial> => {
    const found = new Map<string, THREE.MeshStandardMaterial>();
    boxer.root.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh && !Array.isArray(object.material)) {
        found.set(object.name, object.material as THREE.MeshStandardMaterial);
      }
    });
    return found;
  };
  const first = materials(boxerA);
  const second = materials(boxerB);
  const expected = {
    BoxerHead: "head",
    BoxerGloveLeft: "gloves",
    BoxerGloveRight: "gloves",
    BoxerBody: "body",
    BoxerShoes: "shoes",
    BoxerPants: "pants",
  } as const;
  expect(boxerA.root.children[0]!.scale.x).toBe(FIGHTER_MODEL_SCALE);
  for (const [meshName, textureName] of Object.entries(expected)) {
    const materialA = first.get(meshName)!;
    const materialB = second.get(meshName)!;
    expect(materialA).not.toBe(materialB);
    expect(materialA.map).toBe(materialB.map);
    expect(materialA.map?.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(materialA.map?.flipY).toBe(false);
    expect((materialA.map?.image as HTMLImageElement).src).toBe(FIGHTER_TEXTURE_DATA_URLS[textureName]);
  }
  expect(new Set([...first.values()].map((material) => material.uuid)).size).toBe(5);
  expect(new Set([...first.values()].map((material) => material.map?.uuid)).size).toBe(5);
  boxerA.dispose();
  boxerB.dispose();
});

it("embedded GLB bytes match their recorded sha256", async () => {
  const { createHash } = await import("node:crypto");
  const { gunzipSync } = await import("node:zlib");
  const { FIGHTER_GLB_GZIP_BASE64, FIGHTER_GLB_SHA256 } = await import("../assets/fighter-glb");
  const bytes = gunzipSync(Buffer.from(FIGHTER_GLB_GZIP_BASE64, "base64"));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(FIGHTER_GLB_SHA256);
});

it("preserves imported bone roll when the aim target is unchanged", async () => {
  const gltf = await loadBoxerGlb();
  const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
  new BoxingGraph(boxer, mapping);
  boxer.root.updateMatrixWorld(true);
  for (const [jointName, childName] of [
    ["shoulderL", "elbowL"], ["elbowL", "gloveL"],
    ["shoulderR", "elbowR"], ["elbowR", "gloveR"],
    ["hipL", "kneeL"], ["kneeL", "ankleL"],
    ["hipR", "kneeR"], ["kneeR", "ankleR"],
  ] as const) {
    const joint = boxer.bone(jointName)!;
    const child = boxer.bone(childName)!;
    const localBefore = joint.quaternion.clone().normalize();
    const childBefore = child.getWorldPosition(new THREE.Vector3());
    aimBoneLocal(joint, child, childBefore.clone());
    boxer.root.updateMatrixWorld(true);
    expect(joint.quaternion.clone().normalize().angleTo(localBefore), jointName).toBeLessThan(0.000001);
    expect(child.getWorldPosition(new THREE.Vector3()).distanceTo(childBefore), childName).toBeLessThan(0.000001);
  }
  boxer.dispose();
});


it("makes imported-fighter wounds graphic in full mode while off preserves non-bloody trauma", async () => {
  const gltf = await loadBoxerGlb();
  const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
  const graph = new BoxingGraph(boxer, mapping);
  const wounded = {
    ...fighter("one"),
    trauma: { head: 850, body: 700, left_eye: 280, right_eye: 240, left_cut: 260, right_cut: 220, swelling: 300, bleeding: 300 },
  };
  const bloodiedOpponent = {
    ...fighter("two"),
    trauma: { ...fighter("two").trauma, left_cut: 260, right_cut: 220, bleeding: 300 },
  };
  const material = (mesh: THREE.Mesh): THREE.MeshStandardMaterial => mesh.material as THREE.MeshStandardMaterial;

  graph.update(wounded, bloodiedOpponent, 1 / 60, 0, false, "full", 0);
  const fullCut = material(boxer.trauma.cutL).opacity;
  const fullStreakWidth = boxer.trauma.streakL.scale.x;
  const fullGlove = boxer.gloveGear.color.clone();
  graph.update(wounded, bloodiedOpponent, 1 / 60, 0.1, false, "reduced", 1);
  const reducedCut = material(boxer.trauma.cutL).opacity;
  const reducedStreakWidth = boxer.trauma.streakL.scale.x;
  expect(fullCut).toBeGreaterThan(reducedCut);
  expect(reducedCut).toBeGreaterThan(0);
  expect(fullStreakWidth).toBeGreaterThan(reducedStreakWidth);
  const colorDistance = (left: THREE.Color, right: THREE.Color): number => Math.abs(left.r - right.r) + Math.abs(left.g - right.g) + Math.abs(left.b - right.b);
  expect(colorDistance(fullGlove, boxer.gearBaseColor)).toBeGreaterThan(colorDistance(boxer.gloveGear.color, boxer.gearBaseColor));

  graph.update(wounded, bloodiedOpponent, 1 / 60, 0.2, false, "off", 2);
  for (const overlay of [boxer.trauma.cutL, boxer.trauma.cutR, boxer.trauma.streakL, boxer.trauma.streakR, boxer.trauma.noseStreak, boxer.trauma.mouthBlood, boxer.trauma.bodyStreak]) {
    expect(material(overlay).opacity).toBe(0);
  }
  expect(material(boxer.trauma.bruiseL).opacity).toBeGreaterThan(0);
  expect(material(boxer.trauma.ribL).opacity).toBeGreaterThan(0);
  expect(boxer.gloveGear.color.getHex()).toBe(boxer.gearBaseColor.getHex());
  boxer.dispose();
});

it("presents and restores visible jaw and shoulder dislocations", async () => {
  const gltf = await loadBoxerGlb();
  const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
  const graph = new BoxingGraph(boxer, mapping);
  const jawMaterial = boxer.trauma.jaw.material as THREE.MeshStandardMaterial;
  const jawRest = boxer.trauma.jaw.position.clone();
  graph.setArcadeDislocation("jaw");
  graph.update(fighter("one"), fighter("two"), 1 / 60, 0, false, "full", 0);
  expect(jawMaterial.opacity).toBe(1);
  expect(boxer.trauma.jaw.position.distanceTo(jawRest)).toBeGreaterThan(0.05);
  expect(jawMaterial.color.getHex()).toBe(0xa9744f);
  graph.setArcadeDislocation(null);
  expect(jawMaterial.opacity).toBe(0);
  expect(boxer.trauma.jaw.position.distanceTo(jawRest)).toBeLessThan(0.000001);

  graph.setArcadeDislocation("shoulder_left");
  graph.update(fighter("one"), fighter("two"), 1 / 60, 0.1, false, "full", 1);
  boxer.root.updateMatrixWorld(true);
  const shoulder = boxer.bone("shoulderL")!.getWorldPosition(new THREE.Vector3());
  const elbow = boxer.bone("elbowL")!.getWorldPosition(new THREE.Vector3());
  expect(elbow.sub(shoulder).normalize().y).toBeLessThan(-0.75);
  boxer.dispose();
});

it("hides and restores only the separable head for arcade decapitation", async () => {
  const gltf = await loadBoxerGlb();
  const boxer = new SkinnedBoxer(gltf, { skin: 0xa9744f, gear: 0x1d4ed8 });
  const meshes = new Map<string, THREE.SkinnedMesh>();
  boxer.root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) meshes.set(object.name, object);
  });
  boxer.setDecapitated(true);
  expect(boxer.isDecapitated).toBe(true);
  expect(meshes.get("BoxerHead")!.visible).toBe(false);
  expect(boxer.bone("head")!.visible).toBe(false);
  for (const name of ["BoxerBody", "BoxerGloveLeft", "BoxerGloveRight", "BoxerShoes", "BoxerPants"]) {
    expect(meshes.get(name)!.visible).toBe(true);
  }
  boxer.mixer.clipAction(THREE.AnimationClip.findByName(gltf.animations, "knockdown")!).play();
  boxer.mixer.update(0.25);
  boxer.setDecapitated(false);
  expect(meshes.get("BoxerHead")!.visible).toBe(true);
  expect(boxer.bone("head")!.visible).toBe(true);
  boxer.setHandDismembered("left", true);
  expect(boxer.isHandDismembered("left")).toBe(true);
  expect(meshes.get("BoxerGloveLeft")!.visible).toBe(false);
  expect(meshes.get("BoxerGloveRight")!.visible).toBe(true);
  boxer.setHandDismembered("left", false);
  expect(meshes.get("BoxerGloveLeft")!.visible).toBe(true);
  boxer.dispose();
});
