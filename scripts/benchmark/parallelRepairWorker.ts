import { availableParallelism } from "node:os"
import { readFileSync } from "node:fs"
import { parentPort, threadId } from "node:worker_threads"
import {
  solveHighDensityRepairSample,
  type HighDensityRepairSampleInput,
  type HighDensityRepairSampleResult,
} from "../../lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"

export type ParallelRepairWorkerRequest = {
  requestId: number
  input: HighDensityRepairSampleInput
}

export type ParallelRepairWorkerMessage =
  | { kind: "ready"; threadId: number; availableParallelism: number; affinity: string }
  | { kind: "result"; requestId: number; value: HighDensityRepairSampleResult; solveMs: number }
  | { kind: "error"; requestId: number; error: string }

if (!parentPort) throw new Error("Parallel repair benchmark must run in a worker")
const affinity = readFileSync("/proc/thread-self/status", "utf8")
  .match(/^Cpus_allowed_list:\s*(.*)$/m)?.[1]?.trim()
if (!affinity) throw new Error("Cannot read repair worker CPU affinity")
parentPort.postMessage({ kind: "ready", threadId, availableParallelism: availableParallelism(), affinity } satisfies ParallelRepairWorkerMessage)
parentPort.on("message", ({ requestId, input }: ParallelRepairWorkerRequest): void => {
  try {
    const start = performance.now()
    const value = solveHighDensityRepairSample(input)
    parentPort!.postMessage({ kind: "result", requestId, value, solveMs: performance.now() - start } satisfies ParallelRepairWorkerMessage)
  } catch (error) {
    parentPort!.postMessage({ kind: "error", requestId, error: error instanceof Error ? error.message : String(error) } satisfies ParallelRepairWorkerMessage)
  }
})
