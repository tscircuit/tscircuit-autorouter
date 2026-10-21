import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { createThreadComparisonReport } from "./fixtures/threadComparisonReport"

test("the report CLI loads all four artifacts and rejects incomplete thread flags", (): void => {
  const directory = mkdtempSync(join(tmpdir(), "threaded-report-"))
  try {
    for (const [name, time, threads] of [
      ["base", 1_000, 1],
      ["pr", 2_000, 1],
      ["base-threaded", 400, 4],
      ["pr-threaded", 500, 4],
    ] as const) {
      writeFileSync(
        join(directory, `${name}.json`),
        JSON.stringify(createThreadComparisonReport(time, threads)),
      )
    }
    const script = new URL(
      "../scripts/benchmark/same-machine-results.ts",
      import.meta.url,
    ).pathname
    const output = join(directory, "comment.md")
    const args = [
      script,
      "--base-report",
      join(directory, "base.json"),
      "--pr-report",
      join(directory, "pr.json"),
      "--output",
      output,
      "--base-sha",
      "a".repeat(40),
      "--pr-sha",
      "b".repeat(40),
      "--repository",
      "tscircuit/tscircuit-autorouter",
      "--runner-name",
      "test",
      "--threads",
      "4",
      "--base-threaded-report",
      join(directory, "base-threaded.json"),
      "--pr-threaded-report",
      join(directory, "pr-threaded.json"),
    ]
    const result = spawnSync(process.execPath, args, { encoding: "utf8" })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe("")
    expect(readFileSync(output, "utf8")).toContain(
      "| Pipeline9 | P50 time | 1.0s | 2.0s | 400ms | 500ms |",
    )
    rmSync(output)
    const incomplete = spawnSync(process.execPath, args.slice(0, -2), {
      encoding: "utf8",
    })
    expect(incomplete.status).not.toBe(0)
    expect(incomplete.stderr).toContain(
      "Missing required argument --pr-threaded-report",
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
