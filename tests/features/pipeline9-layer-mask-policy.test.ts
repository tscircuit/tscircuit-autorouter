import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"
import type { Pipeline9HighDensitySolverParams } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"

test("physical layer masks stay binding in both stages", (): void => {
  for (const allowViaInPad of [false, true]) {
    for (const hasPreloadedCopper of [false, true]) {
      const input: SimpleRouteJson = {
        layerCount: 2,
        minTraceWidth: 0.15,
        allowViaInPad,
        bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
        obstacles: [-2, 2].map((x) => ({
          type: "rect",
          layers: ["top"],
          center: { x, y: 0 },
          width: 1,
          height: 1,
          connectedTo: ["signal"],
        })),
        connections: [
          {
            name: "signal",
            pointsToConnect: [
              { x: -2, y: 0, layer: "top", pcb_port_id: "a" },
              { x: 2, y: 0, layer: "top", pcb_port_id: "b" },
            ],
          },
        ],
        traces: hasPreloadedCopper
          ? [
              {
                type: "pcb_trace",
                pcb_trace_id: "fixed",
                connection_name: "fixed",
                route: [
                  {
                    route_type: "wire",
                    x: -4,
                    y: 3,
                    width: 0.15,
                    layer: "bottom",
                  },
                  {
                    route_type: "wire",
                    x: 4,
                    y: 3,
                    width: 0.15,
                    layer: "bottom",
                  },
                ],
              },
            ]
          : [],
      }
      const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
        cacheProvider: null,
      })
      solver.solveUntilPhase("highDensityRouteSolver")
      expect(solver.failed, solver.error ?? "").toBeFalse()
      const [pathing] = solver.portPointPathingSolver!.getConstructorParams()
      expect(pathing.regionLayerMasksAreBinding).toBe(
        allowViaInPad || hasPreloadedCopper,
      )
      const detailed = solver.pipelineDef.find(
        (step) => step.solverName === "highDensityRouteSolver",
      )!
      const [params] = detailed.getConstructorParams(solver) as [
        Pipeline9HighDensitySolverParams,
      ]
      expect(params.minimumTraceWidth !== undefined).toBe(allowViaInPad)
    }
  }
})
