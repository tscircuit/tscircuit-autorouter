import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { readLintResult, repoRoot, runLint } from "./cli-helpers"

test("config ignores generated tooling, limits policy to lib and surfaces setup failures", () => {
  const directory = mkdtempSync(join(repoRoot, "tools/anti-slop-integration-"))
  const fixtureDirectory = mkdtempSync(
    join(repoRoot, "fixtures/anti-slop-integration-"),
  )
  const outsideDirectory = mkdtempSync(join(repoRoot, "anti-slop-outside-"))
  mkdirSync(join(repoRoot, "dist"), { recursive: true })
  const distDirectory = mkdtempSync(
    join(repoRoot, "dist/anti-slop-integration-"),
  )
  try {
    const badSource = "const bad = 1 as unknown as string\n"
    for (const target of [directory, fixtureDirectory, distDirectory]) {
      writeFileSync(join(target, "bad.ts"), badSource)
    }
    const ignored = readLintResult([
      "lib/index.ts",
      directory,
      fixtureDirectory,
      distDirectory,
    ])
    expect(ignored.diagnostics).toEqual([])
    expect(ignored.number_of_files).toBe(1)

    // Existing non-lib source is outside this policy, even with an explicit path.
    writeFileSync(join(outsideDirectory, "bad.ts"), badSource)
    const outsideLib = readLintResult([outsideDirectory])
    expect(outsideLib.diagnostics).toEqual([])
    expect(outsideLib.number_of_files).toBe(1)

    const missingConfig = runLint(
      ["lib/index.ts"],
      join(directory, "missing.config.ts"),
    )
    expect(missingConfig.status).not.toBe(0)
    expect(`${missingConfig.stdout}\n${missingConfig.stderr}`).toContain(
      "missing.config.ts",
    )

    writeFileSync(
      join(directory, "broken.config.ts"),
      'export default { jsPlugins: ["./missing-plugin.ts"] }\n',
    )
    const missingPlugin = runLint(
      ["lib/index.ts"],
      join(directory, "broken.config.ts"),
    )
    expect(missingPlugin.status).not.toBe(0)
    expect(`${missingPlugin.stdout}\n${missingPlugin.stderr}`).toContain(
      "missing-plugin.ts",
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
    rmSync(fixtureDirectory, { recursive: true, force: true })
    rmSync(outsideDirectory, { recursive: true, force: true })
    rmSync(distDirectory, { recursive: true, force: true })
  }
})
