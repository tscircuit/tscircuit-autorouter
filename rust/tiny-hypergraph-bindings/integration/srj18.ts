import assert from "node:assert/strict"
import { sample001 } from "dataset-srj18"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../../lib/types"

async function checkSrj18(): Promise<void> {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(sample001) as SimpleRouteJson,
    { effort: 1 },
  )
  while (!solver.solved && !solver.failed && !solver.portPointPathingSolver?.solved) {
    solver.step()
  }
  assert.equal(solver.failed, false)
  assert.equal(solver.portPointPathingSolver?.solved, true)
  assert.equal(solver.portPointPathingSolver?.stats.tinyHypergraphBackend, "wasm")
  assert.ok(solver.portPointPathingSolver!.getOutput().nodesWithPortPoints.length > 0)
  assert.ok(solver.portPointPathingSolver!.getSolveGraphBenchmarkMetrics()!.iterations > 0)
}

await checkSrj18()
