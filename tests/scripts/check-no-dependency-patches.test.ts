import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { findDependencyPatchChanges } from "../../scripts/check-no-dependency-patches"

test("rejects new and modified dependency patches while allowing upstream updates and removals", () => {
  const directory = mkdtempSync(join(tmpdir(), "dependency-patches-"))
  const previousDirectory = process.cwd()
  const git = (args: string[]): string => {
    const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" })
    if (result.status !== 0) {
      throw new Error(result.stderr || `git ${args[0]} failed`)
    }
    return result.stdout.trim()
  }
  const write = (file: string, contents: string): void => {
    const path = join(directory, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)
  }
  const commit = (): string => {
    git(["add", "."])
    git([
      "-c",
      "user.name=CI Test",
      "-c",
      "user.email=ci@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "fixture",
    ])
    return git(["rev-parse", "HEAD"])
  }
  try {
    git(["init", "--quiet"])
    write(
      "package.json",
      JSON.stringify({
        dependencies: { example: "1.0.0" },
        patchedDependencies: { "legacy@1.0.0": "patches/legacy.patch" },
      }),
    )
    write("patches/legacy.patch", "existing patch")
    const base = commit()
    process.chdir(directory)

    write(
      "package.json",
      JSON.stringify({
        dependencies: { example: "github:owner/example#abcdef123456" },
        patchedDependencies: { "legacy@1.0.0": "patches/legacy.patch" },
      }),
    )
    expect(findDependencyPatchChanges(base, commit())).toEqual([])

    write("patches/legacy.patch", "modified existing patch")
    write("patches/new.txt", "patch without a .patch extension")
    write("custom/example.patch", "patch outside the patches directory")
    write(".yarn/patches/example.patch", "yarn patch")
    write(
      "packages/example/package.json",
      JSON.stringify({
        patchedDependencies: { "example@1.0.0": "custom/example.patch" },
        pnpm: {
          patchedDependencies: { "example@1.0.0": "custom/example.patch" },
        },
      }),
    )
    write(
      "package.json",
      JSON.stringify({
        patchedDependencies: { "legacy@1.0.0": "custom/example.patch" },
      }),
    )
    const patched = commit()
    const findings = findDependencyPatchChanges(base, patched)
    expect(findings).toHaveLength(7)
    expect(findings).toContain(
      "patches/legacy.patch: added or modified patch file",
    )
    expect(findings).toContain("patches/new.txt: added or modified patch file")
    expect(findings).toContain(
      "custom/example.patch: added or modified patch file",
    )
    expect(findings).toContain(
      ".yarn/patches/example.patch: added or modified patch file",
    )
    expect(findings).toContain(
      "package.json: patchedDependencies[legacy@1.0.0] was added or changed",
    )
    expect(findings).toContain(
      "packages/example/package.json: patchedDependencies[example@1.0.0] was added or changed",
    )
    expect(findings).toContain(
      "packages/example/package.json: pnpm.patchedDependencies[example@1.0.0] was added or changed",
    )

    git(["mv", "patches/legacy.patch", "patches/renamed.patch"])
    expect(findDependencyPatchChanges(patched, commit())).toEqual([
      "patches/renamed.patch: added or modified patch file",
    ])

    git(["rm", "-r", "patches", "custom", ".yarn", "packages"])
    write(
      "package.json",
      JSON.stringify({ dependencies: { example: "1.1.0" } }),
    )
    const cleaned = commit()
    expect(findDependencyPatchChanges(base, cleaned)).toEqual([])
    expect(findDependencyPatchChanges("0".repeat(40), cleaned)).toEqual([])
    expect(() => findDependencyPatchChanges("invalid-ref", cleaned)).toThrow()
  } finally {
    process.chdir(previousDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
})
