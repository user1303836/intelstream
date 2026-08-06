import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { externalUrlLiterals } from "./url-literals.mjs";

const root = fileURLToPath(new URL("../../../src/intelstream/hands/static/", import.meta.url));
const expected = new Set(["index.html", "assets/hands.js", "assets/hands.css"]);
const maxHandsJsBytes = 6_000_000;
const maxHandsJsGzipBytes = 3_200_000;
const reviewedExternalUrls = new Set([
  "https://github.com/uuidjs/uuid#getrandomvalues-not-supported",
  "https://discord.com",
  "https://discordapp.com",
  "https://ptb.discord.com",
  "https://ptb.discordapp.com",
  "https://canary.discord.com",
  "https://canary.discordapp.com",
  "https://staging.discord.co",
  "http://localhost:3333",
  "https://pax.discord.com",
  // Texel Boxer source and CC BY 4.0 license attribution shown in-app.
  "https://sketchfab.com/3d-models/boxer-84767168720948b38728ff78ee6f6090",
  "https://creativecommons.org/licenses/by/4.0/",
  // Pinned three.js: W3C XHTML namespace identifier (never fetched) and a
  // JCGT paper citation inside a shader source comment.
  "http://www.w3.org/1999/xhtml",
  "https://jcgt.org/published/0007/04/01/",
]);

const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}
await walk(root);

const failures = [];
const found = new Set(files.map((path) => relative(root, path).split(sep).join("/")));
for (const name of expected) {
  if (!found.has(name)) failures.push(`${name}: missing generated asset`);
}
for (const name of found) {
  if (!expected.has(name)) failures.push(`${name}: unexpected generated asset`);
}

for (const path of files) {
  const name = relative(root, path).split(sep).join("/");
  if (path.endsWith(".map")) failures.push(`${name}: source map file`);
  if (![".js", ".css", ".html"].includes(extname(path))) failures.push(`${name}: unexpected static asset type`);
  const source = await readFile(path, "utf8");
  if (name === "assets/hands.js") {
    const bytes = Buffer.byteLength(source);
    const gzipBytes = gzipSync(source, { level: 9 }).byteLength;
    if (bytes > maxHandsJsBytes) failures.push(`${name}: ${bytes} bytes exceeds ${maxHandsJsBytes}-byte budget`);
    if (gzipBytes > maxHandsJsGzipBytes) failures.push(`${name}: ${gzipBytes} gzip bytes exceeds ${maxHandsJsGzipBytes}-byte budget`);
  }
  if (/\b(?:eval\s*\(|new\s+Function\b|Function\s*\()/u.test(source)) failures.push(`${name}: dynamic code constructor`);
  if (/sourceMappingURL/iu.test(source)) failures.push(`${name}: source map reference`);
  const literals = externalUrlLiterals(source);
  if (name.endsWith(".css")) {
    for (const match of source.matchAll(/(?:url\(|@import\s+)[\s"']*((?:https?:)?\/\/[^\s"')]+)/giu)) literals.add(match[1]);
  }
  if (name.endsWith(".html")) {
    for (const match of source.matchAll(/\b[\w:-]+\s*=\s*((?:https?:)?\/\/[^\s>]+)/giu)) literals.add(match[1]);
  }
  for (const literal of literals) {
    if (!reviewedExternalUrls.has(literal)) failures.push(`${name}: unreviewed external URL literal: ${literal}`);
  }
  if (/(?<![\w-])(?:client[_-]?secret|bot[_-]?token)(?![\w-])/iu.test(source)) failures.push(`${name}: sensitive server-only identifier`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:mfa\.[\w-]{20,}|[A-Za-z\d_-]{24}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{25,})/iu.test(source)) failures.push(`${name}: credential-like value`);
}
if (failures.length > 0) throw new Error(`Unsafe production build:\n${failures.join("\n")}`);
console.log(`Static scan passed: exact ${expected.size}-file manifest; no dynamic code, source maps, unreviewed URLs, or credentials.`);
