import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/server/app.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  logLevel: "info",
});
