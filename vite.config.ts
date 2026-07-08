import { defineConfig } from "vite";

/**
 * vite configuration file.
 * configures development server proxy to forward api requests to the bun backend.
 */
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
