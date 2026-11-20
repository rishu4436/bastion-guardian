import { defineConfig } from "tsup";

// Internal workspace packages are bundled in, so the published tarball depends only on viem, zod and (optionally) react.
export default defineConfig({
  entry: { index: "src/index.ts", "react/index": "src/react/index.ts" },
  format: ["esm"],
  target: "es2022",
  tsconfig: "tsconfig.bundle.json",
  dts: { resolve: [/^@bastion-guardian\//] },
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  noExternal: [/^@bastion-guardian\//],
  external: ["react", "react/jsx-runtime", "viem", "zod"],
});
