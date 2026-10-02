import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

export type LintDiagnostic = {
  code: string
  severity: string
  filename: string
}

export type LintResult = {
  diagnostics: LintDiagnostic[]
  number_of_files: number
  number_of_rules: number
}

export const repoRoot = resolve(import.meta.dir, "../..")

export function runLint(
  args: string[],
  config = "oxlint.anti-slop.config.ts",
): ReturnType<typeof spawnSync> {
  return spawnSync(
    process.execPath,
    ["--bun", "oxlint", "--threads", "1", "--config", config, ...args],
    { cwd: repoRoot, encoding: "utf8" },
  )
}

export function readLintResult(
  args: string[],
  expectedExitCode = 0,
): LintResult {
  const result = runLint(["--format", "json", ...args])
  if (result.status !== expectedExitCode || result.error) {
    throw new Error(
      `Oxlint failed (${result.status}): ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`,
    )
  }
  return JSON.parse(String(result.stdout)) as LintResult
}
