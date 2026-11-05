import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    resolve: {
        extensions: [".tsx", ".ts", ".jsx", ".mjs", ".js", ".json"],
    },
    server: {
        host: true,
        port: 487,
        strictPort: true,
        fs: {
            allow: [".."],
        },
        proxy: {
            "/api": {
                target: "http://127.0.0.1:8090",
                changeOrigin: true,
            },
        },
    },
});
