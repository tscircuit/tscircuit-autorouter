import { ParallelMultiHeadHighDensityNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelMultiHeadHighDensityNodeSolver"
import "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pipeline9LocalWorker"

const nativeSolveAsync = ParallelMultiHeadHighDensityNodeSolver.prototype.solveAsync

ParallelMultiHeadHighDensityNodeSolver.prototype.solveAsync = async function (): Promise<void> {
  const node = this.unsolvedNodePortPoints[0]
  if (!node) throw new Error("Controlled batch worker expected its native node")
  if (node.capacityMeshNodeId === "batch-algorithm-exception") {
    throw new RangeError("controlled native batch node failure")
  }
  await nativeSolveAsync.call(this)
}
