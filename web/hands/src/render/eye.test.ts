import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fighter } from "../test/fixtures";
import type { CombatEvent } from "../types";
import { EYE_NERVE_LENGTH, Effects3D } from "./effects";
import { SkinnedBoxer, loadBoxerGlb } from "./graph";
import { BODY_SITES, EYE_LIDS, HEAD_SITES, InjuryShading } from "./injury";
import { FightRenderer, arcadeInjuryFor, eyeSocket, replayReattaches } from "./renderer";
import { CANVAS_TOP } from "./world";

const gltf = await loadBoxerGlb();
const downed = { ...fighter("two"), is_downed: true };
const ko = { finish_method: "ko" as const, winner_id: "one" };
const hit = (detail: string, eventId: number): CombatEvent => ({ event_id: eventId, tick: 10, kind: "hit", actor_id: "one", target_id: "two", amount: 80, detail, blood: 20, direction: 1, action_id: null });
const puncher = (hand: string) => ({ ...fighter("one"), action_key: `hook:${hand}:head:normal` });

describe("an eye forced out", () => {
  it("is what a finishing hook earns, on the side it lands; other punches keep their finishers", () => {
    expect(arcadeInjuryFor(hit("hook:head", 1), downed, ko, puncher("left"))).toBe("eye_right");
    expect(arcadeInjuryFor(hit("hook:head", 3), downed, ko, puncher("right"))).toBe("eye_left");
    expect(arcadeInjuryFor(hit("hook:head", 2), downed, ko, puncher("left"))).toBe("decapitation");
    expect(arcadeInjuryFor(hit("straight:head", 1), downed, ko, puncher("left"))).toBe("jaw_dislocation");
    expect(["eye_left", "eye_right"]).toContain(arcadeInjuryFor(hit("hook:head", 5), downed, ko));
    expect(replayReattaches("eye_left")).toBe(true);
    expect(replayReattaches("eye_right")).toBe(true);
  });

  it("leaves a hollow, bleeding socket where the face has an eye, and nothing on the body", () => {
    const head = new InjuryShading(new THREE.MeshStandardMaterial(), HEAD_SITES, { core: [0, 119, -3.5, 0], lids: EYE_LIDS });
    head.setEyeOut("right");
    expect(head.eyeOut).toBe("right");
    expect(head.uniforms.uInjuryEyeOut.value.toArray()).toEqual([0, 1]);
    expect(head.level("rightEye").blood).toBeGreaterThan(1);
    expect(head.level("leftEye").blood).toBe(0);
    head.setEyeOut(null);
    expect(head.eyeOut).toBeNull();
    expect(head.level("rightEye").blood).toBe(0);
    head.setEyeOut("left");
    head.clear();
    expect(head.eyeOut).toBeNull();
    const body = new InjuryShading(new THREE.MeshStandardMaterial(), BODY_SITES, { core: [0, 0, -2, 1] });
    body.setEyeOut("left");
    expect(body.eyeOut).toBeNull();
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>" };
    head.material!.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.uniforms.uInjuryEyeOut).toBe(head.uniforms.uInjuryEyeOut);
    expect(shader.vertexShader).toContain("uniform vec2 uInjuryEyeOut;");
    expect(shader.fragmentShader).toContain("uniform vec2 uInjuryEyeOut;");
    // `out` is a reserved word in GLSL ES 3.0 and would stop the skin compiling.
    expect(shader.vertexShader).not.toMatch(/\bfloat out\b/);
    expect(shader.fragmentShader).not.toMatch(/\bfloat out\b/);
  });

  it("sits in its socket on the face as it is posed, the left and the right on their own sides", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    boxer.root.rotation.y = 0.7;
    const left = new THREE.Vector3();
    const right = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    expect(eyeSocket(boxer, "left", left, forward, turn)).toBe(true);
    expect(eyeSocket(boxer, "right", right, forward, turn)).toBe(true);
    const head = boxer.bone("head")!.getWorldPosition(new THREE.Vector3());
    expect(left.distanceTo(head)).toBeLessThan(0.15);
    expect(left.distanceTo(right)).toBeGreaterThan(0.05);
    expect(left.distanceTo(right)).toBeLessThan(0.11);
    const across = new THREE.Vector3(1, 0, 0).applyQuaternion(turn);
    expect(left.clone().sub(right).dot(across)).toBeGreaterThan(0.04);
    expect(forward.length()).toBeCloseTo(1, 6);
    boxer.dispose();
  });

  it("springs out and hangs on its nerve in front of the face, never through the canvas, and only with full blood", () => {
    const socket = new THREE.Vector3(0, 0.3, 0);
    const forward = new THREE.Vector3(1, 0, 0);
    // The head lies on its side, face toward +X: the middle of the skull is ten centimetres behind the eye.
    const skull = new THREE.Vector3(-0.1, 0.3, 0);
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward);
    const effects = new Effects3D(new THREE.Scene(), 256);
    effects.gougeEye(1, socket, forward, 1, 31);
    expect(effects.eyeOut(1)).toBe(true);
    const at = new THREE.Vector3();
    for (let frame = 0; frame < 240; frame += 1) {
      effects.anchorEye(1, socket, forward, skull, turn);
      effects.update(1 / 60);
      expect(effects.eyePosition(1, at)).toBe(true);
      expect(at.distanceTo(socket)).toBeLessThanOrEqual(EYE_NERVE_LENGTH + 1e-6);
      expect(at.y).toBeGreaterThan(CANVAS_TOP);
      // In front of the face plane through the socket.
      expect(at.x).toBeGreaterThan(socket.x + 0.01);
    }
    // At rest it hangs below the socket.
    expect(at.y).toBeLessThan(socket.y - 0.02);
    effects.gougeEye(1, socket, forward, 1, 31);
    effects.restoreFighter(1);
    expect(effects.eyeOut(1)).toBe(false);
    effects.dispose();
    const reduced = new Effects3D(new THREE.Scene(), 256);
    reduced.setBloodLevel("reduced");
    reduced.gougeEye(0, socket, forward, 1, 32);
    expect(reduced.eyeOut(0)).toBe(false);
    reduced.dispose();
  });

  it("is shot close in the finish, aimed at the eye from the side it hangs on", () => {
    const effects = new Effects3D(new THREE.Scene(), 256);
    const socket = new THREE.Vector3(0.6, 0.3, 0.2);
    effects.gougeEye(1, socket, new THREE.Vector3(1, 0, 0), 1, 40);
    effects.anchorEye(1, socket, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.5, 0.3, 0.2), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
    for (let frame = 0; frame < 60; frame += 1) effects.update(1 / 60);
    const eye = new THREE.Vector3();
    effects.eyePosition(1, eye);
    const stub = {
      finishCloseUpUntil: 101.7, finishCloseUpIndex: 1, finishCloseUpBearing: null as number | null, headCacheValid: [true, true],
      headCache: [new THREE.Vector3(), new THREE.Vector3(0.5, 0.35, 0.2)], arcadeInjuries: [null, "eye_right"], effects,
      closeUpTarget: new THREE.Vector3(), closeUpFacing: new THREE.Vector3(), closeUpPosition: new THREE.Vector3(), replayLookAt: new THREE.Vector3(),
      tmpA: new THREE.Vector3(-1.6, 0, -1.2), tmpB: new THREE.Vector3(-1.2, 0, 0.1), refereePosition: new THREE.Vector3(-0.6, 0, -1.9),
      headWorldPose: () => ({ position: new THREE.Vector3(0.5, 0.3, 0.2), quaternion: new THREE.Quaternion() }),
      eyeInSight: (FightRenderer.prototype as unknown as { eyeInSight: unknown }).eyeInSight,
    };
    const shot = (FightRenderer.prototype as unknown as { closeUpFrame(this: unknown, seconds: number): { position: THREE.Vector3; lookAt: THREE.Vector3 } }).closeUpFrame.call(stub, 100.2);
    expect(shot.lookAt.distanceTo(eye)).toBeLessThan(1e-6);
    expect(Math.hypot(shot.position.x - eye.x, shot.position.z - eye.z)).toBeLessThan(0.5);
    // The eye hangs on the +X side of the head, and the camera is there with it.
    expect(shot.position.x).toBeGreaterThan(eye.x);
    effects.dispose();
  });

  it("shoots the head instead when the eye hangs under a face that lies on the canvas", () => {
    const effects = new Effects3D(new THREE.Scene(), 256);
    const socket = new THREE.Vector3(0.5, 0.16, 0.2);
    const down = new THREE.Vector3(0, -1, 0);
    effects.gougeEye(1, socket, down, 1, 40);
    effects.anchorEye(1, socket, down, new THREE.Vector3(0.5, 0.26, 0.2), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), down));
    for (let frame = 0; frame < 60; frame += 1) effects.update(1 / 60);
    const eye = new THREE.Vector3();
    effects.eyePosition(1, eye);
    const head = new THREE.Vector3(0.5, 0.3, 0.2);
    const stub = {
      finishCloseUpUntil: 101.7, finishCloseUpIndex: 1, finishCloseUpBearing: null as number | null, headCacheValid: [true, true],
      headCache: [new THREE.Vector3(), head], arcadeInjuries: [null, "eye_right"], effects, graphs: null,
      closeUpTarget: new THREE.Vector3(), closeUpFacing: new THREE.Vector3(), closeUpPosition: new THREE.Vector3(), replayLookAt: new THREE.Vector3(),
      tmpA: new THREE.Vector3(-1.6, 0, -1.2), tmpB: new THREE.Vector3(-1.2, 0, 0.1), refereePosition: new THREE.Vector3(-0.6, 0, -1.9),
      headWorldPose: () => ({ position: new THREE.Vector3(0.5, 0.26, 0.2), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), down) }),
      eyeInSight: (FightRenderer.prototype as unknown as { eyeInSight: unknown }).eyeInSight,
    };
    const shot = (FightRenderer.prototype as unknown as { closeUpFrame(this: unknown, seconds: number): { position: THREE.Vector3; lookAt: THREE.Vector3 } }).closeUpFrame.call(stub, 100.2);
    expect(eye.y).toBeLessThan(0.2);
    expect(shot.lookAt.distanceTo(head)).toBeLessThan(1e-6);
    expect(shot.position.y).toBeGreaterThan(head.y + 0.6);
    effects.dispose();
  });
});
