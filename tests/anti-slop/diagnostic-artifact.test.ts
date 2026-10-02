import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { repoRoot } from "./cli-helpers"

test("large redirected CI reports retain every diagnostic, parse completely and produce checked counts", () => {
  const directory = mkdtempSync(join(repoRoot, "lib/anti-slop-artifact-"))
  try {
    const source = join(directory, "bad.ts")
    const artifact = join(directory, "diagnostics.json")
    const summaryPath = join(directory, "summary.json")
    writeFileSync(
      source,
      Array.from(
        { length: 1000 },
        (_, index): string => `const value${index} = 1 as number\n`,
      ).join("\n"),
    )
    const lint = spawnSync(
      "bash",
      [
        "--noprofile",
        "--norc",
        "-e",
        "-o",
        "pipefail",
        "-c",
        'bun --bun oxlint --config "$1" "$2" --format json > "$3"',
        "anti-slop-ci",
        "oxlint.anti-slop.config.ts",
        source,
        artifact,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    )
    expect(lint.status).toBe(1)
    expect(statSync(artifact).size).toBeGreaterThan(65_536)
    const report = JSON.parse(readFileSync(artifact, "utf8"))
    expect(report.number_of_rules).toBe(24)
    expect(report.number_of_files).toBe(1)
    expect(report.diagnostics.length).toBe(1000)
    const summarized = spawnSync(
      "bun",
      ["scripts/summarize-anti-slop-diagnostics.ts", artifact, summaryPath],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
      },
    )
    expect(summarized.status).toBe(0)
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"))
    expect(summary).toEqual({
      files: 1,
      rules: 24,
      errors: 1000,
      countsByRule: {
        "anti-slop(require-safety-comment-for-type-assertion)": 1000,
      },
    })
    writeFileSync(artifact, '{ "diagnostics": [')
    const truncated = spawnSync(
      "bun",
      ["scripts/summarize-anti-slop-diagnostics.ts", artifact, summaryPath],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
      },
    )
    expect(truncated.status).toBe(1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
