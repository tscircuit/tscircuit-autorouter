import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"

class ElevenStepSolver extends BaseSolver {
  override _step(): void {
    if (this.iterations === 11) {
      this.solved = true
    }
  }
}

test("Pipeline 9 batches child work without skipping phase completion", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [],
    connections: [],
  }
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
  const childSolver = new ElevenStepSolver()
  pipeline.currentPipelineStepIndex = 1
  pipeline.activeSubSolver = childSolver

  pipeline.step()

  expect(childSolver.iterations).toBe(10)
  expect(pipeline.activeSubSolver).toBe(childSolver)

  pipeline.step()

  expect(childSolver.iterations).toBe(11)
  expect(pipeline.currentPipelineStepIndex).toBe(2)
  expect(pipeline.activeSubSolver).toBeNull()
})
