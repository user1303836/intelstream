import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fighter } from "../test/fixtures";
import type { CombatEvent, MatchResult } from "../types";
import { Effects3D } from "./effects";
import { BIG_SHOT, closeCut } from "./gore";
import { SkinnedBoxer, loadBoxerGlb } from "./graph";
import { BURST_CUT_HEIGHT, HEAD_SITES, InjuryShading, NECK_CUT_HEIGHT } from "./injury";
import { aboveBurstCut, arcadeInjuryFor, measureBurstStump, replayReattaches } from "./renderer";

const gltf = await loadBoxerGlb();
const hit = (kind: string, amount: number, detail = "uppercut:head", eventId = 2): CombatEvent => ({ event_id: eventId, tick: 10, kind, actor_id: "one", target_id: "two", amount, detail, blood: 30, direction: 1, action_id: null });
const ending = (finish_method: MatchResult["finish_method"]) => ({ finish_method, winner_id: "one" });
const downed = { ...fighter("two"), is_downed: true };

describe("a head that bursts", () => {
  it("is what a flash knockout or a big counter to the head earns; other finishers stay as they were", () => {
    expect(arcadeInjuryFor(hit("counter_hit", BIG_SHOT), downed, ending("ko"))).toBe("head_burst");
    expect(arcadeInjuryFor(hit("hit", 60, "hook:head"), fighter("two"), ending("flash_ko"))).toBe("head_burst");
    expect(arcadeInjuryFor(hit("counter_hit", BIG_SHOT - 1, "uppercut:head", 2), downed, ending("ko"))).toBe("decapitation");
    expect(arcadeInjuryFor(hit("hit", 140, "uppercut:head", 3), downed, ending("tko"))).toBe("jaw_dislocation");
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
    expect((boxer.headMesh.material as THREE.Material).side).toBe(THREE.DoubleSide);
    const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>" };
    boxer.headInjury.material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain("if (!gl_FrontFacing)");
    boxer.setHeadBurst(true);
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

  it("leaves skull and brain lying on the canvas where flesh is gone as it lands", () => {
    const effects = new Effects3D(new THREE.Scene(), 256);
    effects.burstHead(0, new THREE.Vector3(0, 1.6, 0), 1, 5);
    for (let frame = 0; frame < 180; frame += 1) effects.update(1 / 60);
    expect(effects.debrisCount("shard")).toBe(18);
    expect(effects.debrisCount("brain")).toBe(14);
    for (let frame = 0; frame < 60 * 14; frame += 1) effects.update(1 / 60);
    expect(effects.debrisCount("shard")).toBe(0);
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
