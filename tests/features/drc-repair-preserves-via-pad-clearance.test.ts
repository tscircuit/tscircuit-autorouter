import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type DrcEvaluator,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "high-density-repair03/lib"

test("DRC repair does not trade trace errors for new via-to-pad errors", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -3, minY: -2, maxX: 3, maxY: 2 },
    obstacles: [],
    connections: [{ name: "trace", pointsToConnect: [] }],
  }
  const hdRoutes: HighDensityRoute[] = [
    {
      connectionName: "trace",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0 },
        { x: -0.5, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
    },
  ]

  for (const viasClearPads of [false, true]) {
    let layerMoveCandidates = 0
    const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes }) => {
      const moved = (routes ?? hdRoutes ?? []).some((route) =>
        route.route.some((point) => point.z === 1),
      )
      if (moved) layerMoveCandidates++
      // Isolate candidate acceptance: the layer move fixes the trace error,
      // but only the positive control has space for its new vias.
      const errors = moved
        ? viasClearPads
          ? []
          : [
              {
                type: "pcb_pad_pad_clearance_error",
                pcb_trace_id: "trace_0",
                pcb_via_ids: ["via_0"],
                pcb_pad_ids: ["via_0", "foreign-pad"],
                center: { x: -0.5, y: 0 },
              },
            ]
        : [
            {
              type: "pcb_trace_error",
              pcb_trace_id: "trace_0",
              center: { x: 0, y: 0 },
            },
          ]
      return { errors, errorsWithCenters: errors }
    }
    const solver = new GlobalDrcForceImproveSolver({
      srj,
      hdRoutes: structuredClone(hdRoutes),
      drcEvaluator,
      maxIterations: 4,
      enableLargeBoardBroadFallback: false,
      enableTargetedErrorSweep: false,
      enablePostSolveClearanceRelaxation: false,
      enableSafeTraceLayerMoves: true,
      enableViaInPadLayerMoves: false,
    })
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(layerMoveCandidates).toBeGreaterThan(0)
    const output = solver.getOutput()
    expect(output.some((route) => route.vias.length > 0)).toBe(viasClearPads)
    expect(solver.stats.finalDrcIssueCount).toBe(viasClearPads ? 0 : 1)
  }
})
