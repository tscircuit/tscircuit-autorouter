import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { GreedySequentialPipelineSolver } from "lib/autorouter-pipelines/GreedySequentialPipeline/GreedySequentialPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

// Multiple obstacles forming a maze-like layout with 5 traces
// that must navigate through narrow channels
const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [
    // Horizontal walls
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: -3, y: 4 },
      width: 8,
      height: 1,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 3, y: 0 },
      width: 8,
      height: 1,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: -3, y: -4 },
      width: 8,
      height: 1,
      connectedTo: [],
    },
    // Vertical pillars
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: -5, y: 2 },
      width: 1,
      height: 3,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 5, y: -2 },
      width: 1,
      height: 3,
      connectedTo: [],
    },
  ],
  connections: [
    {
      name: "conn1",
      pointsToConnect: [
        { x: -9, y: 6, layer: "top" },
        { x: 9, y: -6, layer: "top" },
      ],
    },
    {
      name: "conn2",
      pointsToConnect: [
        { x: -9, y: -6, layer: "top" },
        { x: 9, y: 6, layer: "top" },
      ],
    },
    {
      name: "conn3",
      pointsToConnect: [
        { x: -9, y: 2, layer: "top" },
        { x: 9, y: 2, layer: "top" },
      ],
    },
    {
      name: "conn4",
      pointsToConnect: [
        { x: -9, y: -2, layer: "top" },
        { x: 9, y: -2, layer: "top" },
      ],
    },
    {
      name: "conn5",
      pointsToConnect: [
        { x: 0, y: 8, layer: "top" },
        { x: 0, y: -8, layer: "top" },
      ],
    },
  ],
  bounds: { minX: -12, maxX: 12, minY: -10, maxY: 10 },
}

export default () => (
  <AutoroutingPipelineDebugger
    createSolver={(srj) => new GreedySequentialPipelineSolver(srj)}
    srj={simpleRouteJson as any}
  />
)
