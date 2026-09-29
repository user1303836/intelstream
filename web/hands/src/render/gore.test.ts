import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildChunkGeometry, buildWoundGeometry } from "./gore";
import { SkinnedBoxer, loadBoxerGlb } from "./graph";
import { HEAD_SITES, InjuryShading, NECK_CUT_HEIGHT } from "./injury";
import { SCANNED_LOOK } from "./looks";
import { Effects3D } from "./effects";
import { aboveNeckCut, bakeSkinnedPart, closeUpAngle } from "./renderer";
import { ROPE_LINE } from "./world";

const gltf = await loadBoxerGlb();

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
    expect(depth.fragmentShader).toContain("injuryCutLine");
    expect(depth.fragmentShader).toContain("discard");
    expect(skin.fragmentShader).toContain("discard");
    expect(shading.severed).toBe(false);
    shading.setSevered(true);
    expect(skin.uniforms.uInjurySever!.value).toBe(NECK_CUT_HEIGHT);
    expect(shading.severed).toBe(true);
    shading.setSevered(false);
    expect(shading.severed).toBe(false);
  });

  it("keeps the head mesh drawn for the collar while the head is off", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8 });
    boxer.setDecapitated(true);
    expect(boxer.isDecapitated).toBe(true);
    expect(boxer.headMesh.visible).toBe(true);
    expect(boxer.headInjury.severed).toBe(true);
    expect(boxer.headMesh.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
    boxer.setDecapitated(false);
    expect(boxer.headInjury.severed).toBe(false);
    boxer.dispose();
  });

  it("bakes only the part of the head mesh above the cut", () => {
    const boxer = new SkinnedBoxer(gltf, { skin: 0xb0703f, gear: 0x1d4ed8, look: { ...SCANNED_LOOK, tint: 0xa38a7c } });
    boxer.root.updateMatrixWorld(true);
    const pivot = boxer.bone("head")!;
    const whole = bakeSkinnedPart(boxer.headMesh, pivot.getWorldPosition(new THREE.Vector3()), pivot.getWorldQuaternion(new THREE.Quaternion()));
    const head = bakeSkinnedPart(boxer.headMesh, pivot.getWorldPosition(new THREE.Vector3()), pivot.getWorldQuaternion(new THREE.Quaternion()), aboveNeckCut);
    expect(head.color).toBe(0xa38a7c);
    const kept = head.geometry.getIndex()!;
    expect(kept.count).toBeGreaterThan(0);
    expect(kept.count).toBeLessThan(whole.geometry.getIndex()!.count);
    const bind = boxer.headMesh.geometry.getAttribute("position");
    const vertex = new THREE.Vector3();
    for (let at = 0; at < kept.count; at += 1) expect(aboveNeckCut(vertex.fromBufferAttribute(bind, kept.getX(at)))).toBe(true);
    const baked = head.geometry.getAttribute("position");
    let lowest = Infinity;
    for (let at = 0; at < kept.count; at += 1) lowest = Math.min(lowest, baked.getY(kept.getX(at)));
    expect(lowest).toBeGreaterThan(-0.09);
    whole.geometry.dispose();
    head.geometry.dispose();
    boxer.dispose();
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
});
