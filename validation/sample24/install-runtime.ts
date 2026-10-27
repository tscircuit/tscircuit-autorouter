import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

const root = resolve(import.meta.dir, "../..")
const manifest = JSON.parse(readFileSync(resolve(import.meta.dir, "runtime-source-manifest.json"), "utf8"))
const args = JSON.parse(process.env.BENCHMARK_ARGS_JSON!)
if (JSON.stringify(args) !== JSON.stringify(manifest.requiredBenchmarkArgs)) {
  throw new Error("The reviewed runtime bundle requires the exact sample24 validation arguments")
}
if (Bun.version !== manifest.bunVersion) throw new Error("Reviewed runtime requires Bun1.4.3")
for (const [path, expected] of [["lib", manifest.rootLibTree], ["package.json", manifest.rootPackageBlob]]) {
  const actual = spawnSync("git", ["rev-parse", `HEAD:${path}`], { cwd: root, encoding: "utf8" })
  if (actual.status !== 0 || actual.stdout.trim() !== expected) throw new Error(`Root source mismatch: ${path}`)
}
const archive = resolve(import.meta.dir, "runtime-source-bundle.tar.gz")
if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== manifest.bundleSha256) {
  throw new Error("Reviewed source bundle hash mismatch")
}
const extracted = spawnSync("tar", ["-xzf", archive, "-C", root], { stdio: "inherit" })
if (extracted.status !== 0) throw new Error("Could not extract reviewed source bundle")

const packagePath = resolve(root, "package.json")
const original = readFileSync(packagePath)
const pkg = JSON.parse(original.toString())
const sections = ["dependencies", "devDependencies", "optionalDependencies"]
for (const entry of manifest.packages) {
  const section = sections.find((name) => pkg[name]?.[entry.name] !== undefined)
  if (!section || pkg[section][entry.name] !== entry.declaredPin) throw new Error(`Declared source pin mismatch: ${entry.name}`)
  pkg[section][entry.name] = `file:${entry.bundleRoot}`
}
for (const [name, entry] of Object.entries(manifest.rootTransitives) as [string, { version: string }][]) {
  const section = sections.find((section) => pkg[section]?.[name] !== undefined)
  if (!section) throw new Error(`Root transitive dependency is undeclared: ${name}`)
  pkg[section][name] = entry.version
}
try {
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n")
  const installed = spawnSync("bun", ["install"], { cwd: root, stdio: "inherit" })
  if (installed.status !== 0) throw new Error(`Reviewed file-dependency install failed: ${installed.status}`)
} finally {
  writeFileSync(packagePath, original)
}
const bunfigPath = resolve(root, "bunfig.toml")
const bunfig = readFileSync(bunfigPath, "utf8")
if (bunfig.startsWith("preload =")) throw new Error("An unexpected top-level preload already exists")
writeFileSync(bunfigPath, 'preload = ["./validation/sample24/preload.ts"]\n\n' + bunfig)
