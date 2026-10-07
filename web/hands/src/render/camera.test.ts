import * as THREE from "three";
import { CameraDirector, FIGHTER_CAM_LIMIT, FighterCam, fighterCamFrame } from "./camera";

const step = 1 / 60;

describe("the player's own camera", () => {
  it("stands behind the fighter and over his right shoulder, looking at the opponent", () => {
    const position = new THREE.Vector3();
    const lookAt = new THREE.Vector3();
    fighterCamFrame({ x: -0.6, z: 0 }, { x: 0.6, z: 0 }, 1, 0, position, lookAt);
    expect(position.x).toBeLessThan(-2.4);
    expect(position.z).toBeGreaterThan(0.3);
    expect(position.y).toBeGreaterThan(1.6);
    expect(lookAt.x).toBeCloseTo(0.6);
    expect(lookAt.z).toBeCloseTo(0);
  });

  it("stays inside the ropes when the fighter has his back to them", () => {
    const position = new THREE.Vector3();
    const lookAt = new THREE.Vector3();
    fighterCamFrame({ x: -2.7, z: 2.7 }, { x: -1.7, z: 1.7 }, Math.SQRT1_2, -Math.SQRT1_2, position, lookAt);
    expect(Math.abs(position.x)).toBeLessThanOrEqual(FIGHTER_CAM_LIMIT);
    expect(Math.abs(position.z)).toBeLessThanOrEqual(FIGHTER_CAM_LIMIT);
  });

  it("starts behind the fighter at once and then turns with him a beat behind", () => {
    const cam = new FighterCam();
    cam.update(step, 0, { x: -0.6, z: 0 }, { x: 0.6, z: 0 }, 0, false);
    expect(cam.forwardX).toBeCloseTo(1);
    expect(cam.forwardZ).toBeCloseTo(0);
    cam.update(step, step, { x: -0.6, z: 0 }, { x: -0.6, z: 1.2 }, 0, false);
    expect(cam.forwardZ).toBeGreaterThan(0.02);
    expect(cam.forwardZ).toBeLessThan(0.5);
    for (let frame = 0; frame < 120; frame += 1) cam.update(step, step * frame, { x: -0.6, z: 0 }, { x: -0.6, z: 1.2 }, 0, false);
    expect(cam.forwardZ).toBeCloseTo(1, 2);
    cam.reset();
    cam.update(step, 0, { x: 0, z: 0 }, { x: 0, z: -1 }, 0, false);
    expect(cam.forwardZ).toBeCloseTo(-1);
  });

  it("turns the short way round", () => {
    const cam = new FighterCam();
    cam.update(step, 0, { x: 0, z: 0 }, { x: 0.05, z: -1 }, 0, false);
    const before = Math.atan2(cam.forwardX, cam.forwardZ);
    cam.update(step, step, { x: 0, z: 0 }, { x: -0.05, z: -1 }, 0, false);
    const after = Math.atan2(cam.forwardX, cam.forwardZ);
    expect(Math.abs(Math.atan2(Math.sin(after - before), Math.cos(after - before)))).toBeLessThan(0.1);
  });

  it("swings round toward the side when the fighters are chest to chest", () => {
    const orbit = (cam: FighterCam, opponentX: number): number => {
      let frame = cam.update(step, 0, { x: 0, z: 0 }, { x: opponentX, z: 0 }, 0, false);
      for (let index = 0; index < 240; index += 1) frame = cam.update(step, step * index, { x: 0, z: 0 }, { x: opponentX, z: 0 }, 0, false);
      return Math.atan2(frame.position.z, -frame.position.x);
    };
    const apart = orbit(new FighterCam(), 1.6);
    const together = orbit(new FighterCam(), 0.4);
    expect(THREE.MathUtils.radToDeg(apart)).toBeCloseTo(31, 0);
    expect(THREE.MathUtils.radToDeg(together)).toBeGreaterThan(55);
  });

  it("keeps its last direction when the fighters stand on the same spot", () => {
    const cam = new FighterCam();
    cam.update(step, 0, { x: 0, z: 0 }, { x: 1, z: 0 }, 0, false);
    cam.update(step, step, { x: 0.5, z: 0 }, { x: 0.5, z: 0 }, 0, false);
    expect(cam.forwardX).toBeCloseTo(1);
  });

  it("shakes with a heavy blow unless motion is reduced", () => {
    const still = new FighterCam();
    const shaken = new FighterCam();
    const calm = new FighterCam();
    const a = still.update(step, 0.4, { x: -0.6, z: 0 }, { x: 0.6, z: 0 }, 0, false).position.clone();
    const b = shaken.update(step, 0.4, { x: -0.6, z: 0 }, { x: 0.6, z: 0 }, 0.05, false).position.clone();
    const c = calm.update(step, 0.4, { x: -0.6, z: 0 }, { x: 0.6, z: 0 }, 0.05, true).position.clone();
    expect(a.distanceTo(b)).toBeGreaterThan(0.005);
    expect(a.distanceTo(c)).toBe(0);
  });
});

describe("the close broadcast camera", () => {
  it("stands nearer the fighters than the broadcast camera and from the same side", () => {
    const broadcast = new CameraDirector();
    const close = new CameraDirector();
    let wide = { position: new THREE.Vector3(), lookAt: new THREE.Vector3() };
    let near = { position: new THREE.Vector3(), lookAt: new THREE.Vector3() };
    for (let frame = 0; frame < 240; frame += 1) {
      wide = broadcast.update(1 / 30, frame / 30, { x: -0.6, z: 0 }, { x: 0.6, z: 0 }, 1.2, false, 0, true);
      near = close.update(1 / 30, frame / 30, { x: -0.6, z: 0 }, { x: 0.6, z: 0 }, 1.2, false, 0, true, true);
    }
    expect(near.position.distanceTo(near.lookAt)).toBeLessThan(wide.position.distanceTo(wide.lookAt) * 0.8);
    expect(near.position.z).toBeGreaterThan(2.5);
    expect(near.position.y).toBeLessThan(wide.position.y);
  });
});
