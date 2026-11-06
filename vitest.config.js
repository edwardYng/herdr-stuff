import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Herdr's built-in modules don't exist in Node: tests get recording fakes from test-support/stubs.
const stub = (name) => fileURLToPath(new URL(`./test-support/stubs/${name}.js`, import.meta.url));
const alias = {
  herdr: stub("herdr"),
  "gpui-kit": stub("gpui-kit"),
  "gpui-base": stub("gpui-base"),
  websocket: stub("websocket"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["mods/*/src/**/*.js", "mods/*/main.js"],
      reporter: ["text", "html"],
    },
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["mods/*/test/unit/**/*.test.js"], environment: "node" },
      },
      {
        resolve: { alias },
        test: { name: "integration", include: ["mods/*/test/integration/**/*.test.js"], environment: "node" },
      },
    ],
  },
});
