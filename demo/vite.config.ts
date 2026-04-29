import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const crossOriginIsolationHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
} as const;

function crossOriginIsolation(): Plugin {
  const applyHeaders = (
    _request: unknown,
    response: { setHeader: (name: string, value: string) => void },
    next: () => void,
  ) => {
    for (const [name, value] of Object.entries(crossOriginIsolationHeaders)) {
      response.setHeader(name, value);
    }
    next();
  };

  return {
    name: "bud:cross-origin-isolation",
    configureServer(server) {
      server.middlewares.use(applyHeaders);
    },
    configurePreviewServer(server) {
      server.middlewares.use(applyHeaders);
    },
  };
}

export default defineConfig({
  server: {
    port: 4322,
    headers: crossOriginIsolationHeaders,
  },
  resolve: {
    alias: {
      "@demo": fileURLToPath(new URL("./src", import.meta.url)),
      "@mirascope/bud": fileURLToPath(new URL("../src", import.meta.url)),
    },
  },
  plugins: [crossOriginIsolation(), tanstackStart(), react(), tailwindcss()],
});
