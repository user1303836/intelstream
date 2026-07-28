import * as THREE from "three";
import { buildArena } from "./arena";
import { BoxerAnimator } from "./animation";
import { buildBoxer, buildReferee } from "./boxer";
import { CameraDirector } from "./camera";
import { Effects3D } from "./effects";
import { drawHud, HUD_MAX_GUARD, HUD_MAX_POISE, scoreTotal } from "./hud";
import { buildRing } from "./ring";
import { resizeHighDpi } from "./viewport";
import { PALETTES, worldMapping } from "./world";
import { fighter, publicPlayers, snapshot } from "../test/fixtures";

const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 330 });

describe("world mapping", () => {
  it("maps sim up (W/stick-up) away from the broadcast camera and sim right to screen right", () => {
    const map = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 330 });
    expect(map.z(330)).toBeLessThan(0);
    expect(map.z(-330)).toBeGreaterThan(0);
    expect(map.x(500)).toBeGreaterThan(0);
    expect(map.x(-500)).toBeLessThan(0);
    expect(Math.abs(map.x(500))).toBeCloseTo(Math.abs(map.z(330)), 5);
  });
});

describe("scene construction", () => {
  it("builds a ring with four posts, twelve ropes and a branded canvas", () => {
    const ring = buildRing();
    const tubes = ring.geometries.filter((geometry) => geometry.type === "TubeGeometry");
    expect(tubes).toHaveLength(12);
    expect(ring.textures.length).toBeGreaterThanOrEqual(1);
    expect(ring.group.getObjectByName("ring")).toBeTruthy();
    expect(ring.geometries.some((geometry) => geometry.type === "PlaneGeometry")).toBe(true);
  });

  it("builds anatomically complete boxers with distinct corner palettes", () => {
    const blue = buildBoxer(PALETTES[0]);
    const red = buildBoxer(PALETTES[1]);
    for (const joint of ["hips", "spine", "chest", "head", "shoulderL", "elbowL", "gloveL", "shoulderR", "elbowR", "gloveR", "hipL", "kneeL", "hipR", "kneeR"]) {
      expect(blue.root.getObjectByName(joint), joint).toBeTruthy();
    }
    expect(blue.gloveLMesh).toBeTruthy();
    expect(blue.gloveRMesh).toBeTruthy();
    expect((blue.gloveLMesh.material as THREE.MeshStandardMaterial).color.getHex()).not.toBe((red.gloveLMesh.material as THREE.MeshStandardMaterial).color.getHex());
    expect(blue.geometries.length).toBeGreaterThan(20);
  });

  it("builds a clothed referee sharing the boxer rig", () => {
    const referee = buildReferee();
    expect(referee.root.getObjectByName("hips")).toBeTruthy();
    expect(referee.root.getObjectByName("head")).toBeTruthy();
    expect(referee.materials.length).toBeGreaterThan(8);
  });

  it("builds and animates the arena crowd deterministically", () => {
    const arena = buildArena();
    arena.update(1.5, 1 / 60, false);
    arena.update(2.5, 1 / 60, true);
    expect(arena.group.children.length).toBeGreaterThan(5);
    arena.dispose();
  });
});

describe("boxer animation", () => {
  const make = () => {
    const rig = buildBoxer(PALETTES[0]);
    return { rig, animator: new BoxerAnimator(rig, mapping) };
  };

  it("moves the rig to authoritative world positions and faces the opponent", () => {
    const { rig, animator } = make();
    const one = { ...fighter("one"), x: -200, y: 100 };
    const two = { ...fighter("two"), x: 200, y: -50 };
    for (let i = 0; i < 60; i += 1) animator.update(one, two, 1 / 60, i / 60, false);
    expect(rig.root.position.x).toBeCloseTo(mapping.x(-200), 5);
    expect(rig.root.position.z).toBeCloseTo(mapping.z(100), 5);
    const expectedYaw = Math.atan2(mapping.x(200) - mapping.x(-200), (mapping.z(-50) - mapping.z(100)) * 0.45);
    expect(Math.abs(rig.root.rotation.y - expectedYaw)).toBeLessThan(0.6);
  });

  it("drives punch timelines from action transitions and returns to guard", () => {
    const { rig, animator } = make();
    const one = fighter("one");
    const two = fighter("two");
    for (let i = 0; i < 30; i += 1) animator.update(one, two, 1 / 60, i / 60, false);
    const guardZ = rig.gloveL.getWorldPosition(new THREE.Vector3()).z;
    const punching = { ...one, action: "straight" as const, action_hand: "right" as const, action_target: "head" as const, action_power: "normal" as const };
    let maxExtension = 0;
    for (let i = 0; i < 30; i += 1) {
      animator.update(i < 20 ? punching : one, two, 1 / 60, 0.5 + i / 60, false);
      const shoulder = rig.shoulderR.getWorldPosition(new THREE.Vector3());
      const glove = rig.gloveR.getWorldPosition(new THREE.Vector3());
      maxExtension = Math.max(maxExtension, shoulder.distanceTo(glove));
    }
    expect(maxExtension).toBeGreaterThan(0.55);
    expect(maxExtension).toBeLessThanOrEqual(0.67);
    for (let i = 0; i < 90; i += 1) animator.update(one, two, 1 / 60, 1.5 + i / 60, false);
    const recovered = rig.gloveL.getWorldPosition(new THREE.Vector3()).z;
    expect(Math.abs(recovered - guardZ)).toBeLessThan(0.25);
  });

  it("drops the hips to the canvas when downed and rises on recovery", () => {
    const { rig, animator } = make();
    const two = fighter("two");
    const downed = { ...fighter("one"), is_downed: true };
    for (let i = 0; i < 120; i += 1) animator.update(downed, two, 1 / 60, i / 60, false);
    expect(rig.hips.position.y).toBeLessThan(0.35);
    const standing = fighter("one");
    for (let i = 0; i < 240; i += 1) animator.update(standing, two, 1 / 60, 2 + i / 60, false);
    expect(rig.hips.position.y).toBeGreaterThan(0.9);
  });

  it("shows trauma overlays scaled by authoritative trauma", () => {
    const { rig, animator } = make();
    const two = fighter("two");
    const hurt = { ...fighter("one"), trauma: { head: 500, body: 900, left_eye: 300, right_eye: 40, left_cut: 260, right_cut: 0, swelling: 0, bleeding: 300 } };
    animator.update(hurt, two, 1 / 60, 0, false);
    expect((rig.bruiseL.material as THREE.MeshStandardMaterial).opacity).toBeGreaterThan(0.5);
    expect((rig.bruiseR.material as THREE.MeshStandardMaterial).opacity).toBeLessThan(0.5);
    expect((rig.cutL.material as THREE.MeshStandardMaterial).opacity).toBeGreaterThan(0.5);
    expect((rig.bodyBruise.material as THREE.MeshStandardMaterial).opacity).toBeGreaterThan(0.4);
  });

  it("reacts to impacts without mutating the snapshot", () => {
    const { animator } = make();
    const one = fighter("one");
    const two = fighter("two");
    const serialized = JSON.stringify(one);
    animator.impact({ direction: 1, amount: 300, blocked: false });
    animator.update(one, two, 1 / 60, 0, false);
    expect(JSON.stringify(one)).toBe(serialized);
  });

  it("grows swelling, streaks and rib bruising with trauma and gates blood by setting", () => {
    const { rig, animator } = make();
    const two = fighter("two");
    const hurt = { ...fighter("one"), trauma: { head: 800, body: 700, left_eye: 400, right_eye: 100, left_cut: 300, right_cut: 50, swelling: 300, bleeding: 350 } };
    animator.update(hurt, two, 1 / 60, 0, false, "full");
    expect(rig.swellL.scale.x).toBeGreaterThan(1);
    expect(rig.swellR.scale.x).toBeLessThan(rig.swellL.scale.x);
    expect((rig.streakL.material as THREE.MeshStandardMaterial).opacity).toBeGreaterThan(0.8);
    expect((rig.ribL.material as THREE.MeshStandardMaterial).opacity).toBeGreaterThan(0.5);
    expect((rig.noseStreak.material as THREE.MeshStandardMaterial).opacity).toBeGreaterThan(0.5);
    animator.update(hurt, two, 1 / 60, 0.1, false, "off");
    expect((rig.streakL.material as THREE.MeshStandardMaterial).opacity).toBe(0);
    expect((rig.cutL.material as THREE.MeshStandardMaterial).opacity).toBe(0);
    expect((rig.mouthBlood.material as THREE.MeshStandardMaterial).opacity).toBe(0);
    expect((rig.swellL.material as THREE.MeshStandardMaterial).opacity).toBeGreaterThan(0);
  });

  it("bloodies the attacker's gloves with the opponent's bleeding", () => {
    const { rig, animator } = make();
    const one = fighter("one");
    const bloodied = { ...fighter("two"), trauma: { head: 500, body: 0, left_eye: 0, right_eye: 0, left_cut: 300, right_cut: 200, swelling: 0, bleeding: 500 } };
    animator.update(one, bloodied, 1 / 60, 0, false, "full");
    const tinted = rig.gloveLMaterial.color.getHex();
    animator.update(one, fighter("two"), 1 / 60, 0.1, false, "full");
    expect(rig.gloveLMaterial.color.getHex()).not.toBe(tinted);
    expect(tinted).not.toBe(rig.gloveBaseColor.getHex());
    animator.update(one, bloodied, 1 / 60, 0.2, false, "off");
    expect(rig.gloveLMaterial.color.getHex()).toBe(rig.gloveBaseColor.getHex());
  });

  it("retracts a punch when the fighter goes down mid-animation", () => {
    const { rig, animator } = make();
    const two = fighter("two");
    const punching = { ...fighter("one"), action: "straight" as const, action_hand: "right" as const, action_target: "head" as const, action_power: "power" as const };
    for (let i = 0; i < 8; i += 1) animator.update(punching, two, 1 / 60, i / 60, false);
    const extendedZ = rig.gloveR.getWorldPosition(new THREE.Vector3()).z - rig.root.position.z;
    const downed = { ...punching, is_downed: true, action: null };
    for (let i = 0; i < 120; i += 1) animator.update(downed, two, 1 / 60, 1 + i / 60, false);
    const downZ = rig.gloveR.getWorldPosition(new THREE.Vector3()).z - rig.root.position.z;
    expect(downZ).toBeLessThan(extendedZ);
  });

  it("freezes the punch during hitstop and rotates the punching shoulder into a cross", () => {
    const { rig, animator } = make();
    const two = fighter("two");
    const punching = { ...fighter("one"), action: "straight" as const, action_hand: "right" as const, action_target: "head" as const, action_power: "normal" as const };
    for (let i = 0; i < 5; i += 1) animator.update(punching, two, 1 / 60, i / 60, false);
    const gloveBefore = rig.gloveR.getWorldPosition(new THREE.Vector3()).z;
    animator.landedHit(false);
    for (let i = 0; i < 3; i += 1) animator.update(punching, two, 1 / 60, 0.1 + i / 60, false);
    const gloveDuringStop = rig.gloveR.getWorldPosition(new THREE.Vector3()).z;
    expect(Math.abs(gloveDuringStop - gloveBefore)).toBeLessThan(0.05);
    for (let i = 0; i < 20; i += 1) animator.update(punching, two, 1 / 60, 0.3 + i / 60, false);
    expect(rig.hips.rotation.y).toBeGreaterThan(0.1);
    expect(rig.spine.rotation.y).toBeGreaterThan(0.1);
    const southpawRig = buildBoxer(PALETTES[1]);
    const southpawAnimator = new BoxerAnimator(southpawRig, mapping);
    const southpawPunch = { ...fighter("two"), stance: "southpaw" as const, action: "straight" as const, action_hand: "right" as const, action_target: "head" as const, action_power: "normal" as const };
    for (let i = 0; i < 20; i += 1) southpawAnimator.update(southpawPunch, fighter("one"), 1 / 60, i / 60, false);
    expect(southpawRig.spine.rotation.y).toBeGreaterThan(0.1);
  });

  it("drops level for body punches and springs the canvas landing on knockdown", () => {
    const { rig, animator } = make();
    const two = fighter("two");
    const bodyPunch = { ...fighter("one"), action: "straight" as const, action_hand: "left" as const, action_target: "body" as const, action_power: "normal" as const };
    for (let i = 0; i < 14; i += 1) animator.update(bodyPunch, two, 1 / 60, i / 60, false);
    const bodyHeight = rig.hips.position.y;
    const headPunch = { ...bodyPunch, action_target: "head" as const };
    const second = make();
    for (let i = 0; i < 14; i += 1) second.animator.update(headPunch, two, 1 / 60, i / 60, false);
    expect(bodyHeight).toBeLessThan(second.rig.hips.position.y - 0.03);
    const downed = { ...fighter("one"), is_downed: true };
    const third = make();
    let maxSpring = 0;
    for (let i = 0; i < 150; i += 1) {
      third.animator.update(downed, two, 1 / 60, i / 60, false);
      maxSpring = Math.max(maxSpring, Math.abs(third.animator.landingOffset));
    }
    expect(maxSpring).toBeGreaterThan(0.025);
    expect(third.rig.hips.position.y).toBeLessThan(0.35);
  });

  it("dances the taunt with overhead swings and hip wiggle", () => {
    const { rig, animator } = make();
    const two = fighter("two");
    const taunting = { ...fighter("one"), taunt_ticks: 45 };
    let maxGloveY = -Infinity;
    let maxRoll = 0;
    for (let i = 0; i < 40; i += 1) {
      animator.update({ ...taunting, taunt_ticks: 45 - i }, two, 1 / 60, i / 60, false);
      maxGloveY = Math.max(maxGloveY, rig.gloveL.getWorldPosition(new THREE.Vector3()).y);
      maxRoll = Math.max(maxRoll, Math.abs(rig.hips.rotation.z));
    }
    expect(maxGloveY).toBeGreaterThan(1.55);
    expect(maxRoll).toBeGreaterThan(0.05);
  });

  it("differentiates punch silhouettes: hook sweeps wide, jab recovers fastest", () => {
    const two = fighter("two");
    const trace = (action: "jab" | "hook"): { maxLateral: number; recoverFrames: number } => {
      const { rig, animator } = make();
      const punching = { ...fighter("one"), action, action_hand: "left" as const, action_target: "head" as const, action_power: "normal" as const };
      let maxLateral = 0;
      let peakZ = -Infinity;
      let peakTick = 0;
      let recoverTick = Infinity;
      for (let i = 0; i < 60; i += 1) {
        animator.update(i < 24 ? punching : fighter("one"), two, 1 / 60, i / 60, false);
        const local = rig.chest.worldToLocal(rig.gloveL.getWorldPosition(new THREE.Vector3()));
        maxLateral = Math.max(maxLateral, Math.abs(local.x));
        if (local.z > peakZ) {
          peakZ = local.z;
          peakTick = i;
        } else if (recoverTick === Infinity && peakTick > 0 && i > peakTick && local.z < 0.34) {
          recoverTick = i;
        }
      }
      return { maxLateral, recoverFrames: recoverTick - peakTick };
    };
    const jab = trace("jab");
    const hook = trace("hook");
    expect(hook.maxLateral).toBeGreaterThan(jab.maxLateral + 0.1);
    expect(jab.recoverFrames).toBeLessThan(hook.recoverFrames);
  });

  it("buckles the knees early in a knockdown before settling flat", () => {
    const { rig, animator } = make();
    const two = fighter("two");
    const downed = { ...fighter("one"), is_downed: true };
    let earlyKnee = 0;
    for (let i = 0; i < 18; i += 1) {
      animator.update(downed, two, 1 / 60, i / 60, false);
      earlyKnee = Math.max(earlyKnee, rig.kneeL.rotation.x);
    }
    expect(earlyKnee).toBeGreaterThan(0.5);
    for (let i = 0; i < 150; i += 1) animator.update(downed, two, 1 / 60, 1 + i / 60, false);
    expect(rig.kneeL.rotation.x).toBeLessThan(0.4);
  });

  it("mirrors southpaw glove placement", () => {
    const { rig, animator } = make();
    const one = { ...fighter("one"), stance: "southpaw" as const };
    const two = fighter("two");
    for (let i = 0; i < 30; i += 1) animator.update(one, two, 1 / 60, i / 60, false);
    const leftX = rig.gloveL.getWorldPosition(new THREE.Vector3()).x - rig.root.position.x;
    const orthodox = buildBoxer(PALETTES[0]);
    const orthodoxAnimator = new BoxerAnimator(orthodox, mapping);
    for (let i = 0; i < 30; i += 1) orthodoxAnimator.update(fighter("one"), two, 1 / 60, i / 60, false);
    const orthodoxLeftX = orthodox.gloveL.getWorldPosition(new THREE.Vector3()).x - orthodox.root.position.x;
    expect(Math.sign(leftX)).not.toBe(Math.sign(orthodoxLeftX));
  });
});

describe("camera direction", () => {
  it("follows the fighters midpoint and pushes in on knockdowns", () => {
    const director = new CameraDirector();
    for (let i = 0; i < 300; i += 1) director.update(1 / 60, i / 60, { x: -1.5, z: 0 }, { x: 1.5, z: 0 }, 3, false, 0, true);
    const farDistance = director.update(1 / 60, 6, { x: -1.5, z: 0 }, { x: 1.5, z: 0 }, 3, false, 0, true).position.z;
    for (let i = 0; i < 300; i += 1) director.update(1 / 60, 7 + i / 60, { x: -0.5, z: 0 }, { x: 0.5, z: 0 }, 1, false, 0, true);
    const nearDistance = director.update(1 / 60, 12, { x: -0.5, z: 0 }, { x: 0.5, z: 0 }, 1, false, 0, true).position.z;
    expect(nearDistance).toBeLessThan(farDistance);
    for (let i = 0; i < 300; i += 1) director.update(1 / 60, 13 + i / 60, { x: -0.5, z: 0 }, { x: 0.5, z: 0 }, 1, true, 0, true);
    const knockdown = director.update(1 / 60, 18, { x: -0.5, z: 0 }, { x: 0.5, z: 0 }, 1, true, 0, true);
    expect(knockdown.lookAt.y).toBeLessThan(1.12);
  });

  it("never applies shake under reduced motion", () => {
    const director = new CameraDirector();
    const calm = director.update(1 / 60, 1, { x: 0, z: 0 }, { x: 1, z: 0 }, 1, false, 0.1, true);
    expect(calm.position.y).toBeLessThan(2.2);
  });
});

describe("effects", () => {
  it("bounds particles, suppresses blood when off, and decays shake", () => {
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    effects.setBloodLevel("full");
    const origin = new THREE.Vector3(0, 0, 0);
    for (let id = 0; id < 40; id += 1) {
      effects.addEvent({ event_id: id, tick: 1, kind: "hit", actor_id: "one", target_id: "two", amount: 900, detail: "", blood: 400, direction: 1 }, origin, false);
    }
    expect(effects.liveParticles).toBeLessThanOrEqual(900);
    expect(effects.visibleDecals).toBeGreaterThan(0);
    const shaken = effects.shakeAmount;
    expect(shaken).toBeGreaterThan(0);
    for (let i = 0; i < 600; i += 1) effects.update(1 / 60);
    expect(effects.shakeAmount).toBeLessThan(shaken);
    expect(effects.liveParticles).toBe(0);
    effects.setBloodLevel("off");
    effects.clearDecals();
    effects.addEvent({ event_id: 999, tick: 1, kind: "hit", actor_id: "one", target_id: "two", amount: 100, detail: "", blood: 100, direction: 1 }, origin, false);
    expect(effects.visibleDecals).toBe(0);
    expect(effects.liveMist).toBe(0);
    effects.dispose();
  });

  it("spawns bounded drips, mist and splatter for severe bleeding", () => {
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    effects.setBloodLevel("full");
    const head = new THREE.Vector3(0, 1.56, 0);
    for (let i = 0; i < 300; i += 1) {
      effects.drip(head, 1.2, 1 / 30, false);
      effects.update(1 / 60);
    }
    expect(effects.liveParticles).toBeLessThanOrEqual(900);
    effects.addEvent({ event_id: 5, tick: 1, kind: "knockdown", actor_id: "one", target_id: "two", amount: 500, detail: "", blood: 300, direction: 1 }, new THREE.Vector3(), false);
    expect(effects.liveMist).toBeGreaterThan(0);
    effects.pool(0, 0, 1);
    effects.splatter(0, 0, 1);
    expect(effects.visibleDecals).toBeGreaterThan(2);
    effects.setBloodLevel("off");
    const before = effects.liveParticles;
    effects.drip(head, 1.2, 1, false);
    expect(effects.liveParticles).toBe(before);
    effects.pool(0.1, 0.1, 1);
    expect(effects.visibleDecals).toBe(0);
    effects.dispose();
  });
});

describe("viewport and broadcast HUD", () => {
  it("caps high-DPI canvas allocation", () => {
    const canvas = document.createElement("canvas");
    const resized = resizeHighDpi(canvas, 2);
    expect(resized?.dpr).toBeLessThanOrEqual(2);
    expect(canvas.width).toBe(1600);
  });

  it("keeps opponent get-up timing private while exposing the viewer prompt", () => {
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const players = Object.fromEntries(publicPlayers.map((p) => [p.id, p]));
    const base = snapshot();
    const opponentPrompt = { ...base, phase: "knockdown" as const, fighters: [base.fighters[0], { ...base.fighters[1], is_downed: true, get_up_prompt: "get_up_left" as const, get_up_count: 4 }] as const };
    drawHud(ctx, 800, 600, opponentPrompt, players, "one", null, 0);
    expect(texts.join(" ")).not.toContain("NOW!");
    expect(texts.join(" ")).not.toContain("GET READY");
    texts.length = 0;
    const ownPrompt = { ...opponentPrompt, fighters: [{ ...base.fighters[0], is_downed: true, get_up_prompt: "get_up_right" as const, get_up_meter: 2, get_up_required: 4 }, opponentPrompt.fighters[1]] as const };
    drawHud(ctx, 800, 600, ownPrompt, players, "one", null, 0);
    expect(texts.join(" ")).toContain("GET READY →");
    texts.length = 0;
    const inWindow = { ...ownPrompt, fighters: [{ ...base.fighters[0], is_downed: true, get_up_prompt: "get_up_right" as const, get_up_meter: 2, get_up_required: 4, get_up_window_start_tick: 5, get_up_window_end_tick: 15 }, opponentPrompt.fighters[1]] as const };
    drawHud(ctx, 800, 600, inWindow, players, "one", null, 0);
    expect(texts.join(" ")).toContain("NOW!");
  });

  it("renders broadcast plates, round card and totals", () => {
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const players = Object.fromEntries(publicPlayers.map((p) => [p.id, p]));
    drawHud(ctx, 1280, 720, snapshot(), players, "one", null, 0, 30);
    expect(texts).toContain("ONE");
    expect(texts).toContain("TWO");
    expect(texts).toContain("ROUND 1");
    expect(texts.some((text) => text.startsWith("STAMINA"))).toBe(true);
    expect(texts.some((text) => text.startsWith("HEALTH"))).toBe(true);
    expect(scoreTotal([10, 9, 10])).toBe(29);
    expect(HUD_MAX_GUARD).toBe(700);
    expect(HUD_MAX_POISE).toBe(600);
  });

  it("uses the bootstrap tick rate for the authoritative HUD clock", () => {
    const texts: string[] = [];
    const ctx = mockHudContext(texts);
    const state = { ...snapshot(), phase_ticks_remaining: 1205 };
    drawHud(ctx, 800, 600, state, Object.fromEntries(publicPlayers.map((player) => [player.id, player])), "one", null, 0, 20);
    expect(texts).toContain("1:00");
  });
});

function mockHudContext(texts: string[]): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  return {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    clearRect: () => {},
    fillText: (text: string) => texts.push(text),
    measureText: (text: string) => ({ width: text.length * 7 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    set fillStyle(_value: unknown) {},
    set strokeStyle(_value: unknown) {},
    set font(_value: string) {},
    set lineWidth(_value: number) {},
    set textAlign(_value: CanvasTextAlign) {},
    set textBaseline(_value: CanvasTextBaseline) {},
  } as unknown as CanvasRenderingContext2D;
}
