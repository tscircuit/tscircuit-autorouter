import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"

test("native Bun samples preserve parity and clean up", (): void => {
  const result = spawnSync(
    process.execPath,
    ["--preserve-symlinks", "tests/fixtures/benchmarkThreads.ts"],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
    },
  )
  expect(result.stderr).toBe("")
  expect(result.status).toBe(0)
  expect(result.stdout).toContain(
    "Threaded benchmark parity and cleanup passed",
  )
})
