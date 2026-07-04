import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

function getBuildTime(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const day = String(ist.getUTCDate()).padStart(2, "0");
  const month = months[ist.getUTCMonth()];
  const year = ist.getUTCFullYear();
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hh}:${mm} IST`;
}

const rawPort = process.env.PORT ?? "5173";
const port = Number(rawPort);
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
        ]
      : []),
    {
      name: "make-scripts-async",
      transformIndexHtml(html) {
        return html.replace(
          /<script(?!\s+type="module")(\s+[^>]*)?src="([^"]+)"([^>]*)>/g,
          (match, before, src, after) => {
            if (match.includes("async") || match.includes("defer")) return match;
            return `<script${before || ""} src="${src}" async${after}>`;
          }
        );
      },
    },
  ],
  define: {
    __BUILD_TIME__: JSON.stringify(getBuildTime()),
    __APP_VERSION__: JSON.stringify("1.09"),
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "frame-ancestors *",
    },
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.SERVER_PORT ?? "3001"}`,
        changeOrigin: true,
      },
    },
    fs: {
      strict: false,
    },
  },
  preview: {
    port,
    host: "::",
    allowedHosts: true,
  },
});
