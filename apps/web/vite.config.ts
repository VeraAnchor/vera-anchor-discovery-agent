import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const agentApiTarget =
  process.env.VITE_AGENT_API_PROXY_TARGET ?? "http://localhost:5001";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/v1": {
        target: agentApiTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});