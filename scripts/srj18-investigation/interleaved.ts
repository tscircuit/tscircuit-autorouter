import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { WorkerResultWithImage, WorkerTaskMessage } from "../benchmark/benchmark-types"

type Label = "A" | "B" | "C"
type Measurement = {
  lane: number
  cpu: number
  sampleNumber: number
  label: Label
  order: number
  result: Omit<WorkerResultWithImage, "benchmarkSnapshot">
}

const base = resolve("../pair-base")
const head = resolve("../pair-head")
const { loadScenarios } = await import(resolve(base, "scripts/benchmark/scenarios.ts"))
const scenarios = await loadScenarios("srj18", {})
const cpuList = readFileSync("/proc/self/status", "utf8").match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1]
if (!cpuList) throw new Error("Missing Linux CPU affinity information")
const cpus: number[] = []
for (const range of cpuList.split(",")) {
  const values = range.split("-").map(Number)
  const start = values[0]!
  const end = values.length === 1 ? start : values[1]!
  for (let cpu = start; cpu <= end; cpu++) cpus.push(cpu)
}
if (cpus.length < 2) throw new Error("Two CPU lanes are required")
const plans: Array<{ sampleNumber: number; labels: Label[] }[]> = [
  [
    { sampleNumber: 4, labels: ["A", "B", "C", "C", "B", "A"] },
    { sampleNumber: 6, labels: ["B", "C", "A", "A", "C", "B"] },
  ],
  [
    { sampleNumber: 8, labels: ["C", "A", "B", "B", "A", "C"] },
    { sampleNumber: 13, labels: ["B", "A", "C", "C", "A", "B"] },
  ],
]
mkdirSync("interleaved-results", { recursive: true })
console.log("INTERLEAVED_CONFIG " + JSON.stringify({ cpus: cpus.slice(0, 2), plans, labels: { A: "base", B: "PR", C: "same base path as A" } }))

const runLane = async (lane: number): Promise<void> => {
  const measurements: Measurement[] = []
  for (const { sampleNumber, labels } of plans[lane]!) {
    const [scenarioName, scenario] = scenarios[sampleNumber - 1]!
    for (let order = 0; order < labels.length; order++) {
      const label = labels[order]!
      const task: WorkerTaskMessage = {
        taskId: lane * 1000 + sampleNumber * 10 + order,
        task: { datasetName: "srj18", solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph", scenarioName, sampleNumber, scenario },
      }
      const stderr = resolve(`interleaved-results/lane-${lane}-sample-${sampleNumber}-${order}.stderr.log`)
      const child = Bun.spawn(["taskset", "-c", String(cpus[lane]), "bun", "scripts/benchmark/benchmark.child.ts"], {
        cwd: label === "B" ? head : base,
        stdin: "pipe",
        stdout: "pipe",
        stderr: Bun.file(stderr),
      })
      const deadline = setTimeout(() => child.kill("SIGKILL"), 240000)
      const stdoutPromise = new Response(child.stdout).text()
      child.stdin.write(JSON.stringify(task) + "\n")
      child.stdin.end()
      const [exitCode, stdout] = await Promise.all([child.exited, stdoutPromise])
      clearTimeout(deadline)
      const messages = stdout.split("\n").filter((line) => line.startsWith('{"taskId":')).map((line) => JSON.parse(line))
      const message = messages.findLast((message) => message.result)
      if (exitCode !== 0 || !message?.result) throw new Error(`Failed isolated solve: lane=${lane} sample=${sampleNumber} order=${order} exit=${exitCode}`)
      const { benchmarkSnapshot, ...result } = message.result as WorkerResultWithImage
      const measurement = { lane, cpu: cpus[lane]!, sampleNumber, label, order, result }
      measurements.push(measurement)
      writeFileSync(`interleaved-results/lane-${lane}.json`, JSON.stringify(measurements, null, 2))
      console.log("INTERLEAVED_RESULT " + JSON.stringify(measurement))
      if (!result.didSolve || !result.relaxedDrcPassed) throw new Error(`Routing outcome failed: ${JSON.stringify(measurement)}`)
    }
  }
}

await Promise.all(plans.map((_, lane) => runLane(lane)))
