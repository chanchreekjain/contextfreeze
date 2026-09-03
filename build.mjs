import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
const dev = watch || process.argv.includes("--dev");

// Some filesystems (network mounts, sandboxes) refuse deletes. esbuild
// overwrites its own output anyway, so a failed clean is not fatal.
try {
  rmSync("dist", { recursive: true, force: true });
} catch {
  console.warn("could not clear dist/, overwriting in place");
}
mkdirSync("dist", { recursive: true });

/** Static files are copied verbatim; only the TS entry points get bundled. */
function copyStatic() {
  cpSync("public", "dist", { recursive: true });
}

const options = {
  entryPoints: {
    background: "src/background/index.ts",
    content: "src/content/index.ts",
    popup: "src/popup/index.ts",
  },
  outdir: "dist",
  bundle: true,
  // IIFE keeps the content script and service worker as plain classic scripts,
  // which avoids MV3's module-loading edge cases entirely.
  format: "iife",
  target: ["chrome116"],
  sourcemap: dev ? "inline" : false,
  minify: !dev,
  legalComments: "none",
  logLevel: "info",
};

copyStatic();

if (watch) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: "copy-static",
        setup(build) {
          build.onEnd(() => copyStatic());
        },
      },
    ],
  });
  await ctx.watch();
  console.log("watching...");
} else {
  await esbuild.build(options);
  console.log("built to dist/");
}
