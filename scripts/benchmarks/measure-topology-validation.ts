import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { createDisjointTopologyValidationInput } from "../../tests/fixtures/createDisjointTopologyValidationInput"
const repository = resolve(Bun.argv[2] ?? ".")
const destination = Bun.argv[3]!
const count = Number(Bun.argv[4] ?? 4096)
const modulePath = resolve(repository, "lib/solvers/TopologyMergingSolver/topology-merging-output.ts")
const { validateTopologyMergingOutput } = await import(pathToFileURL(modulePath).href)
const { input } = createDisjointTopologyValidationInput(count, false)
const original = JSON.stringify(input.nodes)
const times: number[] = []
for (let trial = 0; trial < 4; trial++) {
  const started = performance.now()
  validateTopologyMergingOutput(input)
  if (trial) times.push(performance.now() - started)
}
const tracked = createDisjointTopologyValidationInput(count)
validateTopologyMergingOutput(tracked.input)
if (JSON.stringify(input.nodes) !== original) throw new Error("Validator mutated native nodes")
times.sort((a, b) => a - b)
const report = { scope: "Generated native disjoint topology validation; timings use ordinary nodes, geometry reads are a separate instrumented run", count, validated: true, runtime: Bun.version, sourceSha256: createHash("sha256").update(readFileSync(modulePath)).digest("hex"), inputSha256: createHash("sha256").update(original).digest("hex"), outputUnchanged: true, geometryReads: tracked.geometryReads.count, medianMs: times[1], trialsMs: times, rssAfterBytes: process.memoryUsage().rss }
await Bun.write(destination, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report))
