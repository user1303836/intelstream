import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildArena } from "./arena";
import { CAMERA_PLATFORM_HALF_ANGLE, CAMERA_PLATFORM_REACH, CROWD_TIERS, PARAPET_HEIGHT, PARAPET_SETBACK, buildArmGeometry, buildCrowd, buildHairGeometry, buildHeadGeometry, buildStandsGeometry, buildTorsoGeometry, seatSpectators, spectatorPose } from "./crowd";

const seeded = (seed: number): (() => number) => () => {
  seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
  return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
};

const seats = CROWD_TIERS.reduce((sum, tier) => sum + tier.count, 0);
const total = seatSpectators(CROWD_TIERS, seeded(7)).length;

describe("crowd seating", () => {
  it("fills the stands the same way every time", () => {
    const first = seatSpectators(CROWD_TIERS, seeded(7));
    const second = seatSpectators(CROWD_TIERS, seeded(7));
    expect(first.length).toBeGreaterThan(seats * 0.9);
    expect(first.length).toBeLessThan(seats);
    expect(second).toEqual(first);
  });

  it("seats everyone in a row facing the ring", () => {
    for (const spectator of seatSpectators(CROWD_TIERS, seeded(7))) {
      const reach = Math.hypot(spectator.x, spectator.z);
      const tier = CROWD_TIERS.find((candidate) => Math.abs(candidate.radius - reach) <= 0.25 + 1e-9)!;
      expect(tier).toBeDefined();
      expect(Math.abs(spectator.y - tier.y)).toBeLessThanOrEqual(0.03 + 1e-9);
      const toRing = Math.atan2(-spectator.x, -spectator.z);
      const off = Math.atan2(Math.sin(spectator.yaw - toRing), Math.cos(spectator.yaw - toRing));
      expect(Math.abs(off)).toBeLessThanOrEqual(0.25 + 1e-9);
    }
  });

  it("keeps the rows in front of the broadcast camera clear and fills the back row behind it", () => {
    const seated = seatSpectators(CROWD_TIERS, seeded(7));
    const inFront = seated.filter((spectator) => spectator.z > 0 && Math.abs(Math.atan2(spectator.x, spectator.z)) < CAMERA_PLATFORM_HALF_ANGLE);
    expect(inFront.length).toBeGreaterThan(0);
    for (const spectator of inFront) expect(Math.hypot(spectator.x, spectator.z)).toBeGreaterThan(CAMERA_PLATFORM_REACH);
    const opposite = seated.filter((spectator) => spectator.z < 0 && Math.abs(Math.atan2(spectator.x, -spectator.z)) < CAMERA_PLATFORM_HALF_ANGLE);
    expect(opposite.some((spectator) => Math.hypot(spectator.x, spectator.z) < 9)).toBe(true);
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
    }
    geometry.dispose();
  });

  it("hides the lap behind the parapet and shows the chest and head above it", () => {
    const torso = buildTorsoGeometry();
    torso.computeBoundingBox();
    const position = torso.getAttribute("position");
    let lap = -Infinity;
    for (let index = 0; index < position.count; index += 1) if (position.getZ(index) > 0.25) lap = Math.max(lap, position.getY(index));
    for (const tier of CROWD_TIERS) {
      expect(lap * tier.scale * 0.92).toBeLessThan(PARAPET_HEIGHT + 0.12);
      expect(torso.boundingBox!.max.y * tier.scale * 0.92).toBeGreaterThan(PARAPET_HEIGHT + 0.35);
    }
    torso.dispose();
  });

  it("draws a spectator in a few hundred triangles", () => {
    const parts = [buildTorsoGeometry(), buildHeadGeometry(), buildHairGeometry(), buildArmGeometry(), buildArmGeometry()];
    let triangles = 0;
    let vertices = 0;
    for (const part of parts) {
      expect(part.getIndex()).not.toBeNull();
      triangles += part.getIndex()!.count / 3;
      vertices += part.getAttribute("position").count;
      part.dispose();
    }
    expect(triangles).toBeLessThan(500);
    expect(vertices).toBeLessThan(450);
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
    // The first and the last spectator are in different halves of the crowd.
    const watched = [0, total - 1];
    const seated = [new THREE.Matrix4(), new THREE.Matrix4()];
    for (const [at, matrix] of seated.entries()) arm.getMatrixAt(watched[at]!, matrix);
    const moved = (): boolean[] => seated.map((matrix, at) => {
      arm.getMatrixAt(watched[at]!, after);
      return !after.equals(matrix);
    });
    crowd.update(2, 1);
    expect(moved().filter(Boolean)).toHaveLength(1);
    crowd.update(2, 1);
    expect(moved()).toEqual([true, true]);
    crowd.dispose();
  });
});

describe("crowd cost", () => {
  const parts = (crowd: ReturnType<typeof buildCrowd>): THREE.InstancedMesh[] => crowd.group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);

  it("uploads only the half of the crowd that moved", () => {
    const crowd = buildCrowd(seeded(3));
    const [torsos, , , armsLeft] = parts(crowd);
    const half = Math.ceil(total / 2);
    const ranges = [0, 1].map((frame) => {
      crowd.update(1 + frame / 50, 0.5);
      expect(armsLeft!.instanceMatrix.updateRanges).toEqual(torsos!.instanceMatrix.updateRanges);
      return torsos!.instanceMatrix.updateRanges.map(({ start, count }) => ({ start, count }));
    });
    expect(ranges.flat().sort((a, b) => a.start - b.start)).toEqual([{ start: 0, count: half * 16 }, { start: half * 16, count: (total - half) * 16 }]);
    crowd.update(1.04, 0.5, true);
    expect(torsos!.instanceMatrix.updateRanges).toEqual([]);
    crowd.dispose();
  });

  it("at the low tier moves a quarter at a time and puts its arms out of sight", () => {
    const crowd = buildCrowd(seeded(3));
    const [torsos, , , armsLeft, armsRight] = parts(crowd);
    crowd.setLowTier(true);
    expect(armsLeft!.visible).toBe(false);
    expect(armsRight!.visible).toBe(false);
    const armsVersion = armsLeft!.instanceMatrix.version;
    crowd.update(1, 0.5);
    const [range] = torsos!.instanceMatrix.updateRanges;
    expect(torsos!.instanceMatrix.updateRanges).toHaveLength(1);
    expect(range!.count).toBeLessThanOrEqual(Math.ceil(total / 4) * 16);
    expect(range!.start % (Math.ceil(total / 4) * 16)).toBe(0);
    expect(armsLeft!.instanceMatrix.version).toBe(armsVersion);
    crowd.setLowTier(false);
    expect(armsLeft!.visible).toBe(true);
    crowd.update(1.02, 0.5);
    expect(armsLeft!.instanceMatrix.version).toBeGreaterThan(armsVersion);
    expect(armsLeft!.instanceMatrix.updateRanges).toEqual([]);
    crowd.dispose();
  });
});

describe("crowd and reduced motion", () => {
  const armsUp = (arena: ReturnType<typeof buildArena>): number => {
    const crowd = arena.group.getObjectByName("crowd")!;
    const arms = crowd.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh)[3]!;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const size = new THREE.Vector3();
    let raised = 0;
    for (let index = 0; index < arms.count; index += 1) {
      arms.getMatrixAt(index, matrix);
      matrix.decompose(position, turn, size);
      if (new THREE.Vector3(0, -0.53, 0).applyQuaternion(turn).y > 0.2) raised += 1;
    }
    return raised;
  };

  it("sits the crowd down when reduced motion is switched on during an ovation", () => {
    const arena = buildArena();
    arena.excite(1);
    arena.update(1, 0, false);
    arena.update(1, 0, false);
    expect(armsUp(arena)).toBe(total);
    arena.update(1.02, 1 / 60, true);
    expect(armsUp(arena)).toBe(0);
    arena.dispose();
  });

  it("reaches everyone within two frames of motion coming back", () => {
    const arena = buildArena();
    arena.update(0, 1 / 60, true);
    arena.excite(1);
    arena.update(1, 0, false);
    arena.update(1, 0, false);
    expect(armsUp(arena)).toBe(total);
    arena.dispose();
  });
});

describe("the advertising boards", () => {
  it("read the right way round from inside the ring", () => {
    const arena = buildArena();
    const boards: THREE.Texture[] = [];
    arena.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshBasicMaterial;
      if (material.side === THREE.BackSide && material.map !== null && material.map.wrapS === THREE.RepeatWrapping) boards.push(material.map);
    });
    expect(boards.length).toBeGreaterThan(0);
    // The boards are the inside of a cylinder, so the picture is mirrored back by a negative repeat.
    for (const map of boards) expect(map.repeat.x).toBeLessThan(0);
    arena.dispose();
  });
});
