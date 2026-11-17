import * as readline from "node:readline"
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import * as jsc from "bun:jsc"
import { createSolverForTask, solveWithProgress } from "../benchmark/benchmark-run-task"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"

type Snapshot = { wall: number; cpu: NodeJS.CpuUsage; usage: NodeJS.ResourceUsage; heap: number; compile: number | null; timers: number; timerWaitMs: number }
let timers = 0
let timerWaitMs = 0
const nativeTimeout = globalThis.setTimeout
globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]): ReturnType<typeof setTimeout> => {
  if (delay !== 0) return nativeTimeout(callback, delay, ...args)
  timers++
  const start = performance.now()
  return nativeTimeout(() => {
    timerWaitMs += performance.now() - start
    callback(...args)
  }, delay)
}) as typeof setTimeout

const snapshot = (): Snapshot => {
  const compile = typeof jsc.totalCompileTime === "function" ? jsc.totalCompileTime() : null
  return { wall: performance.now(), cpu: process.cpuUsage(), usage: process.resourceUsage(), heap: jsc.heapSize(), compile, timers, timerWaitMs }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of lines) {
  if (!line.trim()) continue
  const { taskId, task } = JSON.parse(line)
  const solver: any = createSolverForTask(task)
  const starts = new Map<string, Snapshot>()
  const phases: any[] = []
  solver.pipelineDef = solver.pipelineDef.map((definition: any) => ({
    ...definition,
    getConstructorParams(instance: any): readonly unknown[] {
      starts.set(definition.solverName, snapshot())
      return definition.getConstructorParams(instance)
    },
    onSolved(instance: any): void {
      const end = snapshot()
      const start = starts.get(definition.solverName)!
      phases.push({ name: definition.solverName, wallMs: end.wall - start.wall, cpu: { user: end.cpu.user - start.cpu.user, system: end.cpu.system - start.cpu.system }, compileMs: end.compile === null || start.compile === null ? null : end.compile - start.compile, heapBefore: start.heap, heapAfter: end.heap, voluntarySwitches: end.usage.voluntaryContextSwitches - start.usage.voluntaryContextSwitches, involuntarySwitches: end.usage.involuntaryContextSwitches - start.usage.involuntaryContextSwitches, minorFaults: end.usage.minorPageFault - start.usage.minorPageFault, timers: end.timers - start.timers, timerWaitMs: end.timerWaitMs - start.timerWaitMs })
      definition.onSolved?.(instance)
    },
  }))
  let start: Snapshot | undefined
  let end: Snapshot | undefined
  const sampled = await jsc.profile(async (): Promise<void> => {
    start = snapshot()
    await solveWithProgress(task, solver, start.wall, { onProgress(progress): void { process.stdout.write(JSON.stringify({ taskId, progress }) + "\n") } })
    end = snapshot()
  }, 1000)
  if (!start || !end) throw new Error("Missing solve diagnostic boundaries")
  if (!solver.solved || solver.failed) throw new Error(`Diagnostic routing failed: ${solver.error}`)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const { errors } = evaluateRelaxedDrc({ inputSrj: task.scenario, srjWithPointPairs: solver.srjWithPointPairs, routedTraces: traces })
  const result = { taskId, sample: task.sampleNumber, wallMs: end.wall - start.wall, cpu: { user: end.cpu.user - start.cpu.user, system: end.cpu.system - start.cpu.system }, start, end, phases, stageTimes: solver.timeSpentOnPhase, routeHash: createHash("sha256").update(JSON.stringify(traces)).digest("hex"), drcErrors: errors.length, functions: sampled.functions, bytecodes: sampled.bytecodes, capabilities: { compile: typeof jsc.totalCompileTime, profile: typeof jsc.profile } }
  const output = process.env.DIAGNOSTIC_OUTPUT
  if (!output) throw new Error("Missing diagnostic output path")
  writeFileSync(output, JSON.stringify({ ...result, stackTraces: sampled.stackTraces }))
  process.stdout.write("DIAGNOSTIC_RESULT " + JSON.stringify({ ...result, functions: sampled.functions.split("\n").slice(0, 40).join("\n"), bytecodes: sampled.bytecodes.split("\n").slice(0, 22).join("\n") }) + "\n")
  if (errors.length) throw new Error("Diagnostic DRC regression")
}
