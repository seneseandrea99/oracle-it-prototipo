import { defineConfig } from "vite";
import { readdirSync, existsSync } from "fs";
import { resolve } from "path";

// base relativo per GitHub Pages; ogni cartella in varianti/ con un index.html diventa una pagina in più
const varianti = existsSync("varianti") ? readdirSync("varianti").filter((d) => existsSync(`varianti/${d}/index.html`)) : [];
export default defineConfig({
  base: "./",
  build: { rollupOptions: { input: { main: resolve(__dirname, "index.html"), ...Object.fromEntries(varianti.map((d) => [d, resolve(__dirname, `varianti/${d}/index.html`)])) } } },
});
