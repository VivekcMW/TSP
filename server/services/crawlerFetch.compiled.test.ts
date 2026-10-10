import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { serverBuildOptions } from "../../script/build";

describe("production CommonJS crawler transport", () => {
  it("bundles node-fetch v3 and htmlparser2 and exercises the compiled crawler in a clean child process", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tsp-crawler-smoke-"));
    try {
      const options = await serverBuildOptions();
      expect(options.format).toBe("cjs");
      const bundledDependencies = ["node-fetch", "htmlparser2"];
      for (const dependency of bundledDependencies) {
        expect(options.external).not.toContain(dependency);
      }
      // Build the real server entry without executing it or changing shared dist.
      const server = await build({ ...options, write: false, metafile: true, logLevel: "silent" });
      const outfile = join(directory, "crawler.cjs");
      const compiled = await build({ ...options, entryPoints: ["server/services/fixtures/crawler-compiled-smoke.ts"], outfile, metafile: true, logLevel: "silent" });
      for (const artifact of [server, compiled]) {
        for (const dependency of bundledDependencies) {
          expect(Object.keys(artifact.metafile!.inputs).some(file => file.includes(`node_modules/${dependency}/`))).toBe(true);
          expect(Object.values(artifact.metafile!.outputs).flatMap(output => output.imports).some(item =>
            item.external && (item.path === dependency || item.path.startsWith(`${dependency}/`))
          )).toBe(false);
        }
      }
      const { stdout } = await promisify(execFile)(process.execPath, [outfile], {
        cwd: directory,
        // No inherited keys, dotenv, DB, Redis, proxy, or NODE_OPTIONS settings.
        env: { NODE_ENV: "test" },
        timeout: 15_000,
      });
      expect(stdout).toContain("compiled crawler transport smoke passed");

      // Reproduce the missing-parser regression with the same isolated runtime.
      // A NODE_PATH workaround would hide this production artifact dependency.
      const externalParserOutfile = join(directory, "external-parser.cjs");
      await build({ ...options, entryPoints: ["server/services/fixtures/crawler-compiled-smoke.ts"], external: [...options.external!, "htmlparser2"], outfile: externalParserOutfile, logLevel: "silent" });
      await expect(promisify(execFile)(process.execPath, [externalParserOutfile], {
        cwd: directory,
        env: { NODE_ENV: "test" },
        timeout: 15_000,
      })).rejects.toMatchObject({ stderr: expect.stringContaining("Cannot find module 'htmlparser2'") });

      // Negative control reproduces the old build without editing application
      // files: an external ESM default becomes a namespace (or ERR_REQUIRE_ESM
      // on older Node). A source-only/mocked test would miss this failure.
      // Only this deliberately broken control resolves the installed node-fetch.
      const brokenOutfile = join(directory, "external-fetch.cjs");
      await build({ ...options, entryPoints: ["server/services/fixtures/crawler-compiled-smoke.ts"], external: [...options.external!, "node-fetch"], outfile: brokenOutfile, logLevel: "silent" });
      await expect(promisify(execFile)(process.execPath, [brokenOutfile], {
        cwd: directory,
        env: { NODE_ENV: "test", NODE_PATH: join(process.cwd(), "node_modules") },
        timeout: 15_000,
      })).rejects.toMatchObject({ stderr: expect.stringMatching(/node-fetch default export must be callable|ERR_REQUIRE_ESM/) });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});