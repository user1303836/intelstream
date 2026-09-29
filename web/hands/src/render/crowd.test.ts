import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CROWD_TIERS, PARAPET_HEIGHT, PARAPET_SETBACK, buildArmGeometry, buildCrowd, buildStandsGeometry, buildTorsoGeometry, seatSpectators, spectatorPose } from "./crowd";

const seeded = (seed: number): (() => number) => () => {
  seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
};

const total = CROWD_TIERS.reduce((sum, tier) => sum + tier.count, 0);

describe("crowd seating", () => {
  it("fills every tier, the same way every time", () => {
    const first = seatSpectators(CROWD_TIERS, seeded(7));
    const second = seatSpectators(CROWD_TIERS, seeded(7));
    expect(first).toHaveLength(total);
    expect(second).toEqual(first);
  });

  it("seats everyone in a row facing the ring", () => {
    const seated = seatSpectators(CROWD_TIERS, seeded(7));
    let index = 0;
    for (const tier of CROWD_TIERS) {
      for (let seat = 0; seat < tier.count; seat += 1) {
        const spectator = seated[index]!;
        index += 1;
        expect(Math.abs(Math.hypot(spectator.x, spectator.z) - tier.radius)).toBeLessThanOrEqual(0.25 + 1e-9);
        expect(Math.abs(spectator.y - tier.y)).toBeLessThanOrEqual(0.03 + 1e-9);
        const toRing = Math.atan2(-spectator.x, -spectator.z);
        const off = Math.atan2(Math.sin(spectator.yaw - toRing), Math.cos(spectator.yaw - toRing));
        expect(Math.abs(off)).toBeLessThanOrEqual(0.25 + 1e-9);
      }
    }
  });
});

describe("crowd reaction", () => {
  const seated = seatSpectators(CROWD_TIERS, seeded(11));
  const standing = (excitement: number): number => seated.filter((spectator) => spectatorPose(spectator, 3.7, excitement).rise > 0.2).length;

  it("sits with its arms down while the bout is quiet", () => {
    for (const spectator of seated) {
      const pose = spectatorPose(spectator, 3.7, 0);
      expect(pose.rise).toBeLessThan(0.03);
      expect(pose.armLeft).toBeCloseTo(-0.35, 6);
      expect(pose.armRight).toBeCloseTo(-0.35, 6);
    }
  });

  it("gets to its feet with its arms up at the finish", () => {
    for (const spectator of seated) {
      const pose = spectatorPose(spectator, 3.7, 1);
      expect(pose.rise).toBeGreaterThan(0.3);
      expect(pose.armLeft).toBeLessThan(-2.2);
      expect(pose.armRight).toBeLessThan(-2.2);
    }
  });

  it("rises a few at a time as the excitement builds", () => {
    expect(standing(0)).toBe(0);
    const some = standing(0.45);
    const more = standing(0.7);
    expect(some).toBeGreaterThan(total * 0.15);
    expect(some).toBeLessThan(total * 0.6);
    expect(more).toBeGreaterThan(some);
    expect(standing(1)).toBe(total);
  });
});

describe("crowd geometry", () => {
  it("puts a parapet in front of every row, below shoulder height", () => {
    const geometry = buildStandsGeometry(CROWD_TIERS);
    const position = geometry.getAttribute("position");
    for (const tier of CROWD_TIERS) {
      let top = -Infinity;
      for (let index = 0; index < position.count; index += 1) {
        const reach = Math.hypot(position.getX(index), position.getZ(index));
        if (Math.abs(reach - (tier.radius - PARAPET_SETBACK)) < 0.01) top = Math.max(top, position.getY(index));
      }
      expect(top).toBeCloseTo(tier.y + PARAPET_HEIGHT, 5);
      expect(PARAPET_HEIGHT).toBeLessThan(0.9);
    }
    geometry.dispose();
  });

  it("hangs the arm from the shoulder and sits the torso on the seat", () => {
    const arm = buildArmGeometry();
    arm.computeBoundingBox();
    expect(arm.boundingBox!.max.y).toBeLessThan(0.06);
    expect(arm.boundingBox!.min.y).toBeLessThan(-0.5);
    const torso = buildTorsoGeometry();
    torso.computeBoundingBox();
    expect(torso.boundingBox!.min.y).toBeGreaterThan(0.2);
    expect(torso.boundingBox!.max.y).toBeLessThan(1.05);
    arm.dispose();
    torso.dispose();
  });

  it("draws every spectator and moves their arms when they cheer", () => {
    const crowd = buildCrowd(seeded(3));
    const drawn = crowd.group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
    expect(drawn).toHaveLength(5);
    for (const mesh of drawn) expect(mesh.count).toBe(total);
    expect(crowd.group.getObjectByName("stands")).toBeInstanceOf(THREE.Mesh);
    const arm = drawn[3]!;
    const after = new THREE.Matrix4();
    const seated = [new THREE.Matrix4(), new THREE.Matrix4()];
    for (const [index, matrix] of seated.entries()) arm.getMatrixAt(index, matrix);
    const moved = (): boolean[] => seated.map((matrix, index) => {
      arm.getMatrixAt(index, after);
      return !after.equals(matrix);
    });
    crowd.update(2, 1);
    expect(moved().filter(Boolean)).toHaveLength(1);
    crowd.update(2, 1);
    expect(moved()).toEqual([true, true]);
    crowd.dispose();
  });
});
