import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import type { SimpleRouteJson } from "lib/types"

export default () => {
  const createSolver = () => {
    const minTraceWidth = 0.15

    const input: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth,
      nominalTraceWidth: minTraceWidth * 2, // 0.3mm default
      bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      connections: [
        {
          name: "power_2x",
          nominalTraceWidth: minTraceWidth * 2, // 0.3mm
          pointsToConnect: [
            { x: -5, y: 0, layer: "top" },
            { x: 5, y: 0, layer: "top" },
          ],
        },
        {
          name: "power_4x",
          nominalTraceWidth: minTraceWidth * 4, // 0.6mm
          pointsToConnect: [
            { x: -5, y: 2, layer: "top" },
            { x: 5, y: 2, layer: "top" },
          ],
        },
        {
          name: "power_8x",
          nominalTraceWidth: minTraceWidth * 8, // 1.2mm
          pointsToConnect: [
            { x: -5, y: 4, layer: "top" },
            { x: 5, y: 4, layer: "top" },
          ],
        },
        {
          name: "signal_default",
          // No nominalTraceWidth, should use minTraceWidth
          pointsToConnect: [
            { x: -5, y: -2, layer: "top" },
            { x: 5, y: -2, layer: "top" },
          ],
        },
      ],
      obstacles: [],
    }

    return new AssignableAutoroutingPipeline2(input)
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
