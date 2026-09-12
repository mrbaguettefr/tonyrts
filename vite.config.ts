import { defineConfig } from "vite";
export default defineConfig({
  server: {
    proxy: {
      "/multiplayer": {
        target: `ws://127.0.0.1:${process.env.GAME_SERVER_PORT || "8787"}`,
        ws: true,
      },
      "/health": `http://127.0.0.1:${process.env.GAME_SERVER_PORT || "8787"}`,
    },
  },
  build: { rollupOptions: { output: { manualChunks: { three: ["three"] } } } },
});
