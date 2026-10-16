import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative URLs so the extension works from any host path (e.g. GitHub Pages).
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    // Owlbear Rodeo loads the dev server from its own origin.
    cors: { origin: "https://www.owlbear.rodeo" },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        editor: resolve(__dirname, "editor.html"),
        background: resolve(__dirname, "background.html"),
      },
    },
  },
});
