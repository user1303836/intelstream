import * as THREE from "three";
import { fighter } from "../test/fixtures";
import { Effects3D } from "./effects";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { bakeSkinnedPart } from "./renderer";
import { worldMapping } from "./world";

const gltf = await loadBoxerGlb();
const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });

/** A fighter of the real model standing in guard, facing his opponent. */
function inGuard(): SkinnedBoxer {
  const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
  const graph = new BoxingGraph(boxer, mapping);
  const self = { ...fighter("one"), x: 0, y: 0, facing_x: 0, facing_y: -1000 };
  const opponent = { ...fighter("two"), x: 0, y: -150, facing_x: 0, facing_y: 1000 };
  for (let frame = 0; frame < 60; frame += 1) graph.update(self, opponent, 1 / 60, frame / 60, false, "full", frame / 2);
  boxer.root.updateMatrixWorld(true);
  return boxer;
}

describe("severed glove", () => {
  it("keeps only the glove's own vertices and caps the wrist on the glove", () => {
    const boxer = inGuard();
    const glove = boxer.gloveMesh("left");
    const sourceIndex = glove.geometry.getIndex()!;
    const own = new Set(Array.from({ length: sourceIndex.count }, (_unused, corner) => sourceIndex.getX(corner)));
    expect(own.size).toBeLessThan(glove.geometry.getAttribute("position").count);
    const bone = boxer.bone("gloveL")!;
    const pivot = bone.getWorldPosition(new THREE.Vector3());
    const turn = bone.getWorldQuaternion(new THREE.Quaternion());
    const baked = bakeSkinnedPart(glove, pivot, turn);
    const positions = baked.geometry.getAttribute("position");
    expect(positions.count).toBe(own.size);
    const index = baked.geometry.getIndex()!;
    expect(index.count).toBe(sourceIndex.count);
    let lowest = Infinity;
    for (let corner = 0; corner < index.count; corner += 1) lowest = Math.min(lowest, positions.getY(index.getX(corner)));

    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    effects.dismemberHand(0, "left", pivot, turn, 1, 7, 0x1d4ed8, baked);
    const hand = scene.children.find((child) => child instanceof THREE.Mesh && child.geometry === baked.geometry)!;
    const cap = hand.children[0]!;
    expect(cap.visible).toBe(true);
    // The wrist cap sits on the glove's own surface, not out where the other glove's vertices were.
    expect(Math.abs(cap.position.y - lowest)).toBeLessThan(0.01);
    effects.dispose();
  });
});
