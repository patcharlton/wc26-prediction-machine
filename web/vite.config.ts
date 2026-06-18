import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "/" on Render (domain root). For a GitHub Pages project site the path is
// /<repo>/, so the Pages workflow sets BASE_PATH=/wc26-prediction-machine/.
// Same source serves both hosts; data is fetched from raw GitHub either way.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? "/",
});
