import { test } from "bun:test"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import * as samples from "dataset-srj18"

test("Rust and TS port pathing produce identical results on srj18", () => {
  const sampleNames = Object.keys(samples).filter((name) => /^sample\d{3}$/.test(name)).sort()
  for (const sampleName of sampleNames) {
    // Each process compares the frozen TS checkout with the production Rust adapter.
    execFileSync(process.execPath, [
      fileURLToPath(new URL("./parity.ts", import.meta.url)), sampleName,
    ], { stdio: "inherit" })
  }
})
