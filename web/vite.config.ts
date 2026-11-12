import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// `just dev-web` serves the dashboard with hot reload and proxies the rest to a local
// `devmailbox serve`.
const target = `http://127.0.0.1:${process.env.DEVMAILBOX_PORT ?? 7430}`;

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true, assetsDir: "assets" },
  server: {
    // the dashboard imports the search language from ../server/query.ts
    fs: { allow: [".."] },
    proxy: { "/api": target, "/mcp": target, "/resend": target },
  },
});
