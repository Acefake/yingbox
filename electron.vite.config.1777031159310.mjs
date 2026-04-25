// electron.vite.config.ts
import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import vue from "@vitejs/plugin-vue";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      watch: {}
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      watch: {}
    }
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@": resolve("src/renderer/src")
      }
    },
    plugins: [vue()],
    server: {
      host: "127.0.0.1",
      port: 3e3,
      strictPort: false,
      hmr: true,
      watch: {
        usePolling: true
      },
      proxy: {
        "/api": {
          target: "https://api.themoviedb.org/3",
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/api/, "")
        }
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
