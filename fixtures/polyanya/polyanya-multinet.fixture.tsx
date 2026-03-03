import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { GreedySequentialPipelineSolver } from "lib/autorouter-pipelines/GreedySequentialPipeline/GreedySequentialPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

// Multi-point nets: connections with 3+ pointsToConnect that need
// the NetToPointPairsSolver to decompose into pairs via MST.
// Tests that the pipeline correctly handles multi-point nets.
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
    {
      type: "rect",
      layers: ["top"],
      center: { x: 6, y: 3 },
      width: 2,
      height: 2,
      connectedTo: [],
    },
  ],
  connections: [
    // 3-point net — power rail connecting 3 pads
    {
      name: "vcc_net",
      pointsToConnect: [
        { x: -7, y: 5, layer: "top" },
        { x: 0, y: 7, layer: "top" },
        { x: 7, y: 5, layer: "top" },
      ],
    },
    // 4-point net — ground connecting 4 pads
    {
      name: "gnd_net",
      pointsToConnect: [
        { x: -7, y: -5, layer: "top" },
        { x: -3, y: -7, layer: "top" },
        { x: 3, y: -7, layer: "top" },
        { x: 7, y: -5, layer: "top" },
      ],
    },
    // Simple 2-point for comparison
    {
      name: "signal_a",
      pointsToConnect: [
        { x: -7, y: 0, layer: "top" },
        { x: 7, y: 0, layer: "top" },
      ],
    },
    // Another 3-point net
    {
      name: "clk_net",
      pointsToConnect: [
        { x: -5, y: 3, layer: "top" },
        { x: 5, y: 6, layer: "top" },
        { x: 8, y: -3, layer: "top" },
      ],
    },
  ],
  bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
}

export default () => (
  <AutoroutingPipelineDebugger
    createSolver={(srj) => new GreedySequentialPipelineSolver(srj)}
    srj={simpleRouteJson as any}
  />
)
