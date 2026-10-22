import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  root: "web",
  publicDir: false,
  plugins: [react(), tailwind()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/r": "http://127.0.0.1:3000",
      "/resume.css": "http://127.0.0.1:3000",
      "/theme.js": "http://127.0.0.1:3000",
      "/print.js": "http://127.0.0.1:3000",
      "/favicon.svg": "http://127.0.0.1:3000",
    },
  },
});
