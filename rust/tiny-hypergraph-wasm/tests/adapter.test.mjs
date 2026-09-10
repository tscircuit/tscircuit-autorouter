import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

test("typed adapter initializes, routes, reports status, and disposes safely", () => {
  // Isolate module initialization from the raw-binding tests in Bun's shared VM.
  execFileSync(process.execPath, [
    fileURLToPath(new URL("./adapter-lifecycle.mjs", import.meta.url)),
  ], { stdio: "pipe" })
})
