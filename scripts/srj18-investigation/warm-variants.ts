import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const variants: Record<string, Record<string, string>> = JSON.parse(readFileSync("source-variants.json", "utf8"))
const plans = [[1, 16], [3, 11], [7, 10]]
const { loadScenarios } = await import(resolve("../warm-0/scripts/benchmark/scenarios.ts"))
const scenarios = await loadScenarios("srj18", {})
mkdirSync("warm-results", { recursive: true })
const runLane = async (lane: number): Promise<void> => {
  const root = resolve(`../warm-${lane}`)
  const records = []
  for (const sample of plans[lane]!) {
    const order = sample % 2 ? ["base", "head", "control"] : ["control", "head", "base"]
    for (const variant of order) {
      for (const mode of ["default", "no-ftl"]) {
        for (const [path, source] of Object.entries(variants[variant]!)) writeFileSync(resolve(root, path), source)
        const env = { ...process.env, BUN_JSC_reportTotalCompileTimes: "1" }
        if (mode === "no-ftl") env.BUN_JSC_useFTLJIT = "0"
        const stderr = resolve(`warm-results/${lane}-${sample}-${variant}-${mode}.stderr.log`)
        const child = Bun.spawn([process.execPath, "scripts/srj18-investigation/warm.child.ts"], { cwd: root, env, stdin: "pipe", stdout: "pipe", stderr: Bun.file(stderr) })
        const timeout = setTimeout(() => child.kill("SIGKILL"), 360000)
        const output = new Response(child.stdout).text()
        const [scenarioName, scenario] = scenarios[sample - 1]!
        child.stdin.write(JSON.stringify({ taskId: sample, task: { datasetName: "srj18", solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph", scenarioName, sampleNumber: sample, scenario } }) + "\n")
        child.stdin.end()
        const [code, stdout] = await Promise.all([child.exited, output])
        clearTimeout(timeout)
        if (code !== 0) throw new Error(`Warm process failed: ${sample}/${variant}/${mode}: ${readFileSync(stderr, "utf8").slice(-3000)}`)
        const measurements = stdout.split("\n").filter((line) => line.startsWith("WARM_MEASUREMENT ")).map((line) => JSON.parse(line.slice("WARM_MEASUREMENT ".length)))
        if (measurements.length !== 2) throw new Error("Expected cold and warm measurements")
        const record = { lane, sample, variant, mode, measurements }
        records.push(record)
        writeFileSync(`warm-results/lane-${lane}.json`, JSON.stringify(records, null, 2))
        console.log("WARM_RESULT " + JSON.stringify(record))
      }
    }
  }
}
await Promise.all(plans.map((_, lane) => runLane(lane)))
