import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "/" — the site is hosted at the domain root on Render. Absolute asset
// paths are robust regardless of the request path the SPA rewrite serves.
export default defineConfig({
  plugins: [react()],
  base: "/",
});
