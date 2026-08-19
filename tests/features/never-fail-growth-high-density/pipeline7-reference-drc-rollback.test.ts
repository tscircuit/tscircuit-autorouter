import { expect, test } from "bun:test"
import { Pipeline7AdaptiveDrcBranchPortfolioSolver } from "../../../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/Pipeline7AdaptiveDrcBranchPortfolioSolver"

test("Pipeline7 rolls back an exact-repair candidate that regresses reference DRC", () => {
  const hdRoutes = [
    {
      connectionName: "via_net",
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
      traceThickness: 0.1,
      viaDiameter: 0.3,
    },
  ]
  const optimizedEvaluator = ({ routes }: any) => {
    const viaX = routes?.[0]?.route[1]?.x ?? 0
    return Math.abs(viaX) > 1e-6
      ? []
      : [
          {
            type: "pcb_pad_pad_clearance_error",
            pcb_trace_id: "via_net_0",
            pcb_via_ids: ["via_0"],
            center: { x: 0.2, y: 0 },
          },
        ]
  }
  const referenceDrcEvaluator = ({ routes }: any) => {
    const viaX = routes?.[0]?.route[1]?.x ?? 0
    return Math.abs(viaX) <= 1e-6
      ? []
      : [{ type: "pcb_trace_error", center: { x: 0, y: 0 } }]
  }
  const solver = new Pipeline7AdaptiveDrcBranchPortfolioSolver({
    srj: {
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      obstacles: [],
      connections: [{ name: "via_net", pointsToConnect: [] }],
    },
    hdRoutes,
    effort: 1,
    maxIterations: 4,
    broadMaxIterations: 1,
    broadPassMultiplier: 1,
    viaInPadMaxIterations: 4,
    enableBroadFallback: false,
    enableLargeBoardBroadFallback: false,
    enableSafeTraceLayerMoves: true,
    drcEvaluator: optimizedEvaluator,
    viaInPadDrcEvaluator: optimizedEvaluator,
    referenceDrcEvaluator,
  } as any)

  solver.solve()

  const output = solver.getOutput() as typeof hdRoutes
  expect(output[0]?.route[1]?.x).toBe(0)
  expect(
    solver.stats.globalDrcForceImproveReferenceCandidateRolledBack,
  ).toBe(true)
  expect(
    solver.stats.globalDrcForceImproveReferenceInputDrcIssueCount,
  ).toBe(0)
  expect(
    solver.stats.globalDrcForceImproveReferenceCandidateDrcIssueCount,
  ).toBe(1)
})
