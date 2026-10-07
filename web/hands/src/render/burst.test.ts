import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fighter } from "../test/fixtures";
import type { CombatEvent, MatchResult } from "../types";
import { Effects3D } from "./effects";
import { BIG_SHOT, HARD_SHOT, closeCut } from "./gore";
import { SkinnedBoxer, loadBoxerGlb } from "./graph";
import { BURST_CUT_HEIGHT, HEAD_SITES, InjuryShading, NECK_CUT_HEIGHT, BODY_SITES, BODY_SWELL_CORE, applyBodyTrauma } from "./injury";
import { aboveBurstCut, arcadeInjuryFor, measureBurstStump, replayReattaches, caveInRibs } from "./renderer";
import { CANVAS_TOP } from "./world";

const gltf = await loadBoxerGlb();
const hit = (kind: string, amount: number, detail = "uppercut:head", eventId = 2): CombatEvent => ({ event_id: eventId, tick: 10, kind, actor_id: "one", target_id: "two", amount, detail, blood: 30, direction: 1, action_id: null });
const ending = (finish_method: MatchResult["finish_method"]) => ({ finish_method, winner_id: "one" });
const downed = { ...fighter("two"), is_downed: true };

describe("the finisher a knockout punch earns", () => {
  const puncher = (hand: "left" | "right") => ({ ...fighter("one"), action_key: `straight:${hand}:head:normal` });
  // [punch and target, kind, damage, the puncher's hand] and the finisher, by punch, place and weight alone.
  const table: readonly (readonly [string, string, number, "left" | "right", string])[] = [
    ["jab:head", "hit", 34, "left", "jaw_dislocation"],
    ["jab:head", "hit", HARD_SHOT + 30, "left", "jaw_dislocation"],
    ["straight:head", "hit", 79, "right", "jaw_dislocation"],
    ["straight:head", "hit", 80, "right", "decapitation"],
    ["uppercut:head", "hit", HARD_SHOT - 1, "right", "jaw_dislocation"],
    ["uppercut:head", "hit", HARD_SHOT, "right", "decapitation"],
    ["hook:head", "hit", HARD_SHOT - 1, "left", "jaw_dislocation"],
    ["hook:head", "hit", HARD_SHOT, "left", "eye_right"],
    ["hook:head", "hit", HARD_SHOT + 40, "right", "eye_left"],
    ["straight:head", "hit", 140, "right", "decapitation"],
    ["straight:head", "counter_hit", BIG_SHOT, "right", "head_burst"],
    ["jab:body", "hit", 50, "left", "ribs_right"],
    ["straight:body", "hit", 140, "right", "ribs_left"],
    ["uppercut:body", "counter_hit", 120, "left", "ribs_right"],
    ["hook:body", "hit", HARD_SHOT - 1, "left", "ribs_right"],
    ["hook:body", "hit", HARD_SHOT, "left", "shoulder_right"],
    ["hook:body", "hit", BIG_SHOT, "right", "dismember_left"],
  ];

  it("is chosen by the punch, where it landed and how hard, whatever the event's id", () => {
    for (const [detail, kind, amount, hand, injury] of table) {
      for (const eventId of [1, 2, 3, 4, 17, 40]) {
        expect(arcadeInjuryFor(hit(kind, amount, detail, eventId), downed, ending("ko"), puncher(hand)), `${detail} ${kind} ${amount} ${hand} #${eventId}`).toBe(injury);
      }
    }
  });

  it("never takes a man's head off with a jab, nor a hand with a punch up the middle of his body", () => {
    for (let amount = 1; amount <= 160; amount += 1) {
      expect(arcadeInjuryFor(hit("hit", amount, "jab:head", amount), downed, ending("ko"), puncher("left"))).toBe("jaw_dislocation");
      for (const detail of ["jab:body", "straight:body", "uppercut:body"]) expect(arcadeInjuryFor(hit("counter_hit", amount, detail, amount), downed, ending("tko"), puncher("right"))).toBe("ribs_left");
    }
  });

  it("bursts the head of a flash knockout whatever the punch, and lands on his right without the puncher's hand", () => {
    expect(arcadeInjuryFor(hit("hit", 40, "jab:head"), fighter("two"), ending("flash_ko"))).toBe("head_burst");
    expect(arcadeInjuryFor(hit("hit", 90, "hook:head"), downed, ending("ko"))).toBe("eye_right");
    expect(arcadeInjuryFor(hit("hit", 60, "straight:body"), downed, ending("ko"))).toBe("ribs_right");
  });
});

describe("ribs caved in by a body shot", () => {
  it("dent deep into the side the punch landed on, black with bruising and running with blood", () => {
    for (const side of ["left", "right"] as const) {
      const shading = new InjuryShading(null, BODY_SITES, { core: BODY_SWELL_CORE, wash: true });
      // The engine's trauma is painted first each frame; the caved-in ribs go over it.
      applyBodyTrauma(shading, fighter("two").trauma, "full");
      caveInRibs(shading, side);
      const site = BODY_SITES.find((candidate) => candidate.name === `${side}Ribs`)!;
      const impact = shading.uniforms.uInjuryImpact.value;
      expect([impact.x, impact.y, impact.z]).toEqual([...site.position]);
      const push = shading.uniforms.uInjuryImpactPush.value;
      // Into the body, toward the spine from the side it is on, deeper than any punch's own dent (3.2 cm).
      expect(Math.sign(push.x)).toBe(-Math.sign(site.position[0]));
      expect(shading.impactDepth).toBeGreaterThan(5);
      const ribs = shading.level(`${side}Ribs`);
      expect(ribs.bruise).toBeCloseTo(1.2, 6);
      expect(ribs.swell).toBe(0);
      expect(ribs.blood).toBeCloseTo(1.4, 6);
      // A punch's dent springs back; these are set again every frame and stay in.
      shading.update(0.5);
      expect(shading.impactDepth).toBeLessThan(0.1);
      caveInRibs(shading, side);
      expect(shading.impactDepth).toBeGreaterThan(5);
    }
    expect(replayReattaches("ribs_left")).toBe(true);
  });
});

describe("a head that bursts", () => {
  it("is what a flash knockout or a big counter to the head earns; other finishers stay as they were", () => {
    expect(arcadeInjuryFor(hit("counter_hit", BIG_SHOT), downed, ending("ko"))).toBe("head_burst");
    expect(arcadeInjuryFor(hit("hit", 60, "hook:head"), fighter("two"), ending("flash_ko"))).toBe("head_burst");
    expect(arcadeInjuryFor(hit("counter_hit", BIG_SHOT - 1, "uppercut:head", 2), downed, ending("ko"))).toBe("decapitation");
    expect(arcadeInjuryFor(hit("hit", 140, "uppercut:head", 3), downed, ending("tko"))).toBe("decapitation");
    expect(arcadeInjuryFor(hit("counter_hit", 140, "hook:body", 2), downed, ending("ko"))).not.toBe("head_burst");
    expect(replayReattaches("head_burst")).toBe(true);
  });

  it("takes everything above the mouth and leaves the chin, the jaw and the collar", () => {
    expect(aboveBurstCut(new THREE.Vector3(0, 120, 3.4))).toBe(true);
    expect(aboveBurstCut(new THREE.Vector3(0, 117, 5.3))).toBe(true);
    expect(aboveBurstCut(new THREE.Vector3(0, 126, -6))).toBe(true);
    expect(aboveBurstCut(new THREE.Vector3(0, 110.8, 4.2))).toBe(false);
    expect(aboveBurstCut(new THREE.Vector3(4.6, 112, 1.4))).toBe(false);
    expect(aboveBurstCut(new THREE.Vector3(0, 106, -4))).toBe(false);
  });

  it("cuts the skin and its shadow along a ragged line level with the mouth, and back to the neck cut when severed", () => {
    const material = new THREE.MeshStandardMaterial();
    const shading = new InjuryShading(material, HEAD_SITES);
    const shadow = shading.shadowMaterial();
    const depth = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <clipping_planes_fragment>" };
    shadow.onBeforeCompile(depth as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(depth.uniforms.uInjurySeverShape).toBe(shading.uniforms.uInjurySeverShape);
    shading.setBurst(true);
    expect(shading.uniforms.uInjurySever.value).toBe(BURST_CUT_HEIGHT);
    expect(shading.uniforms.uInjurySeverShape.value.x).toBe(0);
    expect(shading.uniforms.uInjurySeverShape.value.y).toBeGreaterThan(1);
    shading.setSevered(true);
    expect(shading.uniforms.uInjurySever.value).toBe(NECK_CUT_HEIGHT);
    expect(shading.uniforms.uInjurySeverShape.value.y).toBe(1);
    shading.setBurst(false);
    expect(shading.uniforms.uInjurySever.value).toBeGreaterThan(500);
  });

  it("shows raw flesh inside the head where it is open, drawing the head from inside too", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    expect((boxer.headMesh.material as THREE.Material).shadowSide).toBe(THREE.BackSide);
    const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>" };
    boxer.headInjury.material!.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain("if (!gl_FrontFacing)");
    boxer.setHeadBurst(true);
    expect((boxer.headMesh.material as THREE.Material).side).toBe(THREE.DoubleSide);
    expect(boxer.isHeadBurst).toBe(true);
    expect(boxer.isDecapitated).toBe(false);
    boxer.setDecapitated(true);
    expect(boxer.isHeadBurst).toBe(false);
    boxer.dispose();
  });

  it("leaves a wound closing the neck level with the mouth, its teeth turned to the front of the head", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    boxer.root.rotation.y = 1.1;
    const out = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), across: new THREE.Vector3(), scratch: new THREE.Vector3() };
    const rim = measureBurstStump(boxer, new Float32Array(0), out);
    expect(rim).not.toBeNull();
    expect(rim!.length).toBeGreaterThan(60);
    const head = boxer.bone("head")!.getWorldPosition(new THREE.Vector3());
    expect(out.position.distanceTo(head)).toBeLessThan(0.12);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(out.quaternion);
    expect(up.y).toBeGreaterThan(0.5);
    expect(Math.abs(out.across.dot(up))).toBeLessThan(1e-6);
    // The same array is reused from frame to frame.
    expect(measureBurstStump(boxer, rim!, out)).toBe(rim);
    boxer.dispose();
  });

  it("throws out skull, brain and teeth with a great spray of blood, once, and only with full blood", () => {
    const burst = (level: "full" | "reduced"): Effects3D => {
      const effects = new Effects3D(new THREE.Scene(), 256);
      effects.setBloodLevel(level);
      effects.burstHead(1, new THREE.Vector3(0.4, 1.6, 0), -1, 21);
      return effects;
    };
    const full = burst("full");
    expect(full.headBurst(1)).toBe(true);
    expect(full.headBurst(0)).toBe(false);
    expect(full.debrisCount("shard")).toBe(18);
    expect(full.debrisCount("brain")).toBe(14);
    expect(full.debrisCount("tooth")).toBe(5);
    expect(full.liveBloodParticles).toBeGreaterThan(150);
    full.burstHead(1, new THREE.Vector3(0.4, 1.6, 0), -1, 21);
    expect(full.debrisCount("shard")).toBe(18);
    full.restoreFighter(1);
    expect(full.headBurst(1)).toBe(false);
    full.dispose();
    const reduced = burst("reduced");
    expect(reduced.headBurst(1)).toBe(false);
    expect(reduced.debrisCount("shard")).toBe(0);
    reduced.dispose();
  });

  it("leaves skull, brain, teeth and flesh lying where they land for the rest of the bout", () => {
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene, 256);
    effects.burstHead(0, new THREE.Vector3(0, 1.6, 0), 1, 5);
    effects.decapitate(1, new THREE.Vector3(1, 1.6, 0), new THREE.Quaternion(), -1, 6);
    // Half a minute on, through the replay and the result card, all of it is still there.
    for (let frame = 0; frame < 60 * 30; frame += 1) effects.update(1 / 60);
    expect(effects.debrisCount("shard")).toBe(18);
    expect(effects.debrisCount("brain")).toBe(14);
    expect(effects.debrisCount("tooth")).toBe(5);
    expect(effects.debrisCount("flesh")).toBe(24);
    const matrix = new THREE.Matrix4();
    const at = new THREE.Vector3();
    for (const mesh of scene.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh && child !== effects.dropletMesh)) {
      for (let index = 0; index < mesh.count; index += 1) {
        mesh.getMatrixAt(index, matrix);
        if (at.setFromMatrixPosition(matrix).y > -10) expect(at.y).toBeCloseTo(CANVAS_TOP + 0.015, 6);
      }
      // Lying still, it is not sent to the graphics card again.
      const version = mesh.instanceMatrix.version;
      effects.update(1 / 60);
      expect(mesh.instanceMatrix.version).toBe(version);
    }
    // A replay that puts the head back on takes up what its burst threw; the other man's flesh stays.
    effects.restoreFighter(0);
    expect(effects.debrisCount("shard")).toBe(0);
    expect(effects.debrisCount("brain")).toBe(0);
    expect(effects.debrisCount("flesh")).toBe(24);
    effects.clearDynamic();
    expect(effects.debrisCount("flesh")).toBe(0);
    effects.dispose();
  });

  it("makes room for more by shrinking the oldest piece on the canvas away, never popping one", () => {
    const effects = new Effects3D(new THREE.Scene(), 256);
    const gibs = (effects as unknown as { gibMesh: THREE.InstancedMesh }).gibMesh;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const read = (): { x: number; y: number; z: number; size: number }[] => Array.from({ length: gibs.count }, (_, index) => {
      gibs.getMatrixAt(index, matrix);
      matrix.decompose(position, turn, scale);
      return { x: position.x, y: position.y, z: position.z, size: scale.y };
    });
    // A big counter tears flesh every two seconds for a minute: 240 pieces for 96 places.
    let earlier = read();
    let before = read();
    let popped = 0;
    const still = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6;
    for (let frame = 0; frame < 60 * 60; frame += 1) {
      if (frame % 120 === 0) effects.addEvent({ ...hit("counter_hit", 140, "hook:head", frame + 1), blood: 70 }, new THREE.Vector3(), false);
      effects.update(1 / 60);
      const after = read();
      for (const [index, was] of before.entries()) {
        // A piece that lay still on the canvas, gone the next frame at more than a fraction of its size.
        const lying = Math.abs(was.y - (CANVAS_TOP + 0.015)) < 1e-6 && still(was, earlier[index]!);
        if (lying && !still(was, after[index]!) && was.size > 0.15) popped += 1;
      }
      earlier = before;
      before = after;
    }
    expect(effects.liveGibs).toBeGreaterThan(80);
    expect(popped).toBe(0);
    effects.dispose();
  });

  it("draws teeth white and brain grey, not in the colour of flesh", () => {
    const effects = new Effects3D(new THREE.Scene(), 256);
    effects.spawnTeeth(new THREE.Vector3(0, 1.5, 0), 1, 1, 3);
    const mesh = (effects as unknown as { gibMesh: THREE.InstancedMesh }).gibMesh;
    const color = new THREE.Color();
    mesh.getColorAt(0, color);
    expect(color.r).toBeGreaterThan(0.8);
    expect(color.g).toBeGreaterThan(0.75);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff);
    effects.dispose();
  });
});

describe("flesh over a cut that has a front", () => {
  it("turns its texture with the body when told which way is across", () => {
    const rim = new Float32Array([0.05, 0, 0, 0, 0, 0.05, 0, 0, 0.05, -0.05, 0, 0, -0.05, 0, 0, 0, 0, -0.05, 0, 0, -0.05, 0.05, 0, 0]);
    const uvAt = (across: THREE.Vector3 | undefined): { u: number; v: number } => {
      const geometry = new THREE.BufferGeometry();
      closeCut(geometry, rim, new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 0.01, across);
      const position = geometry.getAttribute("position");
      const uv = geometry.getAttribute("uv");
      for (let index = 0; index < position.count; index += 1) {
        if (Math.abs(position.getZ(index) - 0.05) < 1e-6 && Math.abs(position.getX(index)) < 1e-6) return { u: uv.getX(index), v: uv.getY(index) };
      }
      throw new Error("front of the rim not found");
    };
    // The front of the cut (+Z) lies toward the low edge of the texture whatever way across is turned.
    expect(uvAt(new THREE.Vector3(1, 0, 0)).v).toBeLessThan(0.25);
    expect(uvAt(new THREE.Vector3(0, 0, 1)).u).toBeGreaterThan(0.75);
    expect(uvAt(new THREE.Vector3(0, 1, 0)).v).toBeLessThan(0.25);
  });
});

describe("what a cut shows", () => {
  it("is the inside of the limb or neck it went through: the wrist its two bones, the neck its spine, the jaw its teeth", () => {
    const effects = new Effects3D(new THREE.Scene(), 256);
    const inner = effects as unknown as { stumps: { mesh: THREE.Mesh }[]; handStumps: { mesh: THREE.Mesh }[]; hands: { cap: THREE.Mesh }[]; heads: { cap: THREE.Mesh }[] };
    const map = (mesh: THREE.Mesh): THREE.Texture | null => (mesh.material as THREE.MeshStandardMaterial).map;
    const neck = map(inner.stumps[0]!.mesh);
    const wrist = map(inner.handStumps[0]!.mesh);
    expect(neck).not.toBeNull();
    expect(wrist).not.toBeNull();
    expect(wrist).not.toBe(neck);
    expect(map(inner.hands[0]!.cap)).toBe(wrist);
    expect(map(inner.heads[0]!.cap)).toBe(neck);
    effects.burstHead(0, new THREE.Vector3(0, 1.6, 0), 1, 3);
    const jaw = map(inner.stumps[0]!.mesh);
    expect(jaw).not.toBe(neck);
    effects.restoreFighter(0);
    expect(map(inner.stumps[0]!.mesh)).toBe(neck);
    effects.dispose();
  });
});
