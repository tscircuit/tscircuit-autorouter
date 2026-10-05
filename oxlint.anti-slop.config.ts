import { defineConfig } from "oxlint"

// This command supplements Biome. Keep 23 semantic rules at upstream error severity.
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
    {
      name: "anti-slop-effect",
      specifier: "./tools/oxlint/anti-slop/effect/index.ts",
    },
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
  overrides: [
    {
      files: ["lib/**/*.ts", "lib/**/*.tsx"],
      rules: {
        "anti-slop/no-array-filter-map": "error",
        "anti-slop/no-reduce-accumulator-copy": "error",
        "anti-slop/no-chained-type-assertions": "error",
        "anti-slop/no-conditional-empty-object-spread": "error",
        "anti-slop/no-known-value-widening": "error",
        "anti-slop/no-module-mocking": "error",
        "anti-slop/no-object-parameters": "error",
        "anti-slop/no-reflect-apply": "error",
        "anti-slop/no-reflect-get": "error",
        "anti-slop/no-runtime-typeof": "error",
        "anti-slop/no-unsafe-dictionary-type": "error",
        "anti-slop/no-shape-in-symbol-names": "error",
        "anti-slop/no-unknown-parameters": "error",
        "anti-slop/no-unknown-returns": "error",
        "anti-slop/no-unknown-type-aliases": "error",
        "anti-slop/no-widen-then-assert": "error",
        // Biome owns formatting; this upstream rule adds blank lines throughout lib.
        "anti-slop/require-readable-spacing": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "error",
        "anti-slop-effect/no-manual-effect-error-tag": "error",
        "anti-slop-effect/no-manual-tag-comparison": "error",
        "anti-slop-effect/no-manual-tagged-construction": "error",
        "anti-slop-effect/no-service-constructor-imports": "error",
        "anti-slop-effect/prefer-effect-match": "error",
        "oxc/no-accumulating-spread": "error",
      },
    },
  ],
})
