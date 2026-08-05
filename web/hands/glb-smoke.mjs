class FR {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((r) => { this.result = r; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = "data:application/octet-stream;base64," + Buffer.from(b).toString("base64"); this.onloadend?.(); }); }
}
globalThis.FileReader = FR;
const THREE = await import("three");
const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

const bone1 = new THREE.Bone(); bone1.name = "hips";
const bone2 = new THREE.Bone(); bone2.name = "spine"; bone2.position.y = 0.3;
bone1.add(bone2);
const geo = new THREE.CylinderGeometry(0.1, 0.1, 0.6, 8, 4);
geo.translate(0, 0.3, 0);
const pos = geo.getAttribute("position");
const skinIndex = new Uint16Array(pos.count * 4);
const skinWeight = new Float32Array(pos.count * 4);
for (let i = 0; i < pos.count; i += 1) {
  const y = pos.getY(i);
  const w = Math.min(1, Math.max(0, y / 0.6));
  skinIndex[i * 4] = 0; skinIndex[i * 4 + 1] = 1;
  skinWeight[i * 4] = 1 - w; skinWeight[i * 4 + 1] = w;
}
geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndex, 4));
geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeight, 4));
const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xa07050 }));
const skeleton = new THREE.Skeleton([bone1, bone2]);
mesh.add(bone1);
mesh.bind(skeleton);
const scene = new THREE.Scene();
scene.add(mesh);

const track = new THREE.QuaternionKeyframeTrack("spine.quaternion", [0, 0.5, 1], [0, 0, 0, 1, 0, 0.1826, 0, 0.9833, 0, 0, 0, 1]);
const clip = new THREE.AnimationClip("test_clip", 1, [track]);
scene.animations = [clip];

new GLTFExporter().parse(scene, async (result) => {
  const buffer = result;
  console.log("GLB bytes:", buffer.byteLength);
  new GLTFLoader().parse(buffer, "", (gltf) => {
    console.log("reload ok: skinnedMeshes=", gltf.scene.children.map((c) => c.type).join(","), "clips=", gltf.animations.map((a) => `${a.name}:${a.duration}`).join(","));
    process.exit(0);
  }, (e) => { console.error("parse fail", e); process.exit(1); });
}, (e) => { console.error("export fail", e); process.exit(1); }, { binary: true, animations: [clip] });
