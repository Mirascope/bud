import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 4322 },
  resolve: {
    alias: {
      "@demo": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [tanstackStart(), react()],
});
