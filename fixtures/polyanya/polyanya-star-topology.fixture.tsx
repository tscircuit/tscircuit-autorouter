import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { GreedySequentialPipelineSolver } from "lib/autorouter-pipelines/GreedySequentialPipeline/GreedySequentialPipelineSolver"
import type { SimpleRouteJson } from "lib/types"

// Star topology: all traces converge toward a central region,
// creating maximum congestion. Tests the crossing resolver
// under heavy load with many intersecting paths.
const N = 10
const radius = 8
const connections = []
for (let i = 0; i < N; i++) {
  const angle = (2 * Math.PI * i) / N
  const x = radius * Math.cos(angle)
  const y = radius * Math.sin(angle)
  // Each trace goes from outer point to the opposite side
  const oppositeAngle = angle + Math.PI
  const ox = radius * Math.cos(oppositeAngle)
  const oy = radius * Math.sin(oppositeAngle)
  connections.push({
    name: `star${i}`,
    pointsToConnect: [
      {
        x: +x.toFixed(2) as unknown as number,
        y: +y.toFixed(2) as unknown as number,
        layer: "top",
      },
      {
        x: +ox.toFixed(2) as unknown as number,
        y: +oy.toFixed(2) as unknown as number,
        layer: "top",
      },
    ],
  })
}

const simpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  obstacles: [
    // Small central obstacle to force routing around it
    {
      type: "rect",
      layers: ["top", "bottom"],
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      connectedTo: [],
    },
  ],
  connections,
  bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
}

export default () => (
  <AutoroutingPipelineDebugger
    createSolver={(srj) => new GreedySequentialPipelineSolver(srj)}
    srj={simpleRouteJson as any}
  />
)
