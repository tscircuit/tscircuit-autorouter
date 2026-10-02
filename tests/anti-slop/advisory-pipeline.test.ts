import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { repoRoot } from "./cli-helpers"

test("the CI bash pipeline retains diagnostic and setup failure exit codes while saving JSON", () => {
  const directory = mkdtempSync(join(repoRoot, "lib/anti-slop-pipeline-"))
  try {
    const source = join(directory, "bad.ts")
    const artifact = join(directory, "diagnostics.json")
    writeFileSync(source, "const bad = { x: 1 } as unknown as { x: string }\n")
    const lint = spawnSync(
      "bash",
      [
        "--noprofile",
        "--norc",
        "-e",
        "-o",
        "pipefail",
        "-c",
        'bun --bun oxlint --config "$1" "$2" --format json | tee "$3"',
        "anti-slop-ci",
        "oxlint.anti-slop.config.ts",
        source,
        artifact,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    )
    expect(lint.status).toBe(1)
    const report = JSON.parse(readFileSync(artifact, "utf8"))
    expect(report.number_of_rules).toBe(24)
    expect(
      report.diagnostics.some(
        (diagnostic: { code: string }): boolean =>
          diagnostic.code === "anti-slop(no-chained-type-assertions)",
      ),
    ).toBe(true)

    const missingConfig = spawnSync(
      "bash",
      [
        "--noprofile",
        "--norc",
        "-e",
        "-o",
        "pipefail",
        "-c",
        'bun --bun oxlint --config "$1" "$2" --format json | tee "$3"',
        "anti-slop-ci",
        join(directory, "does-not-exist.ts"),
        source,
        artifact,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    )
    expect(missingConfig.status).toBe(1)
    expect(missingConfig.stdout + missingConfig.stderr).toContain(
      "does-not-exist",
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
