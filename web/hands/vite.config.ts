import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";

const backend = process.env.HANDS_DEV_BACKEND ?? "http://127.0.0.1:8080";
const lodashTransformSuffix = "/@discord/embedded-app-sdk/output/lib/lodash.transform/index.mjs";
const unsafeGlobalLookup = "Function('return this')()";

function discordSdkSafeGlobal(): Plugin {
  return {
    name: "discord-sdk-safe-global",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replaceAll("\\", "/").split("?", 1)[0]!;
      if (!normalized.endsWith(lodashTransformSuffix)) return null;
      if (!code.includes(unsafeGlobalLookup)) throw new Error("Discord SDK lodash global lookup changed; review the narrow CSP transform");
      return { code: code.replaceAll(unsafeGlobalLookup, "globalThis"), map: null };
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [discordSdkSafeGlobal()],
  build: {
    outDir: fileURLToPath(new URL("../../src/intelstream/hands/static", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000,
    rollupOptions: {
      output: {
        entryFileNames: "assets/hands.js",
        assetFileNames: (asset) => asset.names.some((name) => name.endsWith(".css"))
          ? "assets/hands.css"
          : "assets/[name][extname]",
        chunkFileNames: "assets/hands-[name].js",
      },
    },
  },
  server: {
    proxy: {
      "/api/hands": { target: backend, changeOrigin: false, ws: true },
    },
  },
});
