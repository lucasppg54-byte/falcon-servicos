import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Config separada do vite.config.ts: o preset do Lovable/TanStack Start não é necessário
// (nem compatível) para correr testes unitários de lógica pura.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
