import { createHash } from "node:crypto"
import { readFileSync, writeFileSync, unlinkSync, realpathSync, existsSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { totalmem } from "node:os"

const root = resolve(import.meta.dir, "../..")
const manifest = JSON.parse(readFileSync(resolve(import.meta.dir, "runtime-source-manifest.json"), "utf8"))
const hash = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex")
const packageRoot = (entry: string, name: string): string => {
  let candidate = dirname(entry)
  while (candidate !== dirname(candidate)) {
    const file = join(candidate, "package.json")
    if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).name === name) return candidate
    candidate = dirname(candidate)
  }
  throw new Error(`Resolved package root was not found: ${name}`)
}
if (Bun.version !== manifest.bunVersion) throw new Error("Bun version mismatch")
const packages: { name: string; specifier: string; entry: string; root: string; files: number }[] = []
for (const pkg of manifest.packages) {
  const entry = realpathSync(Bun.resolveSync(pkg.entrySpecifier, root))
  const installedRoot = packageRoot(entry, pkg.name)
  for (const file of pkg.runtimeFiles) {
    if (hash(join(installedRoot, file.path)) !== file.sha256) throw new Error(`Installed source mismatch: ${pkg.name}/${file.path}`)
    if (hash(resolve(root, pkg.bundleRoot, file.path)) !== file.sha256) throw new Error(`Bundle source mismatch: ${pkg.name}/${file.path}`)
  }
  packages.push({ name: pkg.name, specifier: pkg.entrySpecifier, entry, root: installedRoot, files: pkg.runtimeFiles.length })
}
const transitiveVersions: Record<string, { version: string; entry: string; sha256: string }> = {}
for (const [name, expected] of Object.entries(manifest.rootTransitives) as [string, { version: string; entrySha256: string }][]) {
  const entry = Bun.resolveSync(name, root)
  const pkg = JSON.parse(readFileSync(join(packageRoot(entry, name), "package.json"), "utf8"))
  if (pkg.version !== expected.version || hash(entry) !== expected.entrySha256) throw new Error(`Root dependency mismatch: ${name}`)
  transitiveVersions[name] = { version: pkg.version, entry, sha256: hash(entry) }
}
const simplifier = packages.find((pkg) => pkg.name === "@tscircuit/trace-simplification-solver")!
const nestedEntry = Bun.resolveSync("circuit-json-to-connectivity-map", simplifier.root)
const nestedPkg = JSON.parse(readFileSync(join(packageRoot(nestedEntry, "circuit-json-to-connectivity-map"), "package.json"), "utf8"))
if (nestedPkg.version !== manifest.simplifierNestedConnectivityVersion) throw new Error("Simplifier nested connectivity version mismatch")
if (hash(nestedEntry) !== manifest.simplifierNestedConnectivityEntrySha256) throw new Error("Simplifier nested connectivity source mismatch")
const nestedProbe = join(simplifier.root, ".sample24-connectivity-import-proof.ts")
let actualNestedConnectivityEntry: string
try {
  writeFileSync(nestedProbe, 'import * as connectivity from "circuit-json-to-connectivity-map"; export { connectivity }; export const entry = import.meta.resolve("circuit-json-to-connectivity-map")\n')
  const imported = await import(nestedProbe)
  actualNestedConnectivityEntry = realpathSync(new URL(imported.entry))
  if (actualNestedConnectivityEntry !== realpathSync(nestedEntry) || Object.keys(imported.connectivity).length === 0) throw new Error("Actual Simplifier nested connectivity import differs")
} finally {
  unlinkSync(nestedProbe)
}

const expectedNamespaces = await Promise.all(packages.map((pkg) => import(pkg.specifier)))
const probeSource = packages.map((pkg, index) => `import * as p${index} from ${JSON.stringify(pkg.specifier)}`).join("\n") + `\nexport default [${packages.map((_, index) => `p${index}`).join(",")}]\n`
let actualImportCount = 0
for (const context of packages) {
  for (const pkg of packages) {
    if (realpathSync(Bun.resolveSync(pkg.specifier, context.root)) !== pkg.entry) throw new Error(`Physical nested resolution mismatch: ${context.name} -> ${pkg.specifier}`)
  }
  const probe = join(context.root, ".sample24-runtime-import-proof.ts")
  try {
    writeFileSync(probe, probeSource)
    const imported = (await import(probe)).default
    imported.forEach((namespace: unknown, index: number): void => {
      if (namespace !== expectedNamespaces[index]) throw new Error(`Actual nested import mismatch: ${context.name} -> ${packages[index]!.name}`)
      actualImportCount += 1
    })
  } finally {
    unlinkSync(probe)
  }
}
const cgroupLimitPaths = ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]
const cgroupLimitPath = cgroupLimitPaths.find((path) => existsSync(path))
const report = {
  ready: true,
  kind: "REVIEWED_SAMPLE24_BLACKSMITH_RUNTIME",
  rootSource: manifest.rootSource,
  rootLibTree: manifest.rootLibTree,
  localRuntimeReceiptSha256: manifest.localRuntimeReceiptSha256,
  manifestSha256: hash(resolve(import.meta.dir, "runtime-source-manifest.json")),
  bundleSha256: manifest.bundleSha256,
  bunVersion: Bun.version,
  runtimeSourceFiles: packages.reduce((count, pkg) => count + pkg.files, 0),
  physicalNestedResolutions: 25,
  actualNestedImports: actualImportCount,
  packages,
  transitiveVersions,
  simplifierNestedConnectivity: { version: nestedPkg.version, entry: nestedEntry, sha256: hash(nestedEntry), actualImportEntry: actualNestedConnectivityEntry },
  preloadResolutions: (globalThis as any).__sample24RuntimeResolutions,
  resources: {
    totalMemoryBytes: totalmem(),
    cgroupMemoryLimit: cgroupLimitPath
      ? { path: cgroupLimitPath, value: readFileSync(cgroupLimitPath, "utf8").trim() }
      : { path: null, value: null, observation: "This host does not expose a cgroup memory limit" },
  },
  boardSolved: false,
}
if (report.runtimeSourceFiles !== 216 || actualImportCount !== 25 || !Array.isArray(report.preloadResolutions)) throw new Error("Runtime source/import proof incomplete")
writeFileSync(resolve(import.meta.dir, "runtime-verification.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ ready: true, runtimeSourceFiles: 216, actualNestedImports: 25, totalMemoryBytes: totalmem() }))
