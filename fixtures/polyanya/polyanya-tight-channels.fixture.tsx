import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { GreedySequentialPipelineSolver } from "lib/autorouter-pipelines/GreedySequentialPipeline/GreedySequentialPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

// Stress test: obstacles form tight channels that traces must
// squeeze through. 6 traces compete for limited corridor space.
const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [
    // Top wall with gap
    { type: "rect", layers: ["top", "bottom"], center: { x: -4, y: 3.5 }, width: 6, height: 1, connectedTo: [] },
    { type: "rect", layers: ["top", "bottom"], center: { x: 4, y: 3.5 }, width: 6, height: 1, connectedTo: [] },
    // Bottom wall with gap
    { type: "rect", layers: ["top", "bottom"], center: { x: -4, y: -3.5 }, width: 6, height: 1, connectedTo: [] },
    { type: "rect", layers: ["top", "bottom"], center: { x: 4, y: -3.5 }, width: 6, height: 1, connectedTo: [] },
    // Center pillar — forces traces around
    { type: "rect", layers: ["top", "bottom"], center: { x: 0, y: 0 }, width: 1.5, height: 2.5, connectedTo: [] },
    // Side obstacles narrowing the gaps further
    { type: "rect", layers: ["top", "bottom"], center: { x: -8, y: 0 }, width: 1, height: 4, connectedTo: [] },
    { type: "rect", layers: ["top", "bottom"], center: { x: 8, y: 0 }, width: 1, height: 4, connectedTo: [] },
  ],
  connections: [
    // 6 traces from left to right, must thread through gaps
    { name: "t1", pointsToConnect: [{ x: -10, y: 5, layer: "top" }, { x: 10, y: 5, layer: "top" }] },
    { name: "t2", pointsToConnect: [{ x: -10, y: 2, layer: "top" }, { x: 10, y: 2, layer: "top" }] },
    { name: "t3", pointsToConnect: [{ x: -10, y: 0.5, layer: "top" }, { x: 10, y: 0.5, layer: "top" }] },
    { name: "t4", pointsToConnect: [{ x: -10, y: -0.5, layer: "top" }, { x: 10, y: -0.5, layer: "top" }] },
    { name: "t5", pointsToConnect: [{ x: -10, y: -2, layer: "top" }, { x: 10, y: -2, layer: "top" }] },
    { name: "t6", pointsToConnect: [{ x: -10, y: -5, layer: "top" }, { x: 10, y: -5, layer: "top" }] },
  ],
  bounds: { minX: -12, maxX: 12, minY: -8, maxY: 8 },
}

export default () => (
  <AutoroutingPipelineDebugger
    createSolver={(srj) => new GreedySequentialPipelineSolver(srj)}
    srj={simpleRouteJson as any}
  />
)
