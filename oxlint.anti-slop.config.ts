import { defineConfig } from "oxlint"

// This command supplements Biome. Keep the initial policy small and diagnostic.
export default defineConfig({
  plugins: ["oxc"],
  categories: {
    correctness: "off",
    suspicious: "off",
    pedantic: "off",
    perf: "off",
    style: "off",
    restriction: "off",
    nursery: "off",
  },
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
  ],
  ignorePatterns: [
    "node_modules/**",
    "dist/**",
    "fixtures/**",
    "cosmos-export/**",
    "coverage/**",
    "tools/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    "**/__snapshots__/**",
    "**/*.test.*",
    "**/*.spec.*",
  ],
  rules: {
    "anti-slop/no-shape-in-symbol-names": "off",
    "anti-slop/no-array-filter-map": "off",
    "anti-slop/no-conditional-empty-object-spread": "off",
    "anti-slop/no-known-value-widening": "off",
    "anti-slop/no-module-mocking": "off",
    "anti-slop/no-object-parameters": "off",
    "anti-slop/no-reflect-apply": "off",
    "anti-slop/no-reflect-get": "off",
    "anti-slop/no-runtime-typeof": "off",
    "anti-slop/no-unknown-parameters": "off",
    "anti-slop/no-unknown-returns": "off",
    "anti-slop/no-unknown-type-aliases": "off",
    "anti-slop/no-unsafe-dictionary-type": "off",
    "anti-slop/require-readable-spacing": "off",
    "anti-slop/require-safety-comment-for-type-assertion": "off",
  },
  overrides: [
    {
      files: ["lib/**/*.ts", "lib/**/*.tsx"],
      rules: {
        "anti-slop/no-chained-type-assertions": "warn",
        "anti-slop/no-widen-then-assert": "warn",
        "anti-slop/no-reduce-accumulator-copy": "warn",
        "oxc/no-accumulating-spread": "warn",
      },
    },
  ],
})
