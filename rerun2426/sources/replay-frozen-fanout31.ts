import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { runSampleProcess } from "./benchmarks/run-sample-process"
import type { BenchmarkSample, BenchmarkRow } from "./benchmarks/benchmark-types"

const [inputDirectory, outputDirectory, concurrencyText = "16", sampleFilter] = process.argv.slice(2)
const files = (await readdir(inputDirectory)).filter(name => name.endsWith(".json")).sort()
if (files.length !== 72) throw new Error(`Expected all 72 frozen inputs, received ${files.length}`)
const samples: BenchmarkSample[] = []
for (const file of files) {
  const captured = JSON.parse(await readFile(join(inputDirectory, file), "utf8"))
  if (sampleFilter && !sampleFilter.split(",").some(prefix => captured.id.startsWith(prefix))) continue
  samples.push({ dataset: "dataset31", id: captured.id, simpleRouteJson: captured.simpleRouteJson, solverOptions: captured.solverOptions })
}
const configuration = { concurrency: Number(concurrencyText), sampleTimeoutSeconds: 120 }
const startedAt = performance.now()
const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim()
const rows = new Map<number, BenchmarkRow>()
await mkdir(outputDirectory, { recursive: true })
let nextIndex = 0
await Promise.all(Array.from({length: Math.min(configuration.concurrency, samples.length)}, async () => {
  while(nextIndex < samples.length) {
    const index = nextIndex++
    const sample = samples[index]!
    const {svg, ...row} = await runSampleProcess(sample, configuration)
    if (row.status === "solved") {
      if (!svg) throw new Error(`Missing solved SVG for ${sample.id}`)
      await writeFile(join(outputDirectory, `${sample.id}.svg`), svg)
    }
    rows.set(index, row)
    console.log("FROZEN_FANOUT31_CASE", JSON.stringify(row))
  }
}))
const report = {
  version: 2, dataset: "dataset31",
  datasetSource: { repository: "https://github.com/tscircuit/dataset-fanout31-am62l", commit: "8eabec2516c5066d43ec7672511a1134430c5d45" },
  generatedAt: new Date().toISOString(), commit, configuration,
  wallClockMilliseconds: Math.round(performance.now() - startedAt),
  totalSamples: samples.length,
  rows: [...rows.entries()].sort(([a],[b])=>a-b).map(([,row])=>row),
}
await writeFile(join(outputDirectory,"benchmark.json"),JSON.stringify(report,null,2))
console.log("FROZEN_FANOUT31_REPORT",JSON.stringify(report))
