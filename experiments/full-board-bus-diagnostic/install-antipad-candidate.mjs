import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { applyViaPourAntipadContract } from "./apply-via-pour-antipad-contract.mjs"

const root = resolve(process.argv[2])
const manifestPath = join(root, "runtime-manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
if (manifest.mainVersion !== "0.0.3198" || !manifest.coreObserver || manifest.coreAntipadCandidate) {
  throw new Error("Expected the fresh, frozen published3198 observation runtime")
}
const core = manifest.packages.find(item => item.name === "@tscircuit/core")
if (core.entry !== manifest.coreObserver.observedEntry) throw new Error("Candidate must use the isolated Core copy")
const source = readFileSync(core.entry, "utf8")
const candidate = applyViaPourAntipadContract(source)
writeFileSync(core.entry, candidate.source)
const originalSha = createHash("sha256").update(readFileSync(manifest.coreObserver.originalEntry)).digest("hex")
if (originalSha !== manifest.coreObserver.originalSha256) throw new Error("Original published Core was changed")
core.entrySha256 = candidate.proof.outputSha256
manifest.experiment = "bus-antipad-candidate"
manifest.coreAntipadCandidate = candidate.proof
manifest.dependencyOverrides = [{
  name: "@tscircuit/core", from: "published0.0.2392", to: "published0.0.2392-with-bus-antipad-candidate-and-observer",
  reason: "Test other-layer pour antipads while preserving physical copper and planar reservations",
}]
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
writeFileSync(join(root, "bus-antipad-candidate-proof.json"), JSON.stringify(candidate.proof, null, 2) + "\n")
const casePath = join(root, "cases", "h616-original.json")
const task = JSON.parse(readFileSync(casePath, "utf8"))
task.experiment = manifest.experiment
task.dependencyOverrides = manifest.dependencyOverrides
task.coreAntipadCandidate = candidate.proof
writeFileSync(casePath, JSON.stringify(task, null, 2) + "\n")
console.log("BUS_ANTIPAD_CANDIDATE_PROVENANCE " + JSON.stringify(candidate.proof))
