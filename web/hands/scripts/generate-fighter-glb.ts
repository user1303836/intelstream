/**
 * Prepares the skinned HANDS fighter from the Texel Boxer source
 * (assets-src/Boxer.glb): strips props and the source animation, splits the
 * glove mesh into independently detachable left and right gloves, normalizes
 * skin weights, and embeds the five base-color textures. All motion is
 * generated at runtime by the pose solver, so the exported GLB carries no clips.
 *
 * Outputs:
 *   web/hands/src/assets/fighter-glb.ts        (base64 gzip-compressed GLB)
 *   web/hands/src/assets/fighter-textures.ts   (embedded source textures)
 *
 * Run: npm run generate:fighter   (from web/hands)
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { BONE_ADAPTER } from "../src/render/skeleton";

class FileReaderPolyfill {
  result: unknown = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = `data:application/octet-stream;base64,${Buffer.from(buffer).toString("base64")}`;
      this.onloadend?.();
    });
  }
}
const globals = globalThis as Record<string, unknown>;
globals.FileReader = FileReaderPolyfill;
globals.self = globalThis;
globals.window = globalThis;
globals.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
globals.document = {
  createElement: (tag: string) => (tag === "canvas" ? { width: 0, height: 0, getContext: () => null } : {}),
  createElementNS: () => ({}),
};

const OUT_DIR = `${process.cwd()}/src/assets`;

async function loadModel(path: string): Promise<GLTF> {
  const buffer = readFileSync(path);
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      "",
      resolve,
      (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

interface SourceGltf {
  readonly bufferViews?: readonly { readonly buffer?: number; readonly byteOffset?: number; readonly byteLength: number }[];
  readonly images?: readonly { readonly bufferView?: number; readonly mimeType?: string }[];
  readonly textures?: readonly { readonly source?: number }[];
  readonly materials?: readonly {
    readonly name?: string;
    readonly pbrMetallicRoughness?: { readonly baseColorTexture?: { readonly index: number } };
  }[];
}

const TEXTURE_SPECS = [
  { key: "head", material: "MHeadMat0" },
  { key: "gloves", material: "GlovesMat0" },
  { key: "body", material: "MBodyMat0" },
  { key: "shoes", material: "ShoesMat0" },
  { key: "pants", material: "PantsMat0" },
] as const;

function embeddedTextureDataUrls(path: string): Record<(typeof TEXTURE_SPECS)[number]["key"], string> {
  const source = readFileSync(path);
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error(`${path} is not a glTF 2 GLB`);
  }
  let offset = 12;
  let jsonBytes: Buffer | null = null;
  let binaryBytes: Buffer | null = null;
  while (offset < source.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    const chunk = source.subarray(offset, offset + length);
    if (type === 0x4e4f534a) jsonBytes = chunk;
    if (type === 0x004e4942) binaryBytes = chunk;
    offset += length;
  }
  if (jsonBytes === null || binaryBytes === null) throw new Error(`${path} has no embedded JSON or binary chunk`);
  const sourceGltf = JSON.parse(jsonBytes.toString("utf8")) as SourceGltf;
  const result = {} as Record<(typeof TEXTURE_SPECS)[number]["key"], string>;
  for (const spec of TEXTURE_SPECS) {
    const material = sourceGltf.materials?.find((candidate) => candidate.name === spec.material);
    const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
    const imageIndex = textureIndex === undefined ? undefined : sourceGltf.textures?.[textureIndex]?.source;
    const image = imageIndex === undefined ? undefined : sourceGltf.images?.[imageIndex];
    const bufferView = image?.bufferView === undefined ? undefined : sourceGltf.bufferViews?.[image.bufferView];
    if (image?.mimeType === undefined || bufferView === undefined || (bufferView.buffer ?? 0) !== 0) {
      throw new Error(`${path} has no embedded base-color image for ${spec.material}`);
    }
    const imageBytes = binaryBytes.subarray(
      bufferView.byteOffset ?? 0,
      (bufferView.byteOffset ?? 0) + bufferView.byteLength,
    );
    result[spec.key] = `data:${image.mimeType};base64,${imageBytes.toString("base64")}`;
  }
  return result;
}

function splitGloveMesh(mesh: THREE.SkinnedMesh): readonly [THREE.SkinnedMesh, THREE.SkinnedMesh] {
  const index = mesh.geometry.getIndex();
  const skinIndex = mesh.geometry.getAttribute("skinIndex");
  const skinWeight = mesh.geometry.getAttribute("skinWeight");
  if (index === null || skinIndex === undefined || skinWeight === undefined) {
    throw new Error("Boxer gloves require indexed skin weights");
  }
  const triangles = { left: [] as number[], right: [] as number[] };
  const vertexSide = (vertex: number): number => {
    let score = 0;
    const indices = [skinIndex.getX(vertex), skinIndex.getY(vertex), skinIndex.getZ(vertex), skinIndex.getW(vertex)];
    const weights = [skinWeight.getX(vertex), skinWeight.getY(vertex), skinWeight.getZ(vertex), skinWeight.getW(vertex)];
    for (let component = 0; component < 4; component += 1) {
      const boneName = mesh.skeleton.bones[indices[component]!]!.name;
      if (boneName.startsWith("Left")) score += weights[component]!;
      if (boneName.startsWith("Right")) score -= weights[component]!;
    }
    return score;
  };
  for (let offset = 0; offset < index.count; offset += 3) {
    const vertices = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    const side = vertices.reduce((score, vertex) => score + vertexSide(vertex), 0);
    if (Math.abs(side) < 0.01) throw new Error(`Boxer glove triangle ${offset / 3} has no anatomical side`);
    triangles[side > 0 ? "left" : "right"].push(...vertices);
  }
  const make = (side: "left" | "right"): THREE.SkinnedMesh => {
    const part = mesh.clone();
    part.name = side === "left" ? "BoxerGloveLeft" : "BoxerGloveRight";
    part.geometry = mesh.geometry.clone();
    part.geometry.setIndex(triangles[side]);
    return part;
  };
  const left = make("left");
  const right = make("right");
  mesh.parent!.add(left, right);
  mesh.removeFromParent();
  return [left, right];
}

function cleanSkinWeights(scene: THREE.Object3D): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const joints = object.geometry.getAttribute("skinIndex");
    const weights = object.geometry.getAttribute("skinWeight");
    if (joints === undefined || weights === undefined) throw new Error(`${object.name} has no skin weights`);
    for (let index = 0; index < weights.count; index += 1) {
      const jointValues = [joints.getX(index), joints.getY(index), joints.getZ(index), joints.getW(index)];
      const weightValues = [weights.getX(index), weights.getY(index), weights.getZ(index), weights.getW(index)];
      const combined = new Map<number, number>();
      for (let component = 0; component < 4; component += 1) {
        const weight = weightValues[component]!;
        if (weight > 0) combined.set(jointValues[component]!, (combined.get(jointValues[component]!) ?? 0) + weight);
      }
      const influences = [...combined].sort((left, right) => right[1] - left[1]).slice(0, 4);
      const total = influences.reduce((sum, influence) => sum + influence[1], 0);
      if (total <= 0) throw new Error(`${object.name} vertex ${index} has no positive skin weights`);
      while (influences.length < 4) influences.push([0, 0]);
      joints.setXYZW(index, influences[0]![0], influences[1]![0], influences[2]![0], influences[3]![0]);
      weights.setXYZW(
        index,
        influences[0]![1] / total,
        influences[1]![1] / total,
        influences[2]![1] / total,
        influences[3]![1] / total,
      );
    }
    joints.needsUpdate = true;
    weights.needsUpdate = true;
  });
}

async function main(): Promise<void> {
  const sourcePath = "assets-src/Boxer.glb";
  const textureDataUrls = embeddedTextureDataUrls(sourcePath);
  const model = await loadModel(sourcePath);
  const props: THREE.Object3D[] = [];
  const meshNames = new Map([
    ["MHeadMat0", "BoxerHead"],
    ["MBodyMat0", "BoxerBody"],
    ["ShoesMat0", "BoxerShoes"],
    ["PantsMat0", "BoxerPants"],
  ]);
  let gloveMesh: THREE.SkinnedMesh | null = null;
  model.scene.traverse((object) => {
    if (object instanceof THREE.Mesh && !(object instanceof THREE.SkinnedMesh)) props.push(object);
    if (object instanceof THREE.SkinnedMesh && !Array.isArray(object.material)) {
      if (object.material.name === "GlovesMat0") gloveMesh = object;
      else object.name = meshNames.get(object.material.name) ?? object.name;
    }
  });
  if (gloveMesh === null) throw new Error("Boxer source has no separable glove mesh");
  splitGloveMesh(gloveMesh);
  console.log(`stripping ${props.length} prop meshes: ${props.map((prop) => prop.name).join(", ")}`);
  for (const prop of props) prop.removeFromParent();
  model.scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        const standard = material as THREE.MeshStandardMaterial;
        standard.map = null;
        standard.color.setHex(0xffffff);
      }
    }
  });
  cleanSkinWeights(model.scene);
  const bones = new Set<string>();
  model.scene.traverse((object) => {
    if (object instanceof THREE.Bone) bones.add(object.name);
  });
  const missing = Object.entries(BONE_ADAPTER).filter(([, target]) => !bones.has(target));
  if (missing.length > 0) {
    throw new Error(`Boxer.glb is missing required bones: ${missing.map(([from, to]) => `${from}→${to}`).join(", ")}`);
  }
  model.scene.userData.attribution = '"Boxer" by Texel, Inc., CC BY 4.0';
  model.scene.userData.source = "https://sketchfab.com/3d-models/boxer-84767168720948b38728ff78ee6f6090";

  const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
    new GLTFExporter().parse(
      model.scene,
      (result) => resolve(result as ArrayBuffer),
      (error: unknown) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true, animations: [] },
    );
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const compressed = gzipSync(Buffer.from(glb), { level: 9 });
  const base64 = compressed.toString("base64");
  const sha = createHash("sha256").update(Buffer.from(glb)).digest("hex");
  writeFileSync(
    `${OUT_DIR}/fighter-glb.ts`,
    `// Generated from assets-src/Boxer.glb (Texel, Inc., CC BY 4.0).\nexport const FIGHTER_GLB_GZIP_BASE64 = "${base64}";\nexport const FIGHTER_GLB_SHA256 = "${sha}";\n`,
  );
  writeFileSync(
    `${OUT_DIR}/fighter-textures.ts`,
    `// Generated from assets-src/Boxer.glb (Texel, Inc., CC BY 4.0).\nexport const FIGHTER_TEXTURE_DATA_URLS = ${JSON.stringify(textureDataUrls)} as const;\n`,
  );
  console.log(`fighter GLB: ${glb.byteLength} bytes, gzip ${compressed.byteLength} bytes, base64 ${base64.length} chars, sha256 ${sha}`);
}

await main();
