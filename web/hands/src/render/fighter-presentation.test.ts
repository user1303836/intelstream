import * as THREE from "three";
import { fighter as baseFighter } from "../test/fixtures";
import type { FighterSnapshot } from "../types";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { worldPosition, type CanonicalBone } from "./rig";
import { worldMapping } from "./world";

const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
const gltf = await loadBoxerGlb();

const bone = (boxer: SkinnedBoxer, name: CanonicalBone, out = new THREE.Vector3()): THREE.Vector3 => {
  boxer.root.updateMatrixWorld(true);
  return worldPosition(boxer.rig.bones[name], out);
};

function makeGraph(palette = { skin: 0xb0703f, gear: 0x1d4ed8 }): { boxer: SkinnedBoxer; graph: BoxingGraph } {
  const boxer = new SkinnedBoxer(gltf, palette);
  return { boxer, graph: new BoxingGraph(boxer, mapping) };
}

describe("corner stool", () => {
  it("stays where it stood until the fighter has risen off it, even if he walks out at the bell", () => {
    const { boxer, graph } = makeGraph();
    const stool = boxer.root.getObjectByName("stool")!;
    const corner: FighterSnapshot = { ...baseFighter("one"), x: -365, y: -365, facing_x: 707, facing_y: 707 };
    const opponent: FighterSnapshot = { ...baseFighter("two"), x: 365, y: 365 };
    graph.setResting(true);
    let tick = 0;
    for (let frame = 0; frame < 180; frame += 1) {
      tick += 0.5;
      graph.update(corner, opponent, 1 / 60, frame / 60, false, "full", tick);
    }
    expect(graph.stoolVisible).toBe(true);
    expect(bone(boxer, "hips").y).toBeLessThan(0.56);
    const seat = stool.getWorldPosition(new THREE.Vector3());

    // The bell: the round starts and the fighter walks straight out of the corner at full speed.
    graph.setResting(false);
    let visibleFrames = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      tick += 0.5;
      const walking = { ...corner, x: corner.x + frame * 2.5, y: corner.y + frame * 2.5, velocity_x: 5, velocity_y: 5 };
      graph.update(walking, opponent, 1 / 60, 3 + frame / 60, false, "full", tick);
      const hips = bone(boxer, "hips").y;
      if (graph.stoolVisible) {
        visibleFrames += 1;
        expect(stool.getWorldPosition(new THREE.Vector3()).distanceTo(seat)).toBeLessThan(1e-6);
      } else {
        expect(hips).toBeGreaterThan(0.7);
      }
    }
    expect(visibleFrames).toBeGreaterThan(6);
    expect(graph.stoolVisible).toBe(false);
  });
});

describe("taunt", () => {
  it("beckons four times and moves the glove on every frame, not on the server's ticks", () => {
    const { boxer, graph } = makeGraph();
    const idle: FighterSnapshot = { ...baseFighter("one"), x: 0, y: 0, facing_x: 0, facing_y: -1000 };
    const opponent: FighterSnapshot = { ...baseFighter("two"), x: 0, y: -150, facing_x: 0, facing_y: 1000 };
    let renderTick = 100;
    for (let frame = 0; frame < 30; frame += 1) {
      renderTick += 0.5;
      graph.update(idle, opponent, 1 / 60, renderTick / 30, false, "full", renderTick);
    }
    // At 60 frames a second each snapshot, with its whole-tick taunt count, is presented for two frames.
    const start = Math.ceil(renderTick);
    const reach: number[] = [];
    for (let frame = 0; frame < 140; frame += 1) {
      renderTick += 0.5;
      const tauntTicks = Math.max(0, 60 - (Math.ceil(renderTick) - start));
      graph.update({ ...idle, taunt_ticks: tauntTicks }, opponent, 1 / 60, renderTick / 30, false, "full", renderTick);
      reach.push(bone(boxer, "gloveL").z);
    }
    const steps = reach.slice(1).map((z, index) => z - reach[index]!);
    let held = 0;
    for (let index = 1; index < steps.length - 1; index += 1) {
      const around = (Math.abs(steps[index - 1]!) + Math.abs(steps[index + 1]!)) / 2;
      if (around > 0.004 && Math.abs(steps[index]!) < around * 0.25) held += 1;
    }
    expect(held).toBeLessThan(5);
    const outstretched = Math.max(...reach);
    let beckons = 0;
    let curled = false;
    for (const z of reach) {
      if (!curled && z < outstretched - 0.15) {
        curled = true;
        beckons += 1;
      } else if (curled && z > outstretched - 0.05) {
        curled = false;
      }
    }
    expect(beckons).toBe(4);
  });
});
