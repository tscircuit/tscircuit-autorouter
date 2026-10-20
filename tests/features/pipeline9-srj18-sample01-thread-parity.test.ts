import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("dataset18 sample01 matches exactly with four native Bun workers", async (): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "pipeline9-thread-parity-"))
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--preserve-symlinks",
        new URL(
          "../fixtures/pipeline9Sample01ThreadParity.ts",
          import.meta.url,
        ).pathname,
        directory,
      ],
      {
        cwd: new URL("../../", import.meta.url),
        encoding: "utf8",
      },
    )
    if (result.status !== 0) {
      throw new Error(
        `Native Bun parity process failed (${result.status}):\n${result.stderr}\n${result.stdout}`,
      )
    }
    const report = JSON.parse(
      readFileSync(join(directory, "parity.json"), "utf8"),
    )
    expect(report.threads).toBe(4)
    expect(report.dispatchCount).toBeGreaterThanOrEqual(4)
    expect(report.connections).toBeGreaterThanOrEqual(100)
    expect(report.obstacles).toBeGreaterThanOrEqual(200)
    expect(report.routedTraces).toBeGreaterThanOrEqual(100)
    expect(report.threadedHash).toBe(report.serialHash)
    console.log(JSON.stringify(report))
    const svg = readFileSync(join(directory, "comparison.svg"), "utf8")
    expect(svg.indexOf("UNTHREADED")).toBeLessThan(svg.indexOf("4 THREADS"))
    await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 1 })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
