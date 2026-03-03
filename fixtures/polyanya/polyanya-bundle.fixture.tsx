import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { GreedySequentialPipelineSolver } from "lib/autorouter-pipelines/GreedySequentialPipeline/GreedySequentialPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

// 4 parallel traces entering a narrow corridor in mixed order
// Tests full sorting network — traces must reorder within the corridor
const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0, y: 3 },
      width: 12,
      height: 1,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0, y: -3 },
      width: 12,
      height: 1,
      connectedTo: [],
    },
  ],
  connections: [
    {
      name: "conn1",
      pointsToConnect: [
        { x: -8, y: 2, layer: "top" },
        { x: 8, y: -2, layer: "top" },
      ],
    },
    {
      name: "conn2",
      pointsToConnect: [
        { x: -8, y: 1, layer: "top" },
        { x: 8, y: -1, layer: "top" },
      ],
    },
    {
      name: "conn3",
      pointsToConnect: [
        { x: -8, y: -1, layer: "top" },
        { x: 8, y: 1, layer: "top" },
      ],
    },
    {
      name: "conn4",
      pointsToConnect: [
        { x: -8, y: -2, layer: "top" },
        { x: 8, y: 2, layer: "top" },
      ],
    },
  ],
  bounds: { minX: -10, maxX: 10, minY: -6, maxY: 6 },
}

export default () => (
  <AutoroutingPipelineDebugger
    createSolver={(srj) => new GreedySequentialPipelineSolver(srj)}
    srj={simpleRouteJson as any}
  />
)
