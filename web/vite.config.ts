import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" keeps asset paths relative so the build works on any static host
// (Render static site) without path config.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
