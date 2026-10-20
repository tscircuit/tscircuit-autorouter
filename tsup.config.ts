import { defineConfig } from "tsup"

export default defineConfig({
  entry: {
    index: "lib/index.ts",
    "runtime/bun": "lib/runtime/bun.ts",
    "runtime/node": "lib/runtime/node.ts",
  },
})
