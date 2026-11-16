import { createHash } from "node:crypto"
import {
  existsSync, linkSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs"
import { join, relative, resolve } from "node:path"
import { instrumentCore2392, ORIGINAL_CORE_SHA256 } from "./instrument-core2392.mjs"

const root = resolve(process.argv[2])
const manifestPath = join(root, "runtime-manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
if (manifest.mainVersion !== "0.0.3198" || manifest.experiment !== "bus-observer" || manifest.coreObserver) {
  throw new Error("Expected a fresh published3198 bus-observer benchmark runtime")
}
const core = manifest.packages.find(item => item.name === "@tscircuit/core")
if (core?.version !== "0.0.2392" || core.entrySha256 !== ORIGINAL_CORE_SHA256) {
  throw new Error("Expected the frozen published Core2392 entry")
}
const originalFolder = join(root, "npm", "core")
if (resolve(core.entry) !== join(originalFolder, core.entryRelative)) {
  throw new Error("Unexpected original Core package location")
}
const source = readFileSync(core.entry, "utf8")
const diagnostic = instrumentCore2392(source)
const observedFolder = join(root, "npm", "core-bus-observer")
if (existsSync(observedFolder)) throw new Error("Refuse to replace an existing diagnostic package")
mkdirSync(observedFolder)
const copyPackage = folder => {
  for (const item of readdirSync(folder, { withFileTypes: true })) {
    const original = join(folder, item.name)
    const destination = join(observedFolder, relative(originalFolder, original))
    if (item.isDirectory()) {
      mkdirSync(destination)
      copyPackage(original)
    } else if (item.isFile()) {
      if (original === core.entry) writeFileSync(destination, diagnostic.source)
      else linkSync(original, destination)
    } else {
      throw new Error("Unexpected nonregular published Core file")
    }
  }
}
copyPackage(originalFolder)
const originalEntry = core.entry
const observedEntry = join(observedFolder, core.entryRelative)
const alias = join(root, "runtime", "node_modules", "@tscircuit", "core")
if (realpathSync(alias) !== originalFolder) throw new Error("Unexpected Core runtime alias")
unlinkSync(alias)
symlinkSync(observedFolder, alias)
if (createHash("sha256").update(readFileSync(originalEntry)).digest("hex") !== ORIGINAL_CORE_SHA256) {
  throw new Error("Published Core bytes changed during diagnostic preparation")
}
core.entry = observedEntry
core.entrySha256 = diagnostic.proof.instrumentedSha256
manifest.sourceOverrides = true
manifest.coreObserver = { ...diagnostic.proof, originalEntry, observedEntry }
manifest.dependencyOverrides = [{
  name: "@tscircuit/core", from: "published0.0.2392", to: "published0.0.2392-with-observer",
  reason: "Observe existing bus decisions without changing predicates, routing options or native budgets",
}]
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
writeFileSync(join(root, "bus-observer-proof.json"), JSON.stringify(manifest.coreObserver, null, 2) + "\n")
for (const filename of readdirSync(join(root, "cases")).filter(name => /^(h616)-(original|spaced)\.json$/.test(name))) {
  const path = join(root, "cases", filename)
  const task = JSON.parse(readFileSync(path, "utf8"))
  task.dependencyOverrides = manifest.dependencyOverrides
  task.coreObserver = manifest.coreObserver
  writeFileSync(path, JSON.stringify(task, null, 2) + "\n")
}
console.log("BUS_OBSERVER_PROVENANCE " + JSON.stringify(manifest.coreObserver))
