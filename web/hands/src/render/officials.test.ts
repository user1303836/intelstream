import * as THREE from "three";
import { fighter as baseFighter, snapshot as baseSnapshot } from "../test/fixtures";
import type { EngineSnapshot, FighterSnapshot } from "../types";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { FightRenderer, refereeSpacing } from "./renderer";
import { worldPosition } from "./rig";
import { worldMapping } from "./world";

const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
const gltf = await loadBoxerGlb();

const official = (): SkinnedBoxer => new SkinnedBoxer(gltf, { skin: 0xc79b76, gear: 0x3b57b8, pants: 0x14161c, bodyMap: new THREE.Texture() });

/** Skinned world positions of a boxer's mesh vertices, optionally only those bound mostly to bones matching `bones`. */
function surface(boxer: SkinnedBoxer, meshes: RegExp, bones?: RegExp): THREE.Vector3[] {
  boxer.root.updateMatrixWorld(true);
  const out: THREE.Vector3[] = [];
  boxer.root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh) || !meshes.test(object.name)) return;
    const skinIndex = object.geometry.getAttribute("skinIndex");
    const skinWeight = object.geometry.getAttribute("skinWeight");
    for (let index = 0; index < object.geometry.getAttribute("position").count; index += 1) {
      if (bones !== undefined) {
        let strongest = 0;
        for (let slot = 1; slot < 4; slot += 1) if (skinWeight.getComponent(index, slot) > skinWeight.getComponent(index, strongest)) strongest = slot;
        if (!bones.test(object.skeleton.bones[skinIndex.getComponent(index, strongest)]!.name)) continue;
      }
      out.push(object.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(object.matrixWorld));
    }
  });
  return out;
}

const closest = (from: readonly THREE.Vector3[], to: readonly THREE.Vector3[]): number => {
  let best = Infinity;
  for (const a of from) for (const b of to) best = Math.min(best, a.distanceToSquared(b));
  return Math.sqrt(best);
};

describe("referee clinch break", () => {
  const updateReferee = (FightRenderer.prototype as unknown as { updateReferee: (dt: number, time: number, snapshot: EngineSnapshot | null, sampledTick: number) => void }).updateReferee;

  it.each([["behind the fighters", -Math.PI / 2], ["almost in line with them", -0.3], ["in front of them", 0.9]])("steps in from %s and puts a palm on each fighter's chest", (_from, angle) => {
    const referee = official();
    const graph = new BoxingGraph(referee, mapping, { referee: true });
    const blue = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    const red = new SkinnedBoxer(gltf, { skin: 0x6e4128, gear: 0xb91c1c });
    const blueGraph = new BoxingGraph(blue, mapping);
    const redGraph = new BoxingGraph(red, mapping);
    // The renderer's referee state, driven through its own placement code.
    const renderer = {
      referee: graph, mapping, tmpA: new THREE.Vector3(), tmpB: new THREE.Vector3(),
      refereePosition: new THREE.Vector3(Math.cos(angle) * 2, 0, Math.sin(angle) * 2), refereeAway: new THREE.Vector3(), refereeVelocity: new THREE.Vector3(), refereeYaw: 0,
    };
    let tick = 0;
    const step = (one: FighterSnapshot, two: FighterSnapshot): void => {
      tick += 0.5;
      renderer.tmpA.set(mapping.x(one.x), 0, mapping.z(one.y));
      renderer.tmpB.set(mapping.x(two.x), 0, mapping.z(two.y));
      blueGraph.update(one, two, 1 / 60, tick / 30, false, "full", tick);
      redGraph.update(two, one, 1 / 60, tick / 30, false, "full", tick);
      updateReferee.call(renderer, 1 / 60, tick / 30, { ...baseSnapshot(Math.ceil(tick)), fighters: [one, two] }, tick);
    };
    // Tied up at the hold distance, then the engine's break pushes them apart and the referee_break event arrives.
    const heldBlue: FighterSnapshot = { ...baseFighter("one"), x: -30, y: 0, facing_x: 1000, facing_y: 0, clinch_ticks: 30 };
    const heldRed: FighterSnapshot = { ...baseFighter("two"), x: 30, y: 0, facing_x: -1000, facing_y: 0, clinch_ticks: 30 };
    for (let frame = 0; frame < 120; frame += 1) step(heldBlue, heldRed);
    graph.breakClinch();
    for (let frame = 0; frame < 4; frame += 1) step(heldBlue, heldRed);
    for (let frame = 0; frame < 50; frame += 1) step({ ...heldBlue, x: -75, clinch_ticks: 0 }, { ...heldRed, x: 75, clinch_ticks: 0 });

    expect(Math.hypot(renderer.refereePosition.x, renderer.refereePosition.z)).toBeLessThan(0.55);
    const gloves = { left: surface(referee, /^BoxerGloveLeft$/), right: surface(referee, /^BoxerGloveRight$/) };
    const reaches: Record<"left" | "right", number>[] = [];
    for (const fighter of [blue, red]) {
      const chest = surface(fighter, /^BoxerBody$/, /^(Spine|Hips|Neck)/);
      reaches.push({ left: closest(gloves.left, chest), right: closest(gloves.right, chest) });
      // On the chest, not buried in it.
      const centre = worldPosition(fighter.rig.bones.upperChest, new THREE.Vector3()).setY(0);
      for (const side of ["gloveL", "gloveR"] as const) expect(worldPosition(referee.rig.bones[side], new THREE.Vector3()).setY(0).distanceTo(centre)).toBeGreaterThan(0.22);
    }
    // One palm on each fighter.
    const [first, second] = reaches as [Record<"left" | "right", number>, Record<"left" | "right", number>];
    expect(Math.min(Math.max(first.left, second.right), Math.max(first.right, second.left))).toBeLessThan(0.03);
  });

  it("only comes in that close to break a clinch, and a count still comes first", () => {
    expect(refereeSpacing(false, true, true).standoff).toBeLessThan(0.5);
    expect(refereeSpacing(false, true, true).standoff).toBeLessThan(refereeSpacing(false, true).standoff);
    expect(refereeSpacing(true, false, true)).toEqual(refereeSpacing(true, false));
  });
});

describe("referee count", () => {
  it("chops the counting arm down onto each number as it changes", () => {
    const referee = official();
    const graph = new BoxingGraph(referee, mapping, { referee: true });
    const self: FighterSnapshot = { ...baseFighter("referee"), x: 0, y: 160, facing_x: 0, facing_y: -1000 };
    const focus: FighterSnapshot = { ...baseFighter("focus"), x: 0, y: -140 };
    // Knocked down on tick 308: the engine counts a number every 30 ticks after that, and the numbers
    // change a quarter of a second past each whole second of the clock (where a free-running beat sits high).
    const knockdownTick = 308;
    const heights: number[] = [];
    const changes: number[] = [];
    let renderTick = 280;
    let shown = -1;
    for (let frame = 0; frame < 330; frame += 1) {
      renderTick += 0.5;
      const presentedTick = Math.ceil(renderTick);
      const counting = presentedTick >= knockdownTick;
      const count = counting ? Math.floor((presentedTick - knockdownTick) / 30) : 0;
      if (counting && count !== shown) {
        if (shown >= 0) changes.push(frame);
        shown = count;
      }
      graph.setRefereeCount(counting, count);
      graph.update(self, focus, 1 / 60, renderTick / 30, false, "off", renderTick);
      referee.root.updateMatrixWorld(true);
      heights.push(worldPosition(referee.rig.bones.gloveR, new THREE.Vector3()).y);
    }
    expect(changes.length).toBeGreaterThanOrEqual(4);
    for (const change of changes) {
      const around = heights.slice(change - 20, change + 21);
      // At its lowest as the number changes, having come down hard into it.
      expect(heights[change]!).toBeLessThan(Math.min(...around) + 0.005);
      expect(heights[change - 6]! - heights[change]!).toBeGreaterThan(0.05);
    }
  });
});
