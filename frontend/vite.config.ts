import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the site at http://localhost:5173.
// /api is proxied to the FastAPI backend on :8000, so the session cookie is same-origin (no CORS).
export default defineConfig({
  plugins: [react()],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: false } },
    // This project lives in OneDrive; native file events can be missed there, so poll for edits.
    watch: { usePolling: true, interval: 300 },
  },
});
