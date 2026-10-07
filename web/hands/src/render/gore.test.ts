import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fighter } from "../test/fixtures";
import type { CombatEvent, FighterSnapshot } from "../types";
import { BIG_SHOT, BLOOD_SHADES, HARD_SHOT, ROCKING_COUNTER, bloodDropsFor, bloodShade, buildChunkGeometry, buildDropletGeometry, buildWoundGeometry, closeCut, cutRim, dropletShape, teethFor } from "./gore";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { HEAD_SITES, InjuryShading, NECK_CUT_HEIGHT, applyHeadTrauma } from "./injury";
import { SCANNED_LOOK, lookShape } from "./looks";
import { Effects3D, confineToRopes } from "./effects";
import { FightRenderer, aboveNeckCut, bakeSeveredHead, bakeSkinnedPart, closeUpAngle, keepClear } from "./renderer";
import { CANVAS_TOP, ROPE_LINE, worldMapping } from "./world";

const gltf = await loadBoxerGlb();

type Pose = { position: THREE.Vector3; quaternion: THREE.Quaternion };
const renderer = FightRenderer.prototype as unknown as {
  headWorldPose(this: unknown, index: number): Pose | null;
  stumpWorldPose(this: unknown, index: number): (Pose & { rim: Float32Array }) | null;
  closeUpFrame(this: unknown, seconds: number): { position: THREE.Vector3; lookAt: THREE.Vector3 } | null;
};

describe("flesh chunk", () => {
  it("is an uneven, flattened lump rather than a regular solid", () => {
    const geometry = buildChunkGeometry();
    const position = geometry.getAttribute("position");
    expect(position.count).toBeGreaterThan(60);
    geometry.computeBoundingBox();
    const size = geometry.boundingBox!.getSize(new THREE.Vector3());
    expect(size.y).toBeLessThan(size.x * 0.8);
    expect(size.x).toBeGreaterThan(0.04);
    expect(size.x).toBeLessThan(0.09);
    const vertex = new THREE.Vector3();
    let near = Infinity;
    let far = 0;
    for (let index = 0; index < position.count; index += 1) {
      const reach = vertex.fromBufferAttribute(position, index).setY(0).length();
      if (Math.abs(position.getY(index)) > 0.004) continue;
      near = Math.min(near, reach);
      far = Math.max(far, reach);
    }
    expect(far / near).toBeGreaterThan(1.3);
  });

  it("shades smoothly", () => {
    const geometry = buildChunkGeometry();
    expect(geometry.getIndex()).not.toBeNull();
    const normal = geometry.getAttribute("normal");
    const n = new THREE.Vector3();
    for (let index = 0; index < normal.count; index += 1) expect(n.fromBufferAttribute(normal, index).length()).toBeCloseTo(1, 3);
  });
});

describe("wound surface", () => {
  it("meets the skin at the rim, rises in the middle and faces outward", () => {
    const geometry = buildWoundGeometry(0.07, 0.05, 0.01);
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    expect(position.getY(0)).toBeCloseTo(0.01, 6);
    let rim = 0;
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index) / 0.07;
      const z = position.getZ(index) / 0.05;
      const reach = Math.hypot(x, z);
      expect(reach).toBeLessThanOrEqual(1 + 1e-6);
      expect(normal.getY(index)).toBeGreaterThan(0.5);
      if (reach > 1 - 1e-6) {
        rim += 1;
        expect(position.getY(index)).toBeCloseTo(0, 6);
      }
    }
    expect(rim).toBe(28);
  });
});

describe("cut rim", () => {
  it("runs round the opening a cut leaves and ignores the seams and edges the mesh already had", () => {
    // An open tube with a seam down one side: the seam's vertices are doubled, as a textured mesh's are.
    const tube = new THREE.CylinderGeometry(1, 1, 4, 12, 4, true);
    const position = tube.getAttribute("position");
    const rim = cutRim(tube, (vertex) => vertex.y > 0.5);
    expect(rim).toHaveLength(12 * 2);
    expect(new Set(rim).size).toBe(12);
    for (const index of rim) expect(position.getY(index)).toBeCloseTo(1, 6);
    for (let edge = 0; edge < rim.length; edge += 2) {
      const a = new THREE.Vector3().fromBufferAttribute(position, rim[edge]!);
      const b = new THREE.Vector3().fromBufferAttribute(position, rim[edge + 1]!);
      expect(a.distanceTo(b)).toBeCloseTo(2 * Math.sin(Math.PI / 12), 6);
    }
    expect(cutRim(tube, () => true)).toEqual([]);
    expect(cutRim(tube, () => false)).toEqual([]);
    tube.dispose();
  });

  it("finds the neck of the head mesh, centred on the spine", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    const position = boxer.headMesh.geometry.getAttribute("position");
    const rim = cutRim(boxer.headMesh.geometry, aboveNeckCut);
    expect(rim.length).toBeGreaterThan(40);
    // A closed loop: every vertex on it ends two of its edges.
    const ends = new Map<number, number>();
    for (const index of rim) ends.set(index, (ends.get(index) ?? 0) + 1);
    expect([...ends.values()].every((count) => count === 2)).toBe(true);
    const middle = new THREE.Vector3();
    const vertex = new THREE.Vector3();
    for (const index of rim) {
      vertex.fromBufferAttribute(position, index);
      expect(aboveNeckCut(vertex)).toBe(true);
      expect(Math.hypot(vertex.x, vertex.z + 3.8)).toBeLessThan(6.5);
      middle.add(vertex);
    }
    middle.multiplyScalar(1 / rim.length);
    expect(Math.abs(middle.x)).toBeLessThan(0.8);
    expect(Math.abs(middle.z + 3.8)).toBeLessThan(0.8);
    boxer.dispose();
  });
});

describe("neck cut", () => {
  it("leaves the chin and the back of the skull on the head and the collar on the shoulders", () => {
    expect(aboveNeckCut(new THREE.Vector3(0, 110.8, 4.2))).toBe(true);
    expect(aboveNeckCut(new THREE.Vector3(0, 114, -8))).toBe(true);
    expect(aboveNeckCut(new THREE.Vector3(0, 125, 0))).toBe(true);
    expect(aboveNeckCut(new THREE.Vector3(0, 111, -8))).toBe(false);
    expect(aboveNeckCut(new THREE.Vector3(8, 107, -4))).toBe(false);
  });

  it("cuts the skin and its shadow at the same line", () => {
    const material = new THREE.MeshStandardMaterial();
    const shading = new InjuryShading(material, HEAD_SITES);
    const shadow = shading.shadowMaterial();
    const skin = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>" };
    material.onBeforeCompile(skin as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    const depth = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <clipping_planes_fragment>" };
    shadow.onBeforeCompile(depth as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(depth.uniforms.uInjurySever).toBe(skin.uniforms.uInjurySever);
    // Both keep what is below the line: the collar stays on the shoulders and casts its shadow.
    expect(skin.fragmentShader).toContain("float below = injuryCutLine(injuryPos) - injuryPos.y;");
    expect(skin.fragmentShader).toContain("if (below < 0.0) discard;");
    expect(depth.fragmentShader).toContain("vInjuryPos.y > injuryCutLine(vInjuryPos)) discard;");
    expect(skin.uniforms.uInjurySever!.value).toBeGreaterThan(500);
    shading.setSevered(true);
    expect(skin.uniforms.uInjurySever!.value).toBe(NECK_CUT_HEIGHT);
    shading.setSevered(false);
    expect(skin.uniforms.uInjurySever!.value).toBeGreaterThan(500);
  });

  it("keeps the head mesh drawn for the collar while the head is off", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    boxer.setDecapitated(true);
    expect(boxer.isDecapitated).toBe(true);
    expect(boxer.headMesh.visible).toBe(true);
    expect(boxer.headInjury.uniforms.uInjurySever.value).toBe(NECK_CUT_HEIGHT);
    expect(boxer.headMesh.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
    boxer.setDecapitated(false);
    expect(boxer.headInjury.uniforms.uInjurySever.value).toBeGreaterThan(500);
    boxer.dispose();
  });

  it("leaves a severed head on an ear, its face turned to the side and the head on the canvas, however it spun", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    boxer.rig.resetToRest();
    boxer.root.updateMatrixWorld(true);
    const head = boxer.bone("head")!;
    const at = head.getWorldPosition(new THREE.Vector3());
    const turn = head.getWorldQuaternion(new THREE.Quaternion());
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    const face = new THREE.Vector3();
    const point = new THREE.Vector3();
    for (let event = 1; event <= 12; event += 1) {
      effects.clearDynamic();
      const baked = bakeSeveredHead(boxer, at, turn);
      effects.decapitate(1, at, turn, event % 2 === 0 ? 1 : -1, event * 7, 0xb0703f, baked);
      for (let frame = 0; frame < 240; frame += 1) effects.update(1 / 60);
      expect(effects.severedHeadFacing(1, face)).toBe(true);
      expect(Math.abs(face.y)).toBeLessThan(0.05);
      const mesh = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry === baked.geometry)!;
      mesh.updateMatrixWorld(true);
      const position = baked.geometry.getAttribute("position");
      const used = baked.geometry.getIndex()!;
      let lowest = Infinity;
      for (let index = 0; index < used.count; index += 1) lowest = Math.min(lowest, point.fromBufferAttribute(position, used.getX(index)).applyMatrix4(mesh.matrixWorld).y);
      expect(Math.abs(lowest - CANVAS_TOP)).toBeLessThan(0.005);
    }
    effects.dispose();
    boxer.dispose();
  });

  it("keeps the face it was beaten into once the head is off: the live skin, bruises, swelling, cuts and blood", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    applyHeadTrauma(boxer.headInjury, { head: 900, body: 0, left_eye: 600, right_eye: 200, left_cut: 300, right_cut: 0, swelling: 400, bleeding: 200 }, "full");
    boxer.rig.resetToRest();
    boxer.root.rotation.y = 0.7;
    boxer.root.updateMatrixWorld(true);
    const head = boxer.bone("head")!;
    const at = head.getWorldPosition(new THREE.Vector3());
    const turn = head.getWorldQuaternion(new THREE.Quaternion());
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    const baked = bakeSeveredHead(boxer, at, turn);
    effects.decapitate(0, at, turn, 1, 8, 0xb0703f, baked);
    const severed = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry === baked.geometry)!;
    const material = severed.material as THREE.MeshPhysicalMaterial;
    const live = boxer.headMesh.material as THREE.MeshPhysicalMaterial;
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect([material.roughness, material.metalness, material.clearcoat, material.clearcoatRoughness]).toEqual([live.roughness, live.metalness, live.clearcoat, live.clearcoatRoughness]);
    expect(material.map).toBe(live.map);
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: "#include <common>\n#include <begin_vertex>\n#include <morphtarget_vertex>", fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>" };
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain("vec3 injuryBind = bindPosition;");
    expect(shader.fragmentShader).toContain("uniform vec4 uInjuryCut");
    // The look's hair and beard first, then the injuries over them, as on the live head.
    expect(shader.fragmentShader.indexOf("uLookGroom.y")).toBeLessThan(shader.fragmentShader.indexOf("float cut = uInjuryCut[i].y;"));
    const own = shader.uniforms;
    const theirs = boxer.headInjury.uniforms;
    expect(own.uInjuryBruise!.value).toEqual(theirs.uInjuryBruise.value);
    expect(own.uInjurySwell!.value).toEqual(theirs.uInjurySwell.value);
    expect(own.uInjuryBlood!.value).toEqual(theirs.uInjuryBlood.value);
    expect(own.uInjuryCut!.value).toEqual(theirs.uInjuryCut.value);
    expect(own.uInjuryLid!.value).toEqual(theirs.uInjuryLid.value);
    expect(own.uInjuryNose!.value).toEqual(theirs.uInjuryNose.value);
    expect(Math.max(...(own.uInjurySwell!.value as Float32Array))).toBeGreaterThan(1);
    // Not cut open itself: the cut is the flesh closing its neck.
    expect(material.defines).not.toHaveProperty("HANDS_INJURY_OPEN");
    // The swelling and the broken nose are offsets in bind space, turned into the head's own frame as it
    // was baked: the bind positions, reshaped by the look and turned so, land on the baked ones.
    const toPart = own.uInjuryBindToPart!.value as THREE.Matrix3;
    const position = baked.geometry.getAttribute("position");
    const bind = baked.geometry.getAttribute("bindPosition");
    const used = baked.geometry.getIndex()!;
    const origin = used.getX(0);
    const shapedOrigin = lookShape(new THREE.Vector3().fromBufferAttribute(bind, origin), boxer.look, new THREE.Vector3());
    let worst = 0;
    for (let corner = 0; corner < used.count; corner += 97) {
      const vertex = used.getX(corner);
      const offset = lookShape(new THREE.Vector3().fromBufferAttribute(bind, vertex), boxer.look, new THREE.Vector3()).sub(shapedOrigin).applyMatrix3(toPart);
      const actual = new THREE.Vector3().fromBufferAttribute(position, vertex).sub(new THREE.Vector3().fromBufferAttribute(position, origin));
      worst = Math.max(worst, offset.distanceTo(actual));
    }
    expect(worst).toBeLessThan(1e-4);
    effects.restoreFighter(0);
    expect(Math.max(...(own.uInjuryBruise!.value as Float32Array))).toBe(0);
    effects.dispose();
    boxer.dispose();
  });

  it("takes the head off whole, without the skin it shares with the neck and chest trailing after the body", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    const head = boxer.bone("head")!;
    const bake = (): THREE.BufferGeometry => {
      boxer.root.updateMatrixWorld(true);
      return bakeSeveredHead(boxer, head.getWorldPosition(new THREE.Vector3()), head.getWorldQuaternion(new THREE.Quaternion())).geometry;
    };
    boxer.rig.resetToRest();
    const whole = bake();
    // A head snapped back on a body doubled over, as a knockout blow leaves it.
    boxer.rig.bones.chest.rotateX(0.5);
    boxer.rig.bones.upperChest.rotateX(0.4);
    boxer.rig.bones.neck.rotateX(0.6);
    head.rotateX(-1.2);
    const posed = bake();
    const index = posed.getIndex()!;
    const before = whole.getAttribute("position");
    const after = posed.getAttribute("position");
    let drift = 0;
    for (let at = 0; at < index.count; at += 1) {
      const vertex = index.getX(at);
      drift = Math.max(drift, new THREE.Vector3().fromBufferAttribute(after, vertex).distanceTo(new THREE.Vector3().fromBufferAttribute(before, vertex)));
    }
    expect(drift).toBeLessThan(0.001);
    whole.dispose();
    posed.dispose();
    boxer.dispose();
  });

  it("closes both sides of the cut with flesh that meets the skin all the way round and faces out", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    const graph = new BoxingGraph(boxer, worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 }));
    const self = { ...fighter("one"), x: -40, y: 0, facing_x: 1000, facing_y: 0, defense: "slip_left" as const };
    const other = { ...fighter("two"), x: 40, y: 0, facing_x: -1000, facing_y: 0 };
    for (let frame = 0; frame < 40; frame += 1) graph.update(self, other, 1 / 60, frame / 60, false, "full", 100 + frame / 2);
    const stub = { graphs: [graph, graph], tmpHead: new THREE.Vector3(), tmpHeadQuaternion: new THREE.Quaternion(), tmpStumpOffset: new THREE.Vector3(), tmpStump: new THREE.Vector3(), tmpStumpQuaternion: new THREE.Quaternion(), stumpRim: new Float32Array(0) };
    const pose = renderer.headWorldPose.call(stub, 0)!;
    const baked = bakeSkinnedPart(boxer.headMesh, pose.position, pose.quaternion, aboveNeckCut);
    const scene = new THREE.Scene();
    const effects = new Effects3D(scene);
    effects.decapitate(0, pose.position, pose.quaternion, 1, 8, 0xb0703f, baked);
    const stump = renderer.stumpWorldPose.call(stub, 0)!;
    effects.anchorStump(0, stump.position, stump.quaternion, stump.rim);
    scene.updateMatrixWorld(true);
    const head = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.geometry === baked.geometry)!;
    const cap = head.children[0] as THREE.Mesh;
    const wound = scene.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh && child !== head && child.visible && child.position.distanceTo(stump.position) < 1e-6)!;
    const rim = cutRim(boxer.headMesh.geometry, aboveNeckCut);

    const corners = (mesh: THREE.Mesh): THREE.Vector3[] => {
      const position = mesh.geometry.getAttribute("position");
      return Array.from({ length: position.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld));
    };
    const nearest = (point: THREE.Vector3, among: THREE.Vector3[]): number => Math.min(...among.map((other) => other.distanceTo(point)));
    const faces = (mesh: THREE.Mesh): THREE.Vector3 => {
      const normal = mesh.geometry.getAttribute("normal");
      const sum = new THREE.Vector3();
      for (let index = 0; index < normal.count; index += 1) sum.add(new THREE.Vector3().fromBufferAttribute(normal, index));
      return sum.normalize().transformDirection(mesh.matrixWorld);
    };

    const baked3 = baked.geometry.getAttribute("position");
    const bind = boxer.headMesh.geometry.getAttribute("position");
    const onHead = rim.map((index) => new THREE.Vector3().fromBufferAttribute(baked3, index).applyMatrix4(head.matrixWorld));
    const onBody = rim.map((index) => boxer.headMesh.applyBoneTransform(index, new THREE.Vector3().fromBufferAttribute(bind, index)).applyMatrix4(boxer.headMesh.matrixWorld));

    expect(cap.visible).toBe(true);
    expect(cap.geometry.getAttribute("position").count).toBe((rim.length / 2) * 3);
    for (const point of onHead) expect(nearest(point, corners(cap))).toBeLessThan(1e-5);
    for (const point of onBody) expect(nearest(point, corners(wound))).toBeLessThan(1e-5);
    // Nothing of the flesh reaches past the rim it closes.
    const middle = (points: THREE.Vector3[]): THREE.Vector3 => points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / points.length);
    const reach = (points: THREE.Vector3[]): number => Math.max(...points.map((point) => point.distanceTo(middle(points))));
    for (const corner of corners(cap)) expect(corner.distanceTo(middle(onHead))).toBeLessThanOrEqual(reach(onHead) + 1e-6);
    for (const corner of corners(wound)) expect(corner.distanceTo(middle(onBody))).toBeLessThanOrEqual(reach(onBody) + 1e-6);

    expect(faces(cap).dot(middle(onHead).sub(pose.position).normalize())).toBeGreaterThan(0.7);
    expect(faces(wound).dot(pose.position.clone().sub(middle(onBody)).normalize())).toBeGreaterThan(0.7);
    effects.dispose();
    graph.dispose();
  });

  it("falls back to a disc on the neck when the cut has not been measured", () => {
    const effects = new Effects3D(new THREE.Scene());
    effects.decapitate(0, new THREE.Vector3(0, 1.5, 0), new THREE.Quaternion(), 1, 8);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
    effects.anchorStump(0, new THREE.Vector3(0.2, 1.4, 0.1), turn);
    const stumps = (effects as unknown as { stumps: { mesh: THREE.Mesh }[] }).stumps;
    expect(stumps[0]!.mesh.position.toArray()).toEqual([0.2, 1.4, 0.1]);
    expect(stumps[0]!.mesh.quaternion.angleTo(turn)).toBeCloseTo(0, 6);
    expect(stumps[0]!.mesh.geometry.getAttribute("position").count).toBeGreaterThan(100);
    effects.dispose();
  });
});

describe("ropes and a severed part", () => {
  it("bounce a part that reaches them from inside", () => {
    expect(confineToRopes(2.35, 3, 2.28, 2.3)).toEqual({ position: 2.3, velocity: 3 * -0.42 });
    expect(confineToRopes(-2.35, -3, -2.28, 2.3)).toEqual({ position: -2.3, velocity: -3 * -0.42 });
    expect(confineToRopes(1.2, 3, 1.15, 2.3)).toEqual({ position: 1.2, velocity: 3 });
  });

  it("draw a part cut off beyond them back in without moving it", () => {
    const outward = confineToRopes(2.8, 3, 2.75, 2.3);
    expect(outward.position).toBe(2.8);
    expect(outward.velocity).toBeCloseTo(-2, 9);
    const still = confineToRopes(-2.6, 0, -2.6, 2.3);
    expect(still.position).toBe(-2.6);
    expect(still.velocity).toBeCloseTo(1.2, 9);
    expect(confineToRopes(2.8, -5, 2.88, 2.3)).toEqual({ position: 2.8, velocity: -5 });
  });

  it("never move a head or a hand cut off on the ropes more than it flies in a frame, and bring it inside", () => {
    for (const x of [1.8, 2.2, 2.45, 2.62, 2.82]) {
      const effects = new Effects3D(new THREE.Scene());
      const start = new THREE.Vector3(x, 1.55, -2.7);
      effects.decapitate(0, start, new THREE.Quaternion(), 1, 8);
      effects.dismemberHand(0, "left", start, new THREE.Quaternion(), 1, 9, 0x1d4ed8);
      const head = new THREE.Vector3();
      const before = start.clone();
      for (let frame = 0; frame < 360; frame += 1) {
        effects.update(1 / 60);
        effects.severedHeadPosition(0, head);
        expect(Math.hypot(head.x - before.x, head.z - before.z)).toBeLessThan(0.08);
        before.copy(head);
      }
      expect(Math.abs(head.x)).toBeLessThan(ROPE_LINE - 0.1);
      expect(Math.abs(head.z)).toBeLessThan(ROPE_LINE - 0.1);
      effects.dispose();
    }
  });
});

describe("blood in the air", () => {
  const hit = { event_id: 4, tick: 10, kind: "hit", actor_id: "one", target_id: "two", amount: 300, detail: "right:hook:head", blood: 100, direction: 1, action_id: null };
  const largest = (effects: Effects3D): number => {
    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    let found = 0;
    for (let index = 0; index < effects.dropletMesh.count; index += 1) {
      effects.dropletMesh.getMatrixAt(index, matrix);
      found = Math.max(found, scale.setFromMatrixScale(matrix).x);
    }
    return found;
  };

  it("is drawn at half the size or less for a close camera", () => {
    const sizes = [6, 1.2].map((distance) => {
      const effects = new Effects3D(new THREE.Scene());
      effects.setViewDistance(distance);
      effects.addEvent(hit, new THREE.Vector3(0, 1.5, 0), false);
      effects.update(1 / 60);
      const size = largest(effects);
      effects.dispose();
      return size;
    });
    expect(sizes[0]).toBeGreaterThan(0.004);
    expect(sizes[1]! / sizes[0]!).toBeLessThan(0.5);
    expect(sizes[1]! / sizes[0]!).toBeGreaterThan(0.3);
  });

  it("is a drop with a round head and a tail that thins out behind it", () => {
    const geometry = buildDropletGeometry();
    const position = geometry.getAttribute("position");
    const vertex = new THREE.Vector3();
    let tail = 0;
    let widestBehind = 0;
    for (let index = 0; index < position.count; index += 1) {
      vertex.fromBufferAttribute(position, index);
      if (vertex.y >= 0) expect(vertex.length()).toBeLessThan(1.001);
      tail = Math.min(tail, vertex.y);
      if (vertex.y < -0.6) widestBehind = Math.max(widestBehind, Math.hypot(vertex.x, vertex.z));
    }
    // A short tail: a drop, not a needle.
    expect(tail).toBeLessThan(-0.9);
    expect(tail).toBeGreaterThan(-1.3);
    expect(widestBehind).toBeGreaterThan(0.1);
    expect(widestBehind).toBeLessThan(0.62);
    geometry.dispose();
  });

  it("is smeared along its path and thinner for it, holding its volume", () => {
    const still = dropletShape(0.01, 0, { width: 0, length: 0 });
    expect(still.width).toBeCloseTo(0.01, 6);
    expect(still.length).toBeCloseTo(0.01, 6);
    let last = { ...still };
    for (const speed of [0.5, 1.5, 2.5, 3.4]) {
      const shape = dropletShape(0.01, speed, { width: 0, length: 0 });
      expect(shape.length).toBeGreaterThan(last.length + 0.001);
      expect(shape.width).toBeLessThan(last.width - 0.0003);
      expect(shape.width * shape.width * shape.length).toBeCloseTo(1e-6, 9);
      last = { ...shape };
    }
    // However fast, a drop stays a drop: no longer than a little over twice its size.
    const fastest = dropletShape(0.01, 40, { width: 0, length: 0 });
    expect(fastest.length).toBeLessThan(0.025);
    expect(fastest.width).toBeGreaterThan(0.0065);
  });

  it("is dark red, never pink", () => {
    for (const pick of [0, 0.34, 0.67, 0.999, 1, -1]) {
      const shade = bloodShade(pick);
      expect(BLOOD_SHADES).toContain(shade);
      expect(shade.r).toBeLessThan(0.45);
      expect(shade.g).toBeLessThan(shade.r * 0.05);
      expect(shade.b).toBeLessThan(shade.r * 0.05);
    }
    expect(bloodShade(0).r).toBeGreaterThan(bloodShade(0.999).r * 2);
  });

  const bloodSlots = (effects: Effects3D): number[] => {
    const colour = effects.dropletBuffers.color;
    const position = effects.dropletBuffers.position;
    const slots: number[] = [];
    for (let index = 0; index < colour.count; index += 1) if (position.getY(index) > -10 && colour.getY(index) < 0.2) slots.push(index);
    return slots;
  };
  const dropAt = (effects: Effects3D, slot: number): THREE.Vector3 => new THREE.Vector3().fromBufferAttribute(effects.dropletBuffers.position, slot);

  it("leaves in strands: two drops trail each leader along its path, slower and smaller", () => {
    const effects = new Effects3D(new THREE.Scene());
    effects.addEvent(hit, new THREE.Vector3(0, 1.5, 0), false);
    const slots = bloodSlots(effects);
    expect(slots.length).toBe(140);
    const origin = slots.map((slot) => dropAt(effects, slot));
    for (let frame = 0; frame < 9; frame += 1) effects.update(1 / 60);
    const matrix = new THREE.Matrix4();
    const size = (slot: number): number => {
      effects.dropletMesh.getMatrixAt(slot, matrix);
      const scale = new THREE.Vector3().setFromMatrixScale(matrix);
      return scale.x * scale.x * scale.y;
    };
    let strands = 0;
    for (let lead = 0; lead + 2 < slots.length; lead += 5) {
      const head = dropAt(effects, slots[lead]!);
      const path = head.clone().sub(origin[lead]!);
      expect(origin[lead + 1]!.distanceTo(origin[lead]!)).toBeLessThan(1e-6);
      expect(origin[lead + 2]!.distanceTo(origin[lead]!)).toBeLessThan(1e-6);
      const first = head.clone().sub(dropAt(effects, slots[lead + 1]!));
      const second = head.clone().sub(dropAt(effects, slots[lead + 2]!));
      expect(first.length()).toBeGreaterThan(0.01);
      expect(second.length()).toBeGreaterThan(first.length() * 1.8);
      expect(first.clone().cross(second).length()).toBeLessThan(1e-5);
      expect(path.length()).toBeGreaterThan(0.1);
      expect(size(slots[lead + 1]!)).toBeLessThan(size(slots[lead]!));
      expect(size(slots[lead + 2]!)).toBeLessThan(size(slots[lead + 1]!));
      strands += 1;
    }
    expect(strands).toBe(28);
    const free = dropAt(effects, slots[3]!).sub(dropAt(effects, slots[0]!));
    const trailing = dropAt(effects, slots[1]!).sub(dropAt(effects, slots[0]!));
    expect(free.clone().cross(trailing).length()).toBeGreaterThan(1e-4);
    effects.dispose();
  });

  it("falls as fast as anything else does", () => {
    const effects = new Effects3D(new THREE.Scene());
    effects.addEvent(hit, new THREE.Vector3(0, 1.5, 0), false);
    const slot = bloodSlots(effects)[0]!;
    const heights: number[] = [];
    for (let frame = 0; frame < 3; frame += 1) {
      effects.update(1 / 60);
      heights.push(dropAt(effects, slot).y);
    }
    const fall = heights[2]! - 2 * heights[1]! + heights[0]!;
    expect(fall * 3600).toBeCloseTo(-9.81, 2);
    effects.dispose();
  });

  it("thins out as the mist hangs, until it is gone", () => {
    const effects = new Effects3D(new THREE.Scene());
    effects.addEvent(hit, new THREE.Vector3(0, 1.5, 0), false);
    const material = effects.mistPoints.material as THREE.PointsMaterial;
    const colour = effects.mistPoints.geometry.getAttribute("color");
    expect(material.vertexColors).toBe(true);
    expect(colour.itemSize).toBe(4);
    const thickest = (): number => {
      let alpha = 0;
      const position = effects.mistPoints.geometry.getAttribute("position");
      for (let index = 0; index < colour.count; index += 1) if (position.getY(index) > -10) alpha = Math.max(alpha, colour.getW(index));
      return alpha;
    };
    expect(effects.liveMist).toBeGreaterThan(0);
    effects.update(1 / 60);
    const early = thickest();
    for (let frame = 0; frame < 20; frame += 1) effects.update(1 / 60);
    const later = thickest();
    expect(early).toBeGreaterThan(0.5);
    expect(later).toBeLessThan(early - 0.15);
    for (let frame = 0; frame < 120; frame += 1) effects.update(1 / 60);
    expect(effects.liveMist).toBe(0);
    effects.dispose();
  });
});

describe("severed head", () => {
  it("stays inside the ropes however hard it is launched", () => {
    const effects = new Effects3D(new THREE.Scene());
    effects.decapitate(0, new THREE.Vector3(2.2, 1.5, -2.2), new THREE.Quaternion(), 1, 9);
    const at = new THREE.Vector3();
    for (let frame = 0; frame < 600; frame += 1) {
      effects.update(1 / 60);
      expect(effects.severedHeadPosition(0, at)).toBe(true);
      expect(Math.abs(at.x)).toBeLessThan(ROPE_LINE - 0.12);
      expect(Math.abs(at.z)).toBeLessThan(ROPE_LINE - 0.12);
    }
    effects.dispose();
  });

  it("reports which way the face points", () => {
    const effects = new Effects3D(new THREE.Scene());
    const facing = new THREE.Vector3();
    expect(effects.severedHeadFacing(0, facing)).toBe(false);
    effects.decapitate(0, new THREE.Vector3(0, 1.5, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), 1, 11);
    expect(effects.severedHeadFacing(0, facing)).toBe(true);
    expect(facing.x).toBeCloseTo(1, 5);
    expect(facing.z).toBeCloseTo(0, 5);
    effects.dispose();
  });
});

describe("flesh over a cut", () => {
  it("fans from the raised middle to every edge and faces the way it is told", () => {
    const geometry = new THREE.BufferGeometry();
    const square = [[1, 0, 1], [-1, 0, 1], [-1, 0, -1], [1, 0, -1]];
    const rim = new Float32Array(square.flatMap((corner, index) => [...corner, ...square[(index + 1) % 4]!]).map((value, index) => value + [5, 2, -3][index % 3]!));
    for (const outward of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)]) {
      closeCut(geometry, rim, new THREE.Vector3(5, 2, -3), outward, 0.25);
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      const uv = geometry.getAttribute("uv");
      expect(position.count).toBe(12);
      for (let corner = 0; corner < 12; corner += 3) {
        expect([position.getX(corner), position.getY(corner), position.getZ(corner)]).toEqual([0, 0.25 * outward.y, 0]);
        expect([uv.getX(corner), uv.getY(corner)]).toEqual([0.5, 0.5]);
        expect(Math.hypot(position.getX(corner + 1), position.getZ(corner + 1))).toBeCloseTo(Math.SQRT2, 6);
        expect(Math.hypot(uv.getX(corner + 1) - 0.5, uv.getY(corner + 1) - 0.5)).toBeCloseTo(0.5, 6);
      }
      for (let index = 0; index < normal.count; index += 1) expect(normal.getY(index) * outward.y).toBeGreaterThan(0.5);
      // Wound the right way round to be seen from outside.
      for (let corner = 0; corner < 12; corner += 3) {
        const [a, b, c] = [0, 1, 2].map((offset) => new THREE.Vector3().fromBufferAttribute(position, corner + offset));
        expect(b!.sub(a!).cross(c!.sub(a!)).dot(outward)).toBeGreaterThan(0);
      }
    }
    geometry.dispose();
  });

  it("reuses its buffers from frame to frame", () => {
    const geometry = new THREE.BufferGeometry();
    const rim = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 1, -1, 0, 0, -1, 0, 0, 1, 0, 0]);
    closeCut(geometry, rim, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    const first = geometry.getAttribute("position");
    closeCut(geometry, rim.map((value) => value * 2), new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
    expect(geometry.getAttribute("position")).toBe(first);
    expect(Math.hypot(first.getX(1), first.getY(1), first.getZ(1))).toBe(2);
    geometry.dispose();
  });
});

describe("referee and a head on the canvas", () => {
  it("walks round it rather than standing over it", () => {
    const effects = new Effects3D(new THREE.Scene());
    effects.decapitate(1, new THREE.Vector3(0.2, 0.2, -1.4), new THREE.Quaternion(), 1, 8);
    for (let frame = 0; frame < 240; frame += 1) effects.update(1 / 60);
    const head = new THREE.Vector3();
    effects.severedHeadPosition(1, head);
    const updated: unknown[] = [];
    const stub = {
      referee: { setRefereeCount: () => {}, aimBreak: () => {}, update: (...frame: unknown[]) => updated.push(frame), boxer: { root: new THREE.Object3D() } }, blobShadows: [],
      mapping: worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 }),
      tmpA: new THREE.Vector3(head.x - 0.4, 0, head.z + 2.2), tmpB: new THREE.Vector3(head.x + 0.4, 0, head.z + 2.2),
      refereePosition: new THREE.Vector3(head.x + 0.1, 0, head.z - 0.2), refereeVelocity: new THREE.Vector3(), refereeAway: new THREE.Vector3(), refereeYaw: 0,
      effects, closeUpTarget: new THREE.Vector3(), replay: null, ceremony: null,
    };
    const step = (FightRenderer.prototype as unknown as { updateReferee: (dt: number, time: number, snapshot: unknown, tick: number) => void }).updateReferee;
    for (let frame = 0; frame < 180; frame += 1) {
      step.call(stub, 1 / 60, frame / 60, null, frame / 2);
      expect(Math.hypot(stub.refereePosition.x - head.x, stub.refereePosition.z - head.z)).toBeGreaterThanOrEqual(0.9 - 1e-6);
    }
    expect(updated).toHaveLength(180);
    effects.dispose();
  });

  it("is left out of the knockout replay's close shot, and back for the live picture", () => {
    const root = new THREE.Object3D();
    const shadow = new THREE.Object3D();
    const stub = {
      referee: { setRefereeCount: () => {}, aimBreak: () => {}, update: () => {}, boxer: { root } }, blobShadows: [new THREE.Object3D(), new THREE.Object3D(), shadow],
      mapping: worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 }),
      tmpA: new THREE.Vector3(-0.5, 0, 0), tmpB: new THREE.Vector3(0.5, 0, 0),
      refereePosition: new THREE.Vector3(0, 0, -1.5), refereeVelocity: new THREE.Vector3(), refereeAway: new THREE.Vector3(), refereeYaw: 0,
      effects: { severedHeadPosition: () => false }, closeUpTarget: new THREE.Vector3(), replay: {} as unknown, ceremony: null,
    };
    const step = (FightRenderer.prototype as unknown as { updateReferee: (dt: number, time: number, snapshot: unknown, tick: number) => void }).updateReferee;
    step.call(stub, 1 / 60, 0, null, 0);
    expect(root.visible).toBe(false);
    expect(shadow.visible).toBe(false);
    stub.replay = null;
    step.call(stub, 1 / 60, 1 / 60, null, 0.5);
    expect(root.visible).toBe(true);
    expect(shadow.visible).toBe(true);
  });

  it("steps back from it and is left alone when already clear", () => {
    expect(keepClear(0.3, 0, 0, 0, 0.9)).toEqual({ x: 0.9, z: 0 });
    const stepped = keepClear(0.3, -0.4, 0, 0, 0.9);
    expect(Math.hypot(stepped.x, stepped.z)).toBeCloseTo(0.9, 9);
    expect(stepped.x / stepped.z).toBeCloseTo(0.3 / -0.4, 9);
    expect(keepClear(1.2, 0.4, 0, 0, 0.9)).toEqual({ x: 1.2, z: 0.4 });
    expect(keepClear(2, 1, 2, 1, 0.9).x).toBe(2);
    expect(keepClear(2, 1, 2, 1, 0.9).z).toBeCloseTo(0.1, 9);
  });
});

describe("the winner beside the beaten fighter", () => {
  const renderer = FightRenderer.prototype as unknown as {
    standApart(this: unknown, fighters: readonly [FighterSnapshot, FighterSnapshot], dt: number): readonly [FighterSnapshot, FighterSnapshot];
  };
  const lying = [new THREE.Vector3(0.3, 0.1, 0.2), new THREE.Vector3(0.1, 0.2, 0.25), new THREE.Vector3(-0.2, 0.15, 0.3), new THREE.Vector3(-0.5, 0.1, 0.2), new THREE.Vector3(-0.5, 0.1, 0.4)];
  const rig = (replay: unknown) => Object.assign(Object.create(FightRenderer.prototype) as object, {
    graphs: [{ fallBody: null }, { fallBody: { bodyPoint: (index: number, out: THREE.Vector3) => out.copy(lying[index]!) } }],
    mapping: worldMapping({ tick_rate: 30, ring_half_width: 500, ring_half_height: 500 }), replay, bodyPoint: new THREE.Vector3(),
    drawnFighters: [{ ...fighter("one") }, { ...fighter("two") }], drawnOffsets: [{ x: 0, y: 0 }, { x: 0, y: 0 }], drawnTargets: [{ x: 0, y: 0 }, { x: 0, y: 0 }],
  });

  it("stands clear of the body where the fall left it, never inside it", () => {
    const stub = rig(null);
    const winner = { ...fighter("one"), x: 0, y: -40 };
    const loser = { ...fighter("two"), x: 0, y: -40, is_downed: true };
    const [drawn, beaten] = renderer.standApart.call(stub, [winner, loser], 1 / 60);
    const at = new THREE.Vector3(stub.mapping.x(drawn.x), 0, stub.mapping.z(drawn.y));
    for (const point of lying) expect(Math.hypot(at.x - point.x, at.z - point.z)).toBeGreaterThanOrEqual(0.5 - 1e-6);
    expect(beaten).toBe(loser);
    const far = { ...fighter("one"), x: 300, y: 200 };
    expect(renderer.standApart.call(rig(null), [far, loser], 1 / 60)[0]).toBe(far);
  });

  it("stands off the body in the replay as he did live", () => {
    // The live fall's obstacle was the pushed winner, so the replayed fall lies where he would stand in it unpushed.
    const winner = { ...fighter("one"), x: 0, y: -40 };
    const loser = { ...fighter("two"), x: 0, y: -40, is_downed: true };
    const live = { ...renderer.standApart.call(rig(null), [winner, loser], 1 / 60)[0] };
    const replayed = renderer.standApart.call(rig({}), [winner, loser], 1 / 60)[0];
    expect(replayed).not.toBe(winner);
    expect({ x: replayed.x, y: replayed.y }).toEqual({ x: live.x, y: live.y });
  });
});

describe("severed head close-up camera", () => {
  const shoot = (eventId: number, start = new THREE.Vector3(0.4, 1.55, 0.1), referee = new THREE.Vector3(-0.6, 0, -1.9)): { chosen: (number | null)[]; steps: number[]; first: number } => {
    const effects = new Effects3D(new THREE.Scene());
    effects.decapitate(1, start, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), 1, eventId);
    const stub = {
      finishCloseUpUntil: 101.7, finishCloseUpIndex: 1, finishCloseUpBearing: null as number | null, headCacheValid: [true, true],
      headCache: [new THREE.Vector3(), new THREE.Vector3(0.4, 0.3, 0.1)], arcadeInjuries: [null, "decapitation"], effects,
      closeUpTarget: new THREE.Vector3(), closeUpFacing: new THREE.Vector3(), closeUpPosition: new THREE.Vector3(), replayLookAt: new THREE.Vector3(),
      tmpA: new THREE.Vector3(-1.6, 0, -1.2), tmpB: new THREE.Vector3(0.4, 0, 0.1), refereePosition: referee,
    };
    const chosen: (number | null)[] = [];
    const steps: number[] = [];
    const previous = new THREE.Vector3();
    let first = 0;
    for (let frame = 0; frame < 100; frame += 1) {
      effects.update(1 / 60);
      const shot = renderer.closeUpFrame.call(stub, 100 + frame / 60)!;
      chosen.push(stub.finishCloseUpBearing);
      if (frame === 0) first = Math.atan2(shot.position.x - shot.lookAt.x, shot.position.z - shot.lookAt.z);
      else steps.push(shot.position.distanceTo(previous));
      previous.copy(shot.position);
    }
    effects.dispose();
    return { chosen, steps, first };
  };

  it("starts on the side the face points to", () => {
    const shot = shoot(8);
    expect(shot.chosen[0]).toBeCloseTo(Math.PI / 2, 1);
    expect(shot.first).toBeCloseTo(Math.PI / 2 - 0.2, 1);
  });

  it("takes another side when the referee stands where the face points", () => {
    const open = shoot(8);
    const taken = shoot(8, new THREE.Vector3(0.4, 1.55, 0.1), new THREE.Vector3(0.4 + 0.75, 0, 0.1));
    expect(Math.abs(taken.chosen[0]! - open.chosen[0]!)).toBeGreaterThan(0.5);
  });

  it("keeps to that side while the head tumbles, and never jumps", () => {
    for (let eventId = 2; eventId <= 60; eventId += 2) {
      for (const start of [new THREE.Vector3(0.4, 1.55, 0.1), new THREE.Vector3(2.1, 1.55, -2.1)]) {
        const shot = shoot(eventId, start);
        expect(new Set(shot.chosen).size).toBe(1);
        expect(Math.max(...shot.steps)).toBeLessThan(0.12);
      }
    }
  });
});

describe("severed head close-up", () => {
  const fallback = 2.5;

  it("shoots from the side the face points to", () => {
    expect(closeUpAngle(0.5, 0.2, { x: 1, y: 0, z: 0 }, 0.8, 2.2, fallback)).toBeCloseTo(Math.PI / 2, 6);
    expect(closeUpAngle(0.5, 0.2, { x: 0, y: 0.2, z: -1 }, 0.8, 2.2, fallback)).toBeCloseTo(Math.PI, 6);
  });

  it("falls back when the face points up or down, or into the ropes", () => {
    expect(closeUpAngle(0.5, 0.2, { x: 0.1, y: 0.99, z: 0.1 }, 0.8, 2.2, fallback)).toBe(fallback);
    expect(closeUpAngle(2.1, 0, { x: 1, y: 0, z: 0 }, 0.8, 2.2, fallback)).toBe(fallback);
    expect(closeUpAngle(0.5, 0.2, null, 0.8, 2.2, fallback)).toBe(fallback);
  });

  it("passes over a side where someone is standing or stands in the way", () => {
    const inTheShot = [{ x: 0.5 + 0.8, z: 0.2, radius: 0.5 }];
    expect(closeUpAngle(0.5, 0.2, { x: 1, y: 0, z: 0 }, 0.8, 2.2, fallback, inTheShot)).toBe(fallback);
    const onTheWay = [{ x: 0.5 + 0.5, z: 0.45, radius: 0.5 }];
    expect(closeUpAngle(0.5, 0.2, { x: 1, y: 0, z: 0 }, 0.8, 2.2, fallback, onTheWay)).toBe(fallback);
    const both = [...inTheShot, { x: 0.5 + Math.sin(fallback) * 0.8, z: 0.2 + Math.cos(fallback) * 0.8, radius: 0.5 }];
    const chosen = closeUpAngle(0.5, 0.2, { x: 1, y: 0, z: 0 }, 0.8, 2.2, fallback, both);
    expect(chosen).toBeCloseTo(fallback + 1.05, 9);
    for (const blocker of both) expect(Math.hypot(0.5 + Math.sin(chosen) * 0.8 - blocker.x, 0.2 + Math.cos(chosen) * 0.8 - blocker.z)).toBeGreaterThan(0.5);
  });

  it("looks past someone standing over the head from the far side of them", () => {
    const over = [{ x: 0.5, z: 0.2 - 0.3, radius: 0.5 }];
    const chosen = closeUpAngle(0.5, 0.2, { x: 0, y: 0, z: -1 }, 0.8, 2.2, 0, over);
    expect(Math.cos(chosen)).toBeGreaterThan(0.4);
  });

  it("keeps the fallback when every side is taken", () => {
    const ringed = Array.from({ length: 12 }, (_, index) => ({ x: 0.5 + Math.sin(index * 0.5236) * 0.8, z: 0.2 + Math.cos(index * 0.5236) * 0.8, radius: 0.5 }));
    expect(closeUpAngle(0.5, 0.2, { x: 1, y: 0, z: 0 }, 0.8, 2.2, fallback, ringed)).toBe(fallback);
  });
});

describe("gore from a real punch", () => {
  // Engine damage: a landed jab is about 30, a straight 50 to 80, a power counter up to about 150.
  it("knocks teeth out with the punch that floors a man and with big counters, never with an ordinary shot", () => {
    expect(teethFor("knockdown", 1, true)).toBe(2);
    expect(teethFor("counter_hit", BIG_SHOT, true)).toBe(1);
    expect(teethFor("counter_hit", 130, true)).toBe(2);
    expect(teethFor("counter_hit", BIG_SHOT - 1, true)).toBe(0);
    expect(teethFor("hit", 80, true)).toBe(0);
    expect(teethFor("hit", 118, true)).toBe(1);
    expect(teethFor("counter_hit", 140, false)).toBe(0);
    expect(teethFor("knockdown", 1, false)).toBe(0);
    expect(teethFor("block", 140, true)).toBe(0);
  });

  it("throws more blood from an open wound and from a harder punch, up to a limit", () => {
    expect(bloodDropsFor(8, 30)).toBeLessThan(15);
    expect(bloodDropsFor(25, 110)).toBeGreaterThan(bloodDropsFor(25, 50) + 25);
    expect(bloodDropsFor(60, 60)).toBeGreaterThan(bloodDropsFor(20, 60) + 50);
    expect(bloodDropsFor(100, 500)).toBe(140);
    expect(bloodDropsFor(0, 0)).toBe(0);
  });

  it("puts a mist in the air from a hard shot, which an ordinary one does not", () => {
    const origin = new THREE.Vector3();
    const mist = (kind: string, amount: number): number => {
      const effects = new Effects3D(new THREE.Scene());
      effects.addEvent({ event_id: 3, tick: 1, kind, actor_id: "one", target_id: "two", amount, detail: "straight:head", blood: 20, direction: 1, action_id: null }, origin, false);
      const live = effects.liveMist;
      effects.dispose();
      return live;
    };
    expect(mist("hit", HARD_SHOT)).toBeGreaterThan(0);
    expect(mist("hit", HARD_SHOT - 1)).toBe(0);
    expect(mist("counter_hit", 40)).toBeGreaterThan(0);
  });

  // The engine's blood is the cut's bleeding over eight plus the damage over four.
  const punchOn = (kind: string, amount: number, bleeding: number, detail = "straight:head"): CombatEvent => ({
    event_id: 7, tick: 1, kind, actor_id: "one", target_id: "two", amount, detail, blood: Math.floor(bleeding / 8) + Math.floor(amount / 4), direction: 1, action_id: null,
  });
  const origin = new THREE.Vector3();
  const after = <T,>(event: CombatEvent, read: (effects: Effects3D) => T): T => {
    const effects = new Effects3D(new THREE.Scene(), 256);
    effects.addEvent(event, origin, false);
    const value = read(effects);
    effects.dispose();
    return value;
  };
  /** Stains on the canvas once everything the event threw has come down. */
  const landed = (effects: Effects3D): number => {
    for (let frame = 0; frame < 150; frame += 1) effects.update(1 / 60);
    return effects.canvasStains;
  };

  it("splashes the canvas from an open cut and a knockdown, not from every punch that draws a little blood", () => {
    const splash = (event: CombatEvent): number => after(event, (effects) => effects.canvasStains);
    expect(splash(punchOn("hit", 34, 0, "jab:head"))).toBe(0);
    expect(splash(punchOn("hit", 110, 0))).toBe(0);
    expect(splash(punchOn("hit", 64, 130, "hook:head"))).toBe(4);
    expect(splash(punchOn("counter_hit", 64, 320, "hook:head"))).toBe(8);
    expect(splash({ ...punchOn("knockdown", 1, 0), blood: 18 })).toBe(12);
  });

  it("throws less blood from a punch the guard took than from a clean jab, however hard it hit the guard", () => {
    // A block carries the guard's damage as its amount and the blood that leaked through it.
    const jab = punchOn("hit", 34, 0, "jab:head");
    const jabDrops = after(jab, (effects) => effects.liveBloodParticles);
    const jabStains = after(jab, landed);
    for (const guard of [57, 76, 120]) {
      const blocked = { ...punchOn("block", guard, 0, "hook:head"), blood: 7 };
      expect(after(blocked, (effects) => effects.liveBloodParticles)).toBeLessThan(jabDrops);
      expect(after(blocked, (effects) => effects.canvasStains)).toBe(0);
      expect(after(blocked, landed)).toBeLessThanOrEqual(jabStains);
    }
  });

  it("adds a few drops to a cut's drip at each beat of the bleeding, with no splash, sweat or shake", () => {
    const beat: CombatEvent = { event_id: 9, tick: 30, kind: "bleed", actor_id: "two", target_id: null, amount: 30, detail: "", blood: 25, direction: 0, action_id: null };
    const effects = new Effects3D(new THREE.Scene(), 256);
    effects.addEvent(beat, origin, false);
    expect(effects.liveParticles).toBe(effects.liveBloodParticles);
    expect(effects.liveBloodParticles).toBeGreaterThan(0);
    expect(effects.liveBloodParticles).toBeLessThanOrEqual(5);
    expect(effects.canvasStains).toBe(0);
    expect(effects.shakeAmount).toBe(0);
    expect(landed(effects)).toBeLessThanOrEqual(5);
    effects.dispose();
  });

  it("tears flesh from an open cut with a punch that rocks him, and from any face with a big counter", () => {
    const torn = (event: CombatEvent): number => after(event, (effects) => effects.liveGibs);
    expect(torn(punchOn("hit", HARD_SHOT, 130))).toBeGreaterThan(0);
    expect(torn(punchOn("counter_hit", ROCKING_COUNTER, 130))).toBeGreaterThan(0);
    expect(torn(punchOn("hit", HARD_SHOT - 1, 130))).toBe(0);
    expect(torn(punchOn("counter_hit", ROCKING_COUNTER - 1, 130))).toBe(0);
    // A cut that has barely opened, and an unmarked face, keep their flesh but for a big counter.
    expect(torn(punchOn("hit", 110, 40))).toBe(0);
    expect(torn(punchOn("counter_hit", BIG_SHOT, 0))).toBeGreaterThan(0);
    expect(torn(punchOn("hit", 120, 300, "hook:body"))).toBe(0);
    expect(torn(punchOn("counter_hit", 140, 300))).toBeGreaterThan(torn(punchOn("counter_hit", 60, 300)));
  });

  it("keeps a knockdown, teeth and gum shield included, to one reduced spray of blood with reduced blood", () => {
    const thrown = (level: "full" | "reduced"): number => {
      const effects = new Effects3D(new THREE.Scene(), 256);
      effects.setBloodLevel(level);
      const mouth = new THREE.Vector3(0, 1.5, 0);
      effects.addEvent({ ...punchOn("knockdown", 1, 0), blood: 30 }, origin, false);
      effects.spawnTeeth(mouth, 1, 2, 7);
      effects.ejectMouthpiece(1, mouth, new THREE.Quaternion(), 1, 7, 0x1d4ed8);
      // Nothing thrown has come down yet a third of a second on, while the gum shield trails its thread.
      let most = effects.liveBloodParticles;
      for (let frame = 0; frame < 18; frame += 1) {
        effects.update(1 / 60);
        most = Math.max(most, effects.liveBloodParticles);
      }
      effects.dispose();
      return most;
    };
    // Reduced caps a single spray at 24 drops.
    expect(thrown("reduced")).toBeLessThanOrEqual(24);
    expect(thrown("full")).toBeGreaterThan(60);
  });

  it("throws a thicker mist off a punch the worse the cut it lands on", () => {
    const mist = (event: CombatEvent): number => after(event, (effects) => effects.liveMist);
    expect(mist(punchOn("hit", 75, 0))).toBe(10);
    expect(mist(punchOn("hit", 75, 300))).toBeGreaterThan(mist(punchOn("hit", 75, 80)));
    expect(mist(punchOn("hit", 75, 600))).toBe(18);
    // A face cut badly enough mists at every punch, a jab included.
    expect(mist(punchOn("hit", 34, 0, "jab:head"))).toBe(0);
    expect(mist(punchOn("hit", 34, 160, "jab:head"))).toBeGreaterThan(0);
  });
});
