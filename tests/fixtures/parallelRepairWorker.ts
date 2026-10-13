import { parentPort } from "node:worker_threads"
import { solveHighDensityRepairSample, type HighDensityRepairSampleInput } from "lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"

if (!parentPort) throw new Error("Repair fixture must run in a worker")
parentPort.on("message", (input: HighDensityRepairSampleInput): void => {
  parentPort!.postMessage(solveHighDensityRepairSample(input))
})
