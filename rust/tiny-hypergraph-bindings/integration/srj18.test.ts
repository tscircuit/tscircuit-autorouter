import { test } from "bun:test"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

test("pipeline 9 routes srj18 sample 1 through Rust WASM", () => {
  // Exercise synchronous embedded initialization in a fresh process.
  execFileSync(process.execPath, [
    fileURLToPath(new URL("./srj18.ts", import.meta.url)),
  ], { stdio: "pipe" })
})
