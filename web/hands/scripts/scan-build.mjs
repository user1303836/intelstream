import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../src/intelstream/hands/static/", import.meta.url));
const expected = new Set(["index.html", "assets/hands.js", "assets/hands.css"]);
const reviewedSdkUrls = new Set([
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
  if (/\b(?:eval\s*\(|new\s+Function\b|Function\s*\()/u.test(source)) failures.push(`${name}: dynamic code constructor`);
  if (/sourceMappingURL/iu.test(source)) failures.push(`${name}: source map reference`);
  const literals = [];
  for (const string of source.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gsu)) {
    for (const match of string[0].slice(1, -1).matchAll(/(?:https?:)?(?:\/|\\\/){2}[^\s"'`\\<>(){},;]+/giu)) {
      literals.push(match[0].replaceAll("\\/", "/"));
    }
  }
  if (name.endsWith(".css")) {
    for (const match of source.matchAll(/(?:url\(|@import\s+)[\s"']*((?:https?:)?\/\/[^\s"')]+)/giu)) literals.push(match[1]);
  }
  if (name.endsWith(".html")) {
    for (const match of source.matchAll(/\b[\w:-]+\s*=\s*((?:https?:)?\/\/[^\s>]+)/giu)) literals.push(match[1]);
  }
  for (const literal of literals) {
    if (!reviewedSdkUrls.has(literal)) failures.push(`${name}: unreviewed external URL literal: ${literal}`);
  }
  if (/(?<![\w-])(?:client[_-]?secret|bot[_-]?token)(?![\w-])/iu.test(source)) failures.push(`${name}: sensitive server-only identifier`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:mfa\.[\w-]{20,}|[A-Za-z\d_-]{24}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{25,})/iu.test(source)) failures.push(`${name}: credential-like value`);
}
if (failures.length > 0) throw new Error(`Unsafe production build:\n${failures.join("\n")}`);
console.log(`Static scan passed: exact ${expected.size}-file manifest; no dynamic code, source maps, unreviewed URLs, or credentials.`);
