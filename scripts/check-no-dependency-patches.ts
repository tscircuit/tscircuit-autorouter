import { spawnSync } from "node:child_process"

type PackageManifest = {
  patchedDependencies?: Record<string, unknown>
  pnpm?: { patchedDependencies?: Record<string, unknown> }
}

const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
const POLICY_MESSAGE =
  "You can't patch dependencies, create a PR to update the dependency then update the package.json with the new version when released (or the git commit hash if applicable)"

const git = (args: string[]): string => {
  const result = spawnSync("git", args, { encoding: "utf8" })
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args[0]} failed`)
  }
  return result.stdout
}

export const findDependencyPatchChanges = (
  rawBaseSha: string,
  headSha: string,
): string[] => {
  const baseSha = /^0+$/.test(rawBaseSha) ? EMPTY_TREE_SHA : rawBaseSha
  // Disable rename detection so moving a patch cannot bypass the policy.
  // Deletions are allowed, as are existing patches that remain unchanged.
  const changedFiles = git([
    "diff", "--no-ext-diff", "--no-renames", "--name-only",
    "--diff-filter=ACMT", "-z", baseSha, headSha, "--",
  ]).split("\0").filter(Boolean)
  const baseFiles = new Set(
    git(["ls-tree", "-r", "--name-only", "-z", baseSha])
      .split("\0").filter(Boolean),
  )
  const findings: string[] = []

  for (const file of changedFiles) {
    if (/\.patch$/i.test(file) || /(^|\/)(patches|\.yarn\/patches)\//.test(file)) {
      findings.push(`${file}: added or modified patch file`)
    }
    if (!/(^|\/)package\.json$/.test(file)) continue

    const head: PackageManifest = JSON.parse(git(["show", `${headSha}:${file}`]))
    const base: PackageManifest = baseFiles.has(file)
      ? JSON.parse(git(["show", `${baseSha}:${file}`]))
      : {}
    const patchMaps = [
      ["patchedDependencies", base.patchedDependencies, head.patchedDependencies],
      ["pnpm.patchedDependencies", base.pnpm?.patchedDependencies, head.pnpm?.patchedDependencies],
    ] as const
    for (const [field, before, after] of patchMaps) {
      if (!after) continue
      for (const [dependency, patch] of Object.entries(after)) {
        if (
          !before || !Object.hasOwn(before, dependency) ||
          JSON.stringify(before[dependency]) !== JSON.stringify(patch)
        ) {
          findings.push(`${file}: ${field}[${dependency}] was added or changed`)
        }
      }
    }
  }
  return findings
}

const main = (): void => {
  const [baseSha, headSha] = process.argv.slice(2)
  if (!baseSha || !headSha) {
    throw new Error(
      "Usage: bun scripts/check-no-dependency-patches.ts <base-sha> <head-sha>",
    )
  }
  const findings = findDependencyPatchChanges(baseSha, headSha)
  if (findings.length > 0) {
    console.error(`::error title=Dependency patches are not allowed::${POLICY_MESSAGE}`)
    for (const finding of findings) console.error(finding)
    process.exit(1)
  }
  console.log("No new or modified dependency patches found.")
}

if (import.meta.main) main()
