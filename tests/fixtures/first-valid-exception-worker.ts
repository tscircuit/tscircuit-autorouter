import { ParallelMultiHeadHighDensityNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiHeadHighDensityNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pipeline9LocalWorker"

type ControlledNode = NodeWithPortPoints & { testBarrier?: SharedArrayBuffer }
const originalSolveAsync = ParallelMultiHeadHighDensityNodeSolver.prototype.solveAsync

async function waitForSignal(signal: Int32Array): Promise<void> {
  while (Atomics.load(signal, 0) === 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1)
    })
  }
}

ParallelMultiHeadHighDensityNodeSolver.prototype.solveAsync = async function (): Promise<void> {
  const node = this.unsolvedNodePortPoints[0] as ControlledNode
  if (node.capacityMeshNodeId === "late-generic-exception") {
    const signal = (this as unknown as { cancellation?: Int32Array }).cancellation
    if (!signal) throw new Error("Controlled speculative owner is missing its cancellation flag")
    await waitForSignal(signal)
    throw new RangeError("late cancelled generic algorithm failure")
  }
  if (node.capacityMeshNodeId === "unrelated-owner") {
    if (!node.testBarrier) throw new Error("Unrelated controlled owner is missing its barrier")
    await waitForSignal(new Int32Array(node.testBarrier))
  }
  await originalSolveAsync.call(this)
}
