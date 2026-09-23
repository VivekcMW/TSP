import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("recharts") || id.includes("victory")) return "charts-vendor";
          if (id.includes("framer-motion")) return "motion-vendor";
          // @radix-ui/lucide-react call React.forwardRef at module-eval time, so they
          // must share a chunk with react/react-dom rather than a separate "ui-vendor"
          // chunk — a separate chunk risks executing before react-vendor initializes,
          // throwing "Cannot read properties of undefined (reading 'forwardRef')".
          if (id.includes("react/") || id.includes("react-dom") || id.includes("scheduler") ||
              id.includes("@radix-ui") || id.includes("lucide-react")) return "react-vendor";
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
