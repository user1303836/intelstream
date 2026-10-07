import * as THREE from "three";
import { fighter as baseFighter } from "../test/fixtures";
import type { FighterSnapshot } from "../types";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { FightRenderer } from "./renderer";
import { worldPosition, type CanonicalBone } from "./rig";
import { worldMapping } from "./world";

const mapping = worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 });
const gltf = await loadBoxerGlb();

const bone = (boxer: SkinnedBoxer, name: CanonicalBone, out = new THREE.Vector3()): THREE.Vector3 => {
  boxer.root.updateMatrixWorld(true);
  return worldPosition(boxer.rig.bones[name], out);
};

/** World x of the front of a fighter's gloves: the skinned glove surface furthest along `toward` (+1 or -1). */
function gloveFront(boxer: SkinnedBoxer, toward: number): number {
  boxer.root.updateMatrixWorld(true);
  let front = -Infinity;
  const vertex = new THREE.Vector3();
  for (const side of ["left", "right"] as const) {
    const mesh = boxer.gloveMesh(side);
    const count = mesh.geometry.getAttribute("position").count;
    for (let index = 0; index < count; index += 3) {
      mesh.getVertexPosition(index, vertex).applyMatrix4(mesh.matrixWorld);
      front = Math.max(front, vertex.x * toward);
    }
  }
  return front * toward;
}

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

describe("glove touch", () => {
  it("walks both fighters in from their marks until the gloves meet, and back onto them before the bell", () => {
    const blue = makeGraph();
    const red = makeGraph({ skin: 0x6e4128, gear: 0xb91c1c });
    // Through the three-second countdown the engine holds both fighters on their marks, 2.2 m apart.
    const left: FighterSnapshot = { ...baseFighter("one"), x: -180, y: 0, facing_x: 1000, facing_y: 0 };
    const right: FighterSnapshot = { ...baseFighter("two"), x: 180, y: 0, facing_x: -1000, facing_y: 0 };
    const marks = [mapping.x(-180), mapping.x(180)];
    const blobs = [0, 1, 2].map(() => new THREE.Mesh());
    const renderer = {
      blobShadows: blobs, tmpA: new THREE.Vector3(marks[0], 0, 0), tmpB: new THREE.Vector3(marks[1], 0, 0), refereePosition: new THREE.Vector3(0, 0, -2),
      graphs: [blue.graph, red.graph], buffer: { latest: () => null },
    };
    const updateBlobShadows = (FightRenderer.prototype as unknown as { updateBlobShadows: () => void }).updateBlobShadows;
    let renderTick = 0;
    let closest = Infinity;
    let fastest = 0;
    let atBell: number[] | null = null;
    for (let frame = 0; frame < 240; frame += 1) {
      renderTick += 0.5;
      const ticksLeft = 90 - Math.ceil(renderTick);
      const countdown = ticksLeft > 0 ? ticksLeft : null;
      const before = [blue.boxer.root.position.x, red.boxer.root.position.x];
      blue.graph.setCountdown(countdown);
      red.graph.setCountdown(countdown);
      blue.graph.update(left, right, 1 / 60, renderTick / 30, false, "full", renderTick);
      red.graph.update(right, left, 1 / 60, renderTick / 30, false, "full", renderTick);
      if (frame > 0) fastest = Math.max(fastest, Math.abs(blue.boxer.root.position.x - before[0]!), Math.abs(red.boxer.root.position.x - before[1]!));
      if (ticksLeft <= 40 && ticksLeft >= 24) closest = Math.min(closest, gloveFront(red.boxer, -1) - gloveFront(blue.boxer, 1));
      if (ticksLeft === 30) {
        updateBlobShadows.call(renderer);
        expect(blobs[0]!.position.x).toBeCloseTo(blue.boxer.root.position.x, 6);
        expect(blobs[1]!.position.x).toBeCloseTo(red.boxer.root.position.x, 6);
        expect(blobs[0]!.position.x - marks[0]!).toBeGreaterThan(0.3);
      }
      if (countdown === null && atBell === null) atBell = [blue.boxer.root.position.x, red.boxer.root.position.x];
    }
    expect(closest).toBeLessThan(0.02);
    expect(closest).toBeGreaterThan(-0.03);
    expect(fastest).toBeLessThan(0.025);
    expect(Math.abs(atBell![0]! - marks[0]!)).toBeLessThan(1e-3);
    expect(Math.abs(atBell![1]! - marks[1]!)).toBeLessThan(1e-3);
    expect(Math.abs(blue.boxer.root.position.x - marks[0]!)).toBeLessThan(1e-3);
  });
});
