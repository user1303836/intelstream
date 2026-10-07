import * as THREE from "three";
import { fighter } from "../test/fixtures";
import { Effects3D } from "./effects";
import { BoxingGraph, SkinnedBoxer, loadBoxerGlb } from "./graph";
import { HEAD_SITES, InjuryShading } from "./injury";
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

/**
 * The jaw dislocation mask exactly as the head's vertex shader computes it: the expression is taken from
 * the shader source and evaluated for a bind-space point (centimetres).
 */
function shaderJawMask(): (y: number, z: number) => number {
  const material = new THREE.MeshStandardMaterial();
  const shading = new InjuryShading(material, HEAD_SITES);
  const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>" };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
  const expression = /float jawMask = ([^;]+);/.exec(shader.vertexShader)![1]!;
  const smoothstep = (edge0: number, edge1: number, x: number): number => {
    const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const mask = new Function("smoothstep", "transformed", "uInjuryJawLevel", `return ${expression};`) as (step: typeof smoothstep, transformed: { y: number; z: number }, level: number) => number;
  material.dispose();
  return (y, z) => mask(smoothstep, { y, z }, shading.uniforms.uInjuryJawLevel.value);
}

describe("dislocated jaw", () => {
  it("moves the mandible but not the throat where the head meets the body", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    const meshes: THREE.SkinnedMesh[] = [];
    boxer.root.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) meshes.push(object);
    });
    const key = (positions: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, vertex: number): string =>
      [positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)].map((value) => Math.round(value * 1000)).join(",");
    // Head vertices that coincide with body vertices are the seam between the two meshes.
    const body = meshes.find((mesh) => mesh.name === "BoxerBody")!.geometry.getAttribute("position");
    const onBody = new Set(Array.from({ length: body.count }, (_unused, vertex) => key(body, vertex)));
    const head = boxer.headMesh.geometry.getAttribute("position");
    const mask = shaderJawMask();
    const seam: number[] = [];
    const chin: number[] = [];
    const chinSite = new THREE.Vector3(...HEAD_SITES.find((site) => site.name === "chin")!.position);
    const point = new THREE.Vector3();
    for (let vertex = 0; vertex < head.count; vertex += 1) {
      point.fromBufferAttribute(head, vertex);
      if (onBody.has(key(head, vertex))) seam.push(mask(point.y, point.z));
      else if (point.distanceTo(chinSite) < 2.2) chin.push(mask(point.y, point.z));
    }
    expect(seam.length).toBeGreaterThan(20);
    expect(chin.length).toBeGreaterThan(20);
    // At full dislocation the jaw shifts 1.96 cm; the seam may move a twentieth of that at most.
    expect(Math.max(...seam)).toBeLessThan(0.05);
    expect(Math.min(...chin)).toBeGreaterThan(0.85);
  });
});

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
