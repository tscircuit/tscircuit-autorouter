import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { TopologyMergingSolver } from "../../lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createStripedTopologyMergeInput } from "../../tests/fixtures/createStripedTopologyMergeInput"

const repository = resolve(Bun.argv[2] ?? ".")
const destination = Bun.argv[3] ?? "topology-streaming-report.json"
const count = Number(Bun.argv[4] ?? 160)
if (!Number.isSafeInteger(count) || count < 1) {
  throw new Error("Synthetic row count must be a positive integer")
}
const caseName = `synthetic-striped-${count}`
const modulePath = resolve(repository, "lib/solvers/TopologyMergingSolver/TopologyMergingSolver.ts")
const module = await import(pathToFileURL(modulePath).href)
const bytes = Buffer.from(JSON.stringify(createStripedTopologyMergeInput(count)))
const input = JSON.parse(bytes.toString("utf8"))
const started = performance.now()
const solver: TopologyMergingSolver = new module.TopologyMergingSolver(input)
let peakRetainedRegions = 0
let peakRss = process.memoryUsage().rss
let lastProgress = 0
let stopReason: string | null = null
while (!solver.solved && !solver.failed) {
  peakRss = Math.max(peakRss, process.memoryUsage().rss)
  if (peakRss > 8 * 1024 ** 3) {
    stopReason = "Controlled 8 GiB RSS budget; not natural infeasibility"
    break
  }
  if (performance.now() - started > 1_800_000) {
    stopReason = "Controlled 1800 second budget; not natural infeasibility"
    break
  }
  solver.step()
  peakRetainedRegions = Math.max(peakRetainedRegions,
    (solver as unknown as { atomicRegions: unknown[] }).atomicRegions.length)
  if (performance.now() - lastProgress > 15_000) {
    lastProgress = performance.now()
    console.log(JSON.stringify({ caseName, seconds: (lastProgress - started) / 1000,
      iterations: solver.iterations, peakRetainedRegions, peakRss }))
  }
}
const output = solver.solved ? solver.getOutput() : null
let outputSha256: string | null = null
if (output) {
  const hash = createHash("sha256")
  hash.update("[")
  for (let i = 0; i < output.length; i++) {
    if (i > 0) hash.update(",")
    hash.update(JSON.stringify(output[i]))
  }
  hash.update("]")
  outputSha256 = hash.digest("hex")
}
const report = {
  caseName, runtime: Bun.version,
  revision: Bun.spawnSync(["git", "-C", repository, "rev-parse", "HEAD"]).stdout.toString().trim(),
  sourceSha256: createHash("sha256").update(readFileSync(modulePath)).digest("hex"),
  inputSha256: createHash("sha256").update(bytes).digest("hex"),
  inputNodes: input.nodeGroups.reduce((count: number, group: { nodes: unknown[] }) => count + group.nodes.length, 0),
  seconds: (performance.now() - started) / 1000,
  solved: solver.solved, failed: solver.failed, error: solver.error,
  stopReason, peakRetainedRegions, peakRss,
  outputNodes: output?.length ?? 0, outputSha256, stats: solver.stats,
}
await Bun.write(destination, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
