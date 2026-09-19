import { build as esbuild, type BuildOptions } from "esbuild";
import { rm, readFile } from "fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "nanoid",
  // ESM-only v3 must be bundled: external CJS default interop varies by Node version.
  "node-fetch",
  // Keep crawler DOM/date parsing self-contained in the compiled artifact.
  "htmlparser2",
  "@clerk/express",
  "@google/genai",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "p-limit",
  "passport",
  "passport-oauth2",
  "pg",
  "resend",
  "rss-parser",
  "zod",
];

/** Shared with the compiled transport smoke test; importing never builds or clears dist. */
export async function serverBuildOptions(): Promise<BuildOptions> {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  return {
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  };
}

async function buildAll() {
  await rm("dist", { recursive: true, force: true });
  console.log("building client...");
  const { build: viteBuild } = await import("vite");
  await viteBuild();
  console.log("building server...");
  await esbuild(await serverBuildOptions());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  buildAll().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
