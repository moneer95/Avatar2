import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ["three"],
  },
  optimizeDeps: {
    include: ["three"],
  },
  server: {
    host: true,
    port: 5173,
  },
});
