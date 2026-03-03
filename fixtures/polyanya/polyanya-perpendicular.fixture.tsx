import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { GreedySequentialPipelineSolver } from "lib/autorouter-pipelines/GreedySequentialPipeline/GreedySequentialPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

// 2 traces crossing at ~90° — tests via insertion for perpendicular crossings
const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [],
  connections: [
    {
      name: "horizontal",
      pointsToConnect: [
        { x: -6, y: 0, layer: "top" },
        { x: 6, y: 0, layer: "top" },
      ],
    },
    {
      name: "vertical",
      pointsToConnect: [
        { x: 0, y: -6, layer: "top" },
        { x: 0, y: 6, layer: "top" },
      ],
    },
  ],
  bounds: { minX: -8, maxX: 8, minY: -8, maxY: 8 },
}

export default () => (
  <AutoroutingPipelineDebugger
    createSolver={(srj) => new GreedySequentialPipelineSolver(srj)}
    srj={simpleRouteJson as any}
  />
)
