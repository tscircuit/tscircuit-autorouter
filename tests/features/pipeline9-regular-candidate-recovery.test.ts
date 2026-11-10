import { expect, spyOn, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9RegionalB01RepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("regional repair continues to a safe candidate after rejecting a forbidden one", (): void => {
  const source: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["signal"],
        circuitJsonMetadata: { pcb_smtpad_id: "same_net_pad" },
      },
    ],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      rootConnectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
    },
  ]
  const errors = Array.from({ length: 2 }, () => ({
    type: "pcb_trace_error",
    pcb_trace_id: "signal_0",
    center: { x: 0, y: 0 },
  }))
  // Electrical scoring omits same-net via-in-pad, so it prefers this candidate.
  const drcEvaluator: DrcEvaluator = ({
    hdRoutes,
  }): ReturnType<DrcEvaluator> => {
    const hasInjectedVia = hdRoutes?.some((route) =>
      route.vias.some((via) => via.x === 0 && via.y === 0),
    )
    const hasSafeDetour = hdRoutes?.some((route) =>
      route.route.some((point) => point.x === 0 && point.y === 1),
    )
    let candidateErrors = errors
    if (hasInjectedVia || hasSafeDetour) candidateErrors = []
    return { errors: candidateErrors, errorsWithCenters: candidateErrors }
  }
  let proposalCount = 0
  const getOutput = Pipeline9RegionalFallbackSolver.prototype.getOutput
  const output = spyOn(
    Pipeline9RegionalFallbackSolver.prototype,
    "getOutput",
  ).mockImplementation(function (
    this: Pipeline9RegionalFallbackSolver,
  ): HighDensityRoute[] {
    proposalCount++
    const routed = getOutput.call(this)
    if (proposalCount > 1) {
      return routed.map((route) => ({
        ...route,
        vias: [],
        route: [route.route[0]!, { x: 0, y: 1, z: 0 }, route.route.at(-1)!],
      }))
    }
    return routed.map((route) => ({
      ...route,
      vias: [{ x: 0, y: 0 }],
      route: [
        route.route[0]!,
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 0, y: 0, z: 0 },
        route.route.at(-1)!,
      ],
    }))
  })
  try {
    for (const allowViaInPad of [false, undefined] as const) {
      proposalCount = 0
      const srj = { ...structuredClone(source), allowViaInPad }
      const solver = new Pipeline9RegionalB01RepairSolver({
        srj,
        routes: structuredClone(routes),
        fixedObstacleRoutes: [],
        newConnections: srj.connections,
        syntheticConnectionNames: new Set(),
        drcEvaluator,
        preloadRepairTraceIds: new Set(["signal_0"]),
        connMap: getConnectivityMapFromSimpleRouteJson(srj),
        colorMap: {},
        viaDiameter: 0.3,
        traceWidth: 0.1,
        obstacleMargin: 0.15,
        effort: 1,
      })
      solver.solve()
      expect(solver.solved).toBeTrue()
      expect(solver.failed).toBeFalse()
      expect(solver.error).toBeNull()
      const result = solver.getResult()
      expect(proposalCount).toBe(2)
      expect(result.acceptedCandidateCount).toBe(1)
      expect(result.remainingDrcIssueCount).toBe(0)
      expect(result.routes.flatMap((route) => route.vias)).toEqual([])
      expect(
        result.routes.some((route) =>
          route.route.some((point) => point.x === 0 && point.y === 1),
        ),
      ).toBeTrue()
    }
    expect(output).toHaveBeenCalledTimes(4)
  } finally {
    output.mockRestore()
  }
})
