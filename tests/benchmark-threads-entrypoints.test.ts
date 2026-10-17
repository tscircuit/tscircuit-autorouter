import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("entrypoints preserve per-sample thread budgets", (): void => {
  const directory = mkdtempSync(join(tmpdir(), "benchmark-threads-"))
  try {
    writeFileSync(
      join(directory, "bun"),
      '#!/bin/sh\nif [ "$1" = "--eval" ]; then echo 32; else printf "%s\\n" "$@"; fi\n',
      { mode: 0o755 },
    )
    const result = spawnSync(
      "bash",
      ["benchmark.sh", "--pipeline", "9", "--threads", "4"],
      {
        cwd: new URL("../", import.meta.url),
        env: { ...process.env, PATH: directory + ":" + process.env.PATH },
        encoding: "utf8",
      },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("--threads\n4\n")
    const missing = spawnSync("bash", ["benchmark.sh", "--threads"], {
      cwd: new URL("../", import.meta.url),
      env: { ...process.env, PATH: directory + ":" + process.env.PATH },
      encoding: "utf8",
    })
    expect(missing.status).toBe(1)
    expect(missing.stderr).toContain("--threads requires")
    const workflow = readFileSync(
      new URL("../.github/workflows/benchmark.yml", import.meta.url),
      "utf8",
    )
    const harness = workflow
      .split("- name: Use identical threaded benchmark harnesses")[1]!
      .split("- name: Prepare comparison artifacts")[0]!
    expect(harness).toContain("same-machine-pr/scripts/benchmark")
    expect(harness).toContain("same-machine-base/scripts/benchmark")
    expect(harness).not.toContain("cp -a same-machine-pr/lib")
    expect(workflow).toContain("['threads', '--threads']")
    const controller = readFileSync(
      new URL("../scripts/benchmark/index.ts", import.meta.url),
      "utf8",
    )
    expect(controller).toContain('await import("../build-solver-workers")')
    expect(controller).toContain("threads: options.threads")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
