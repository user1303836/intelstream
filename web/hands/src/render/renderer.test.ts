import { fighter, snapshot } from "../test/fixtures";
import type { CombatEvent, MatchResult } from "../types";
import * as THREE from "three";
import { releaseSharedGpu, disposeSkeletons } from "./graph";
import { arcadeInjuryFor, canStartPunch, compileForComposer, contactParticipants, contactPresentationPlan, disposeComposer, FightRenderer, isArcadeInjuryCandidate, presentationTickFor, refereeSpacing, replayCameraSide, replayReattaches } from "./renderer";

const event = (kind: string, detail: string): CombatEvent => ({
  event_id: 1,
  tick: 10,
  kind,
  actor_id: "one",
  target_id: "two",
  amount: 500,
  detail,
  blood: 100,
  direction: 1,
  action_id: "punch-1",
});

const flashKo: MatchResult = {
  match_id: "match",
  activity_instance_id: "activity",
  guild_id: "guild",
  player_one_id: "one",
  player_two_id: "two",
  winner_id: "one",
  finish_method: "flash_ko",
  round_number: 1,
  tick: 10,
  scorecards: [],
  player_one_knockdowns: 1,
  player_two_knockdowns: 0,
  player_one_damage: 0,
  player_two_damage: 500,
};

describe("contact presentation tick", () => {
  it("holds live contact events for interpolation but presents terminal contacts on the authoritative frame", () => {
    expect(presentationTickFor(snapshot(50))).toBe(49);
    expect(presentationTickFor({ ...snapshot(50), result: flashKo })).toBe(50);
  });

  it("routes hit recipients and block defenders without swapping the puncher", () => {
    const frame = snapshot(10);
    expect(contactParticipants(event("hit", "straight:head"), frame)).toEqual({ recipientIndex: 1, puncherIndex: 0 });
    expect(contactParticipants(event("block", "straight:head"), frame)).toEqual({ recipientIndex: 0, puncherIndex: 1 });
    expect(contactParticipants(event("perfect_block", "straight:head"), frame)).toEqual({ recipientIndex: 0, puncherIndex: 1 });
  });

  it("coalesces an engine-shaped block, leaking hit, and knockdown without changing event order", () => {
    const frame = {
      ...snapshot(10),
      fighters: [
        fighter("one"),
        { ...fighter("two"), facing: -1, action_key: "straight:left:body:light", action_contact_tick: 10 },
      ] as const,
    };
    const block = { ...event("block", ""), amount: 30, blood: 0, direction: 0 };
    const hit = {
      ...event("hit", "straight:body"),
      actor_id: "two",
      target_id: "one",
      amount: 18,
      blood: 12,
      direction: -1,
    };
    const knockdown = { ...event("knockdown", ""), actor_id: "two", target_id: "one", blood: 0, direction: 0, action_id: null };
    const plan = contactPresentationPlan([block, hit, knockdown], frame);
    expect(plan.map((entry) => entry.event.kind)).toEqual(["block", "hit", "knockdown"]);
    expect(plan.map((entry) => entry.presentImpact)).toEqual([true, false, true]);
    expect(plan[0]!.presentationEvent).toMatchObject({ kind: "block", detail: "straight:body", direction: -1, blood: 12 });
    expect(plan[2]!.presentationEvent).toMatchObject({ kind: "knockdown", detail: "straight:body", direction: -1, blood: 12 });
  });

  it("reacts once to the punch that knocks a fighter down, at the punch's own strength", () => {
    const frame = snapshot(10);
    const hit = event("hit", "straight:head");
    const knockdown = { ...event("knockdown", ""), event_id: 2, amount: 1, blood: 0, direction: 0, action_id: null };
    expect(contactPresentationPlan([hit, knockdown], frame).map((entry) => entry.reactAmount)).toEqual([500, null]);
    // Through a block, the block's entry presents the punch, so the knockdown reacts for the hit that leaked.
    const block = { ...event("block", ""), actor_id: "two", target_id: "one", amount: 30, blood: 0, direction: 0 };
    expect(contactPresentationPlan([block, { ...hit, amount: 18 }, knockdown], frame).map((entry) => entry.reactAmount)).toEqual([30, 18, 18]);
  });
});

describe("arcade injury candidate routing", () => {
  it("accepts authoritative downing anatomical hits and winning flash KOs", () => {
    expect(isArcadeInjuryCandidate(event("hit", "straight:head"), { ...fighter("two"), is_downed: true }, null)).toBe(true);
    expect(isArcadeInjuryCandidate(event("hit", "hook:body"), { ...fighter("two"), is_downed: true }, null)).toBe(true);
    expect(isArcadeInjuryCandidate(event("counter_hit", "hook:head"), fighter("two"), flashKo)).toBe(true);
  });

  it("routes head trauma to head injuries and body trauma to the struck-side limbs", () => {
    const downed = { ...fighter("two"), is_downed: true };
    const leftPunch = { ...fighter("one"), action_key: "hook:left:body:heavy" };
    const rightPunch = { ...fighter("one"), action_key: "hook:right:body:heavy" };
    expect(arcadeInjuryFor({ ...event("hit", "hook:head"), event_id: 0 }, downed, null, leftPunch)).toBe("decapitation");
    expect(arcadeInjuryFor({ ...event("hit", "hook:head"), event_id: 1 }, downed, null, leftPunch)).toBe("jaw_dislocation");
    expect(arcadeInjuryFor({ ...event("hit", "hook:body"), event_id: 0 }, downed, null, leftPunch)).toBe("dismember_right");
    expect(arcadeInjuryFor({ ...event("hit", "hook:body"), event_id: 1 }, downed, null, leftPunch)).toBe("shoulder_right");
    expect(arcadeInjuryFor({ ...event("hit", "hook:body"), event_id: 0 }, downed, null, rightPunch)).toBe("dismember_left");
    expect(arcadeInjuryFor({ ...event("hit", "hook:body"), event_id: 1 }, downed, null, rightPunch)).toBe("shoulder_left");
  });

  it.each([
    ["standing hit", event("hit", "left:jab:head"), fighter("two"), null],
    ["unknown target", event("hit", "straight:arm"), { ...fighter("two"), is_downed: true }, null],
    ["block", event("block", "left:straight:head"), { ...fighter("two"), is_downed: true }, null],
    ["bleed", event("bleed", "left:straight:head"), { ...fighter("two"), is_downed: true }, null],
    ["wrong winner", event("counter_hit", "right:hook:head"), fighter("two"), { ...flashKo, winner_id: "two" }],
  ] as const)("rejects %s", (_name, combatEvent, target, result) => {
    expect(isArcadeInjuryCandidate(combatEvent, target, result)).toBe(false);
  });
});

describe("referee spacing", () => {
  it("stands off during the action, steps in for a clinch and tightest over a count", () => {
    expect(refereeSpacing(false, false).standoff).toBeGreaterThan(refereeSpacing(false, true).standoff);
    expect(refereeSpacing(false, true).standoff).toBeGreaterThan(refereeSpacing(true, true).standoff - 0.2);
    expect(refereeSpacing(true, false).clearance).toBeLessThan(refereeSpacing(false, false).clearance);
    expect(refereeSpacing(false, true).clearance).toBeLessThan(refereeSpacing(false, false).clearance);
  });
});

describe("knockout replay injuries", () => {
  it("reattaches severed parts for the replay but leaves dislocations in place", () => {
    expect(replayReattaches("decapitation")).toBe(true);
    expect(replayReattaches("dismember_left")).toBe(true);
    expect(replayReattaches("dismember_right")).toBe(true);
    expect(replayReattaches("jaw_dislocation")).toBe(false);
    expect(replayReattaches("shoulder_left")).toBe(false);
  });
});

describe("replay camera side", () => {
  it("shoots from the broadcast side with room to spare and switches when the ropes would crowd it", () => {
    expect(replayCameraSide(0, 0, 0, 1, 2.5, 2.2)).toBe(1);
    expect(replayCameraSide(0, 0, 0, -1, 2.5, 2.2)).toBe(-1);
    expect(replayCameraSide(0, 1.2, 0, 1, 2.5, 2.2)).toBe(-1);
    expect(replayCameraSide(0, 2.4, 0, 1, 2.5, 2.2)).toBe(-1);
    expect(replayCameraSide(0, -1.5, 0, 1, 2.5, 2.2)).toBe(1);
  });
});

describe("punch prediction gate", () => {
  it("only predicts a punch the server would start", () => {
    const ready = fighter("one");
    expect(canStartPunch(ready)).toBe(true);
    expect(canStartPunch({ ...ready, is_downed: true })).toBe(false);
    expect(canStartPunch({ ...ready, stunned_ticks: 3 })).toBe(false);
    expect(canStartPunch({ ...ready, clinch_ticks: 10 })).toBe(false);
    expect(canStartPunch({ ...ready, taunt_ticks: 10 })).toBe(false);
    expect(canStartPunch({ ...ready, is_foul_recovery_target: true })).toBe(false);
  });
});

describe("replay injuries", () => {
  it("does not sever again when reduced motion or a lower blood level was chosen during the replay", () => {
    const event = { event_id: 5, tick: 10, kind: "knockdown", actor_id: "one", target_id: "two", amount: 400, detail: "", blood: 60, direction: 1, action_id: null };
    const apply = (settings: { blood: string; reducedMotion: boolean }): number => {
      const applied: unknown[] = [];
      const stub = { replayInjuries: [{ injury: "decapitation", event }, null], settings: () => settings, applyArcadeInjury: (...args: unknown[]) => { applied.push(args); return true; } };
      (FightRenderer.prototype as unknown as { reapplyReplayInjuries: () => void }).reapplyReplayInjuries.call(stub);
      expect(stub.replayInjuries[0]).toBeNull();
      return applied.length;
    };
    expect(apply({ blood: "full", reducedMotion: false })).toBe(1);
    expect(apply({ blood: "full", reducedMotion: true })).toBe(0);
    expect(apply({ blood: "reduced", reducedMotion: false })).toBe(0);
  });
});

describe("graphics memory across rematches", () => {
  it("frees every composer pass before the composer itself", () => {
    const order: string[] = [];
    const composer = {
      passes: [{ dispose: () => order.push("render") }, {}, { dispose: () => order.push("bloom") }, { dispose: () => order.push("output") }],
      dispose: () => order.push("composer"),
    };
    disposeComposer(composer);
    expect(order).toEqual(["render", "bloom", "output", "composer"]);
  });

  it("frees each fighter's bone texture with the fighter", () => {
    const bones = [new THREE.Bone(), new THREE.Bone()];
    bones[0]!.add(bones[1]!);
    const meshes = [0, 1].map(() => {
      const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
      mesh.bind(new THREE.Skeleton(bones));
      return mesh;
    });
    const root = new THREE.Group();
    root.add(bones[0]!, ...meshes);
    const disposed = meshes.map((mesh) => vi.spyOn(mesh.skeleton, "dispose"));
    disposeSkeletons(root);
    for (const spy of disposed) expect(spy).toHaveBeenCalledOnce();
  });

  it("frees the graphics copies of the shared model and textures but keeps their data for the next renderer", () => {
    const geometry = new THREE.BoxGeometry();
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(geometry), new THREE.Group().add(new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())));
    const texture = new THREE.Texture();
    const geometryDisposed = vi.fn();
    const textureDisposed = vi.fn();
    geometry.addEventListener("dispose", geometryDisposed);
    texture.addEventListener("dispose", textureDisposed);
    releaseSharedGpu(scene, [texture]);
    expect(geometryDisposed).toHaveBeenCalled();
    expect(textureDisposed).toHaveBeenCalledOnce();
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
    releaseSharedGpu(null, []);
  });

  it("compiles the fighters' shaders for the composer's own target, then lets go of it", async () => {
    const calls: string[] = [];
    const readBuffer = { name: "composer target" };
    const renderer = {
      setRenderTarget: (target: unknown) => calls.push(target === readBuffer ? "bind composer target" : target === null ? "unbind" : "bind other"),
      compileAsync: () => { calls.push("compile"); return Promise.resolve(); },
    };
    await compileForComposer(renderer as unknown as Parameters<typeof compileForComposer>[0], { readBuffer } as unknown as Parameters<typeof compileForComposer>[1], new THREE.Group(), new THREE.PerspectiveCamera(), new THREE.Scene());
    expect(calls).toEqual(["bind composer target", "compile", "unbind"]);
  });
});
