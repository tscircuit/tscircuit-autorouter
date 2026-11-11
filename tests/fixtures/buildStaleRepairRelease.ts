import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { getDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"

type BuiltRepair = typeof import("high-density-repair03/lib") & {
  ConnectivityMap: typeof ConnectivityMap
  getDrcSnapshot: typeof getDrcSnapshot
}

const STALE_REPAIR_DEPENDENCY =
  "https://codeload.github.com/tscircuit/high-density-repair03/tar.gz/b90dd442b1260304cc61d162ad53692ceef482e8"

const runReleaseCommand = async (
  directory: string,
  args: string[],
): Promise<void> => {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0)
    throw new Error(
      `Release command failed: ${args.join(" ")}\n${stdout}\n${stderr}`,
    )
}

/** Reproduce pver syncing a dependency update after the first install. */
export const buildStaleRepairRelease = async (): Promise<BuiltRepair> => {
  const repository = new URL("../../", import.meta.url)
  const manifest = JSON.parse(
    await readFile(new URL("package.json", repository), "utf8"),
  ) as {
    version: string
    scripts: { prepublishOnly: string }
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }
  const directory = await mkdtemp(join(tmpdir(), "autorouter-release-"))
  const fixture = {
    name: "autorouter-release-fixture",
    private: true,
    type: "module",
    version: manifest.version,
    scripts: {
      build: "bun build entry.ts --target=bun --outfile=dist/index.js",
      prepublishOnly: manifest.scripts.prepublishOnly,
    },
    dependencies: {
      "high-density-repair03": STALE_REPAIR_DEPENDENCY,
      "@tscircuit/solver-utils":
        manifest.dependencies["@tscircuit/solver-utils"],
      rbush: manifest.devDependencies.rbush,
    },
  }
  try {
    await mkdir(join(directory, "scripts"))
    await copyFile(
      new URL("scripts/check-published-autorouter-version.ts", repository),
      join(directory, "scripts/check-published-autorouter-version.ts"),
    )
    await writeFile(
      join(directory, "bunfig.toml"),
      "[install.lockfile]\nsave = false\n",
    )
    await writeFile(
      join(directory, "entry.ts"),
      `export * from "high-density-repair03/lib"
export { getDrcSnapshot } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
export { ConnectivityMap } from "circuit-json-to-connectivity-map"
import manifest from "./package.json"
export const AUTOROUTER_VERSION = manifest.version
`,
    )
    const packagePath = join(directory, "package.json")
    await writeFile(packagePath, JSON.stringify(fixture))
    await runReleaseCommand(directory, ["install", "--ignore-scripts"])
    fixture.dependencies["high-density-repair03"] =
      manifest.devDependencies["high-density-repair03"]
    await writeFile(packagePath, JSON.stringify(fixture))
    await runReleaseCommand(directory, ["run", "prepublishOnly"])
    return (await import(
      pathToFileURL(join(directory, "dist/index.js")).href
    )) as BuiltRepair
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
