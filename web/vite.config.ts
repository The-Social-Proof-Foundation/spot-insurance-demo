import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
    const configDir = path.dirname(new URL(import.meta.url).pathname);
    // Read the workspace-level .env alongside web/.env.
    const workspaceEnv = loadEnv(mode, path.resolve(configDir, ".."), "");
    const localEnv = loadEnv(mode, configDir, "VITE_");
    const apiTarget =
        process.env.VITE_API_BASE_URL ??
        localEnv.VITE_API_BASE_URL ??
        workspaceEnv.VITE_API_BASE_URL ??
        "http://127.0.0.1:8787";

    return {
        plugins: [react()],
        resolve: {
            alias: { "@": path.resolve(configDir, "src") },
        },
        server: {
            port: 5273,
            strictPort: false,
            proxy: {
                // Same-origin API access in dev; the backend sets permissive CORS too.
                "/api": { target: apiTarget, changeOrigin: true },
            },
        },
    };
});
