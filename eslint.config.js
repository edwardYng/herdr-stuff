import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

// What Herdr's script runtime provides as globals (see types/gpui-kit.d.ts).
const herdrGlobals = {
  fetch: "readonly",
  console: "readonly",
  process: "readonly",
  window: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  TextDecoder: "readonly",
};

export default [
  { ignores: ["node_modules/", "coverage/", "types/", "**/*.d.ts"] },
  js.configs.recommended,
  {
    files: ["mods/*/main.js", "mods/*/src/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: herdrGlobals },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "prefer-const": "error",
      eqeqeq: ["error", "smart"],
      "no-console": "off",
    },
  },
  {
    files: ["**/test/**/*.js", "test-support/**/*.js", "scripts/**/*.js", "*.config.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: { ...globals.node } },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  prettier,
];
