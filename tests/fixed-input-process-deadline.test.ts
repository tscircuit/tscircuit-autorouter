import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runProcessWithDeadline } from "../scripts/benchmark/fixed-input/processDeadline"

test("the parent deadline interrupts synchronous child setup and retains its log", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fixed-input-deadline-"))
  try {
    const result = await runProcessWithDeadline({
      command: [
        process.execPath,
        "-e",
        "console.log('constructor started'); while (true) {}",
      ],
      cwd: directory,
      budgetMs: 500,
      logPath: join(directory, "engine.log"),
    })
    expect(result.status).toBe("timed_out")
    expect(result.signal).toBe("SIGKILL")
    expect(result.exitCode).toBeNull()
    expect(result.elapsedMs).toBeGreaterThanOrEqual(500)
    expect(await readFile(join(directory, "engine.log"), "utf8")).toContain(
      "constructor started",
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
