import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import type { Plugin } from "vite";

// Fonts used above the fold on every public page: body text and the h1. Preloading them
// lets the browser fetch them in parallel with the CSS instead of after it.
const PRELOADED_FONTS = [/inter-latin-400-normal-[^/]+\.woff2$/, /poppins-latin-600-normal-[^/]+\.woff2$/];

function preloadCriticalFonts(): Plugin {
  return {
    name: "preload-critical-fonts",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const files = Object.keys(ctx.bundle ?? {});
        return PRELOADED_FONTS.flatMap(pattern => files.filter(file => pattern.test(file))).map(file => ({
          tag: "link",
          attrs: { rel: "preload", href: `/${file}`, as: "font", type: "font/woff2", crossorigin: "" },
          injectTo: "head-prepend" as const,
        }));
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), preloadCriticalFonts()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 750,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts") || id.includes("victory")) return "charts-vendor";
          if (id.includes("framer-motion")) return "motion-vendor";
          // Only React itself is pinned. Radix and Lucide are left to Rollup so each route pulls
          // in just the components it uses; pinning them here put every dashboard component in
          // the chunk every public page downloads. They must never get their own manual chunk:
          // they call React.forwardRef at module-eval time and a manual chunk can evaluate
          // before React initializes ("Cannot read properties of undefined (reading 'forwardRef')").
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "react-vendor";
          return undefined;
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
