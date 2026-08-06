class FR { readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); } }
globalThis.FileReader = FR;
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
const THREE = await import("three");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
const { readFileSync } = await import("node:fs");
const b64 = readFileSync("src/assets/fighter-glb.ts", "utf8").match(/FIGHTER_GLB_BASE64 = "([^"]+)"/)[1];
const buf = Buffer.from(b64, "base64");
new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "", (gltf) => {
  const scene = gltf.scene;
  const mixer = new THREE.AnimationMixer(scene);
  const clip = gltf.animations.find((a) => a.name === "jab_left");
  console.log("clip duration", clip.duration.toFixed(3));
  mixer.clipAction(clip).play();
  for (const t of [0, 0.067, 0.1, 0.133, 0.2, 0.3]) {
    mixer.setTime(t);
    scene.updateMatrixWorld(true);
    const wrist = scene.getObjectByName("wristl").getWorldPosition(new THREE.Vector3());
    const head = scene.getObjectByName("head").getWorldPosition(new THREE.Vector3());
    console.log(`t=${t.toFixed(3)} wrist=(${wrist.x.toFixed(2)},${wrist.y.toFixed(2)},${wrist.z.toFixed(2)}) head=(${head.x.toFixed(2)},${head.y.toFixed(2)},${head.z.toFixed(2)})`);
  }
  process.exit(0);
});
