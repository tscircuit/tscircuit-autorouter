import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { WorkerTaskMessage, WorkerResultWithImage } from "../benchmark/benchmark-types"

type Sources = Record<string, Record<string, string>>
const variants: Sources = JSON.parse(readFileSync("source-variants.json", "utf8"))
const labels = ["base", "head", "guard", "lazy", "factory", "control"]
const plans = [[1, 16], [3, 11], [7, 10]]
const { loadScenarios } = await import(resolve("../lane-0/scripts/benchmark/scenarios.ts"))
const scenarios = await loadScenarios("srj18", {})
mkdirSync("ablation-results", { recursive: true })

const runLane = async (lane: number): Promise<void> => {
  const root = resolve(`../lane-${lane}`)
  const records = []
  for (const sample of plans[lane]!) {
    const scenarioIndex = [1, 3, 7, 10, 11, 16].indexOf(sample)
    const rotated = [...labels.slice(scenarioIndex), ...labels.slice(0, scenarioIndex)]
    const order = [...rotated, ...[...rotated].reverse()]
    for (let pass = 0; pass < order.length; pass++) {
      const variant = order[pass]!
      for (const [path, source] of Object.entries(variants[variant]!)) writeFileSync(resolve(root, path), source)
      const [scenarioName, scenario] = scenarios[sample - 1]!
      const task: WorkerTaskMessage = { taskId: sample * 100 + pass, task: { datasetName: "srj18", solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph", scenarioName, sampleNumber: sample, scenario } }
      const started = performance.now()
      const child = Bun.spawn([process.execPath, "scripts/benchmark/benchmark.child.ts"], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: Bun.file(`ablation-results/${lane}-${sample}-${pass}.stderr.log`) })
      const deadline = setTimeout(() => child.kill("SIGKILL"), 240000)
      const outputPromise = new Response(child.stdout).text()
      child.stdin.write(JSON.stringify(task) + "\n")
      child.stdin.end()
      const [exitCode, stdout] = await Promise.all([child.exited, outputPromise])
      clearTimeout(deadline)
      const processWallMs = performance.now() - started
      const messages = stdout.split("\n").filter((line) => line.startsWith('{"taskId":')).map((line) => JSON.parse(line))
      const payload = messages.findLast((message) => message.result)
      if (exitCode !== 0 || !payload?.result) throw new Error(`Ablation process failed: ${sample}/${variant}/${pass}`)
      const { benchmarkSnapshot, ...result } = payload.result as WorkerResultWithImage
      const record = { lane, sample, variant, pass, processWallMs, usage: child.resourceUsage(), result }
      records.push(record)
      writeFileSync(`ablation-results/lane-${lane}.json`, JSON.stringify(records, null, 2))
      console.log("ABLATION_RESULT " + JSON.stringify(record))
      if (!result.didSolve || !result.relaxedDrcPassed) throw new Error(`Ablation routing failure: ${sample}/${variant}`)
    }
  }
}

console.log("ABLATION_CONFIG " + JSON.stringify({ labels, plans, affinity: "unrestricted; three workers as ordinary benchmark", identicalLabels: ["base", "control"], cwd: "fixed per lane across all variants" }))
await Promise.all(plans.map((_, lane) => runLane(lane)))
