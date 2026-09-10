import { test } from "bun:test"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

test("pipeline 9 routes srj18 sample 1 through Rust WASM", () => {
  // Backend selection is process-wide, so isolate it from the default TS tests.
  execFileSync(process.execPath, [
    fileURLToPath(new URL("./srj18.ts", import.meta.url)),
  ], { stdio: "pipe" })
})
