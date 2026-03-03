import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { GreedySequentialPipelineSolver } from "lib/autorouter-pipelines/GreedySequentialPipeline/GreedySequentialPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

// Simulates an IC package fanout: central IC body with 8 pads
// fanning out to 8 destinations around the perimeter.
// Pad obstacles represent the IC body + pads that other traces must avoid.
const padSize = 0.8
const connNames = Array.from({ length: 8 }, (_, i) => `conn${i + 1}`)

const icBody = {
  type: "rect" as const,
  layers: ["top", "bottom"],
  center: { x: 0, y: 0 },
  width: 4,
  height: 4,
  connectedTo: connNames,
}

// Generate pad obstacles along the IC edges
const padPositions = [
  // Left side pads
  { x: -2.5, y: 1.2 },
  { x: -2.5, y: 0.4 },
  { x: -2.5, y: -0.4 },
  { x: -2.5, y: -1.2 },
  // Right side pads
  { x: 2.5, y: 1.2 },
  { x: 2.5, y: 0.4 },
  { x: 2.5, y: -0.4 },
  { x: 2.5, y: -1.2 },
]

const padObstacles = padPositions.map((pos, i) => ({
  type: "rect" as const,
  layers: ["top"],
  center: pos,
  width: padSize,
  height: padSize,
  connectedTo: [`conn${i + 1}`],
}))

// Destination points around the perimeter
const destinations = [
  { x: -8, y: 7 },
  { x: -8, y: 3 },
  { x: -8, y: -3 },
  { x: -8, y: -7 },
  { x: 8, y: 7 },
  { x: 8, y: 3 },
  { x: 8, y: -3 },
  { x: 8, y: -7 },
]

const simpleRouteJson: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [icBody, ...padObstacles],
  connections: padPositions.map((pad, i) => ({
    name: `conn${i + 1}`,
    pointsToConnect: [
      { x: pad.x, y: pad.y, layer: "top" },
      { x: destinations[i]!.x, y: destinations[i]!.y, layer: "top" },
    ],
  })),
  bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
}

export default () => (
  <AutoroutingPipelineDebugger
    createSolver={(srj) => new GreedySequentialPipelineSolver(srj)}
    srj={simpleRouteJson as any}
  />
)
