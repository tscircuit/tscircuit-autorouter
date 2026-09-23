import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 limits boundary repair to supported clearances and copper", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [],
  }
  const cases: Array<{
    overrides: Partial<SimpleRouteJson>
    enabled: boolean
  }> = [
    { overrides: {}, enabled: true },
    { overrides: { minTraceToPadEdgeClearance: 0.1 }, enabled: true },
    { overrides: { minTraceToPadEdgeClearance: 0.15 }, enabled: false },
    { overrides: { minViaEdgeToPadEdgeClearance: 0.15 }, enabled: false },
    { overrides: { minViaHoleEdgeToViaHoleEdgeClearance: 0.15 }, enabled: false },
    {
      overrides: { minPlatedHoleDrillEdgeToDrillEdgeClearance: 0.15 },
      enabled: false,
    },
    {
      overrides: {
        traces: [
          {
            type: "pcb_trace",
            pcb_trace_id: "preload",
            connection_name: "fixed",
            route: [
              { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
              { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
            ],
          },
        ],
      },
      enabled: false,
    },
  ]
  for (const { overrides, enabled } of cases) {
    const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph({
      ...input,
      ...overrides,
    })
    pipeline.highDensityRouteSolver = new Pipeline9HighDensitySolver({
      nodePortPoints: [],
      fixedHdRoutes: [],
      connMap: pipeline.connMap,
      obstacles: [],
      layerCount: 2,
      viaDiameter: 0.3,
      traceWidth: 0.1,
      obstacleMargin: 0.2,
      effort: 1,
    })
    const repairStep = pipeline.pipelineDef.find(
      (step) => step.solverName === "highDensityRepairSolver",
    )!
    const [params] = repairStep.getConstructorParams(
      pipeline,
    ) as ConstructorParameters<typeof Pipeline4HighDensityRepairSolver>
    expect(params.enableNodeBoundaryClearanceRepair).toBe(enabled)
    expect(params.boardGeometry?.bounds).toEqual(input.bounds)
  }
})
