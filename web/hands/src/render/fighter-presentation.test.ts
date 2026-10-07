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
