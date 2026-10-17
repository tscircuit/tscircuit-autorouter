import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

// Pass `node dist/proof.js` to compare a compiled Node runner, or use Bun source by default.
const executable = process.argv[2] ?? process.execPath
const entry = process.argv[3] ?? new URL("./pipeline9-parallel-proof.ts", import.meta.url).pathname
const trials = Number(process.argv[4] ?? 3)
const outputDir = resolve(process.argv[5] ?? "/tmp/pipeline9-parallel-comparison")
if (!Number.isSafeInteger(trials) || trials < 1) throw new Error("trials must be a positive integer")
mkdirSync(outputDir, { recursive: true })
const results: Record<string, any>[] = []
let expected: string | undefined
for (let trial = 1; trial <= trials; trial++) {
  for (const [mode, threads] of [["baseline", 0], ["parallel", 1], ["parallel", 2], ["parallel", 4]] as const) {
    const directory = `${outputDir}/trial-${trial}/${mode}-${threads}`
    const child = spawnSync(executable, [entry, mode, String(threads), directory], { encoding: "utf8" })
    if (child.status !== 0) throw new Error(`${child.error ?? child.stderr}\n${child.stdout}`)
    const record = JSON.parse(readFileSync(`${directory}/${mode}-timings.json`, "utf8"))
    const output = readFileSync(`${directory}/${mode}.json`, "utf8")
    expected ??= output
    if (output !== expected) throw new Error(`Output changed for ${mode}, threads=${threads}, trial=${trial}`)
    results.push({ ...record, trial })
    writeFileSync(`${outputDir}/results.json`, JSON.stringify(results, null, 2))
    console.log(JSON.stringify({ trial, mode, threads, totalMs: record.elapsedMs, highDensityMs: record.phases.highDensityRouteSolver, hash: record.hash }))
  }
}
