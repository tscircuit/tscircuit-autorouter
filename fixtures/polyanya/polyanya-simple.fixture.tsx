import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { GreedySequentialPipelineSolver } from "lib/autorouter-pipelines/GreedySequentialPipeline/GreedySequentialPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0, y: 0 },
      width: 3,
      height: 3,
      connectedTo: [],
    },
  ],
  connections: [
    {
      name: "conn1",
      pointsToConnect: [
        { x: -5, y: -2, layer: "top" },
        { x: 5, y: 2, layer: "top" },
      ],
    },
    {
      name: "conn2",
      pointsToConnect: [
        { x: -5, y: 2, layer: "top" },
        { x: 5, y: -2, layer: "top" },
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
