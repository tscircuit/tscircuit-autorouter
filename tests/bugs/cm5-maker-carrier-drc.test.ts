import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import {
  PostPowerDrcRepairSolver,
  getCheckedViaInPadIdentities,
  getDrcErrorIdentity,
  getViaPadClearanceErrors,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/post-power-drc-repair-solver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import srjJson from "../../fixtures/bug-reports/cm5-maker-carrier-drc/cm5-maker-carrier-drc.srj.json" with {
  type: "json",
}
import residualJson from "../../fixtures/bug-reports/cm5-maker-carrier-drc/cm5-maker-carrier-post-power-residual.traces.json" with {
  type: "json",
}

const routedSrj = srjJson as SimpleRouteJson
const inputSrj: SimpleRouteJson = {
  ...structuredClone(routedSrj),
  allowBlindAndBuriedVias: false,
  allowViaInPad: false,
  traces: [],
}
const residualTraces = (residualJson as { traces: SimplifiedPcbTraces }).traces
const getTraceErrorIds = (
  errors: ReturnType<typeof evaluateRelaxedDrc>["errors"],
): string[] =>
  errors.flatMap((error) =>
    "pcb_trace_error_id" in error ? [error.pcb_trace_error_id] : [],
  )
const getErrorTypeCounts = (
  errors: Array<{ type: string }>,
): Record<string, number> =>
  Object.fromEntries(
    [...new Set(errors.map((error) => error.type))]
      .sort()
      .map((type) => [
        type,
        errors.filter((error) => error.type === type).length,
      ]),
  )

test("Pipeline 7 post-power repair clears the corrected CM5 residual", (): void => {
  expect(inputSrj.layerCount).toBe(4)
  expect(inputSrj.connections).toHaveLength(30)
  expect(inputSrj.obstacles).toHaveLength(318)
  const routingPadObstacles = inputSrj.obstacles.filter(
    (obstacle) => obstacle.obstacleRole === "pad",
  )
  expect(routingPadObstacles).toHaveLength(305)
  expect(
    routingPadObstacles.every(
      (obstacle) =>
        typeof obstacle.circuitJsonMetadata?.pcb_smtpad_id === "string" ||
        typeof obstacle.circuitJsonMetadata?.pcb_plated_hole_id === "string",
    ),
  ).toBe(true)
  expect(
    inputSrj.obstacles.filter(
      (obstacle) => obstacle.obstacleRole === "keepout",
    ),
  ).toEqual([
    expect.objectContaining({
      center: { x: -41, y: 0 },
      width: 8,
      height: 15,
    }),
  ])
  expect(routedSrj.traces).toHaveLength(141)
  expect(
    routedSrj.traces?.flatMap((trace) =>
      trace.route.filter((point) => point.route_type === "via"),
    ),
  ).toHaveLength(132)
  expect(residualTraces).toHaveLength(141)
  expect(
    residualTraces.flatMap((trace) =>
      trace.route.filter((point) => point.route_type === "via"),
    ),
  ).toHaveLength(132)

  const pointPairPipeline = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(inputSrj),
    { cacheProvider: null, effort: 1 },
  )
  pointPairPipeline.solveUntilPhase("topologyPlanningSolver")
  expect(pointPairPipeline.failed).toBe(false)
  const srjWithPointPairs = pointPairPipeline.srjWithPointPairs!

  const solver = new PostPowerDrcRepairSolver({
    originalSrj: inputSrj,
    srjWithPointPairs,
    traces: structuredClone(residualTraces),
    effort: 1,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const getReferenceDrc = (
    srjWithPointPairs: SimpleRouteJson,
    routedTraces: SimplifiedPcbTraces,
  ): ReturnType<typeof evaluateRelaxedDrc> =>
    evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs,
      routedTraces,
      drcOptions: {
        supplementalConnMap: getConnectivityMapFromSimpleRouteJson({
          ...srjWithPointPairs,
          traces: routedTraces,
        }),
      },
    })
  const baselineTraces = routedSrj.traces ?? []
  const baselineDrc = getReferenceDrc(srjWithPointPairs, baselineTraces)
  const baselineConnMap = getConnectivityMapFromSimpleRouteJson({
    ...srjWithPointPairs,
    traces: baselineTraces,
  })
  expect(getErrorTypeCounts(baselineDrc.errors)).toEqual({
    pcb_pad_trace_clearance_error: 1,
    pcb_trace_error: 25,
    pcb_via_trace_clearance_error: 17,
  })
  const baselineViaPadErrors = getViaPadClearanceErrors({
    circuitJson: baselineDrc.circuitJson,
    srj: inputSrj,
    supplementalConnMap: baselineConnMap,
  })
  expect(baselineViaPadErrors.map(getDrcErrorIdentity).sort()).toEqual([
    "via_pad_clearance_via_111_pcb_smtpad_101",
    "via_pad_clearance_via_16_pcb_smtpad_108",
    "via_pad_clearance_via_16_pcb_smtpad_110",
    "via_pad_clearance_via_17_pcb_smtpad_136",
    "via_pad_clearance_via_26_pcb_smtpad_106",
    "via_pad_clearance_via_50_pcb_smtpad_112",
  ])
  expect(
    getCheckedViaInPadIdentities({
      circuitJson: baselineDrc.circuitJson,
      srj: inputSrj,
    }),
  ).toEqual([
    "source_net_4_0:-1.049990:8.640060:top-inner1-inner2-bottom:pcb_smtpad_106",
    "source_trace_20_0:1.809530:2.635203:top-inner1-inner2-bottom:pcb_smtpad_137",
    "source_trace_25_0:1.695598:1.433610:top-inner1-inner2-bottom:pcb_smtpad_143",
  ])
  expect(getTraceErrorIds(baselineDrc.errors)).toEqual(
    expect.arrayContaining([
      "overlap_source_net_10_mst1_0_source_trace_22_0",
      "overlap_source_net_2_mst12_0_via_15",
      "overlap_source_trace_20_0_via_15",
    ]),
  )

  const residualDrc = getReferenceDrc(srjWithPointPairs, residualTraces)
  const finalTraces = solver.getOutput()
  const finalDrc = getReferenceDrc(srjWithPointPairs, finalTraces)

  expect(getTraceErrorIds(residualDrc.errors)).toEqual([
    "overlap_source_net_1_mst16_0_source_trace_21_0",
  ])
  expect(
    getCheckedViaInPadIdentities({
      circuitJson: residualDrc.circuitJson,
      srj: inputSrj,
    }),
  ).toEqual([
    "source_trace_22_0:1.853261:3.824542:top-inner1-inner2-bottom:pcb_smtpad_131",
  ])
  expect(finalDrc.errors).toHaveLength(0)
  expect(
    getViaPadClearanceErrors({
      circuitJson: finalDrc.circuitJson,
      srj: inputSrj,
      supplementalConnMap: getConnectivityMapFromSimpleRouteJson({
        ...srjWithPointPairs,
        traces: finalTraces,
      }),
    }),
  ).toHaveLength(0)
  expect(
    getCheckedViaInPadIdentities({
      circuitJson: finalDrc.circuitJson,
      srj: inputSrj,
    }),
  ).toHaveLength(0)
  expect(solver.stats).toMatchObject({
    skipped: false,
    initialDrcErrorCount: 1,
    finalDrcErrorCount: 0,
    initialViaInPadCount: 1,
    finalViaInPadCount: 0,
    initialGuardErrorCount: 1,
    finalGuardErrorCount: 0,
    acceptedCandidateCount: 2,
    acceptedLayerLiftCount: 1,
    contactSpanSearchCount: 1,
    acceptedContactSpanRepairCount: 1,
    candidateBudgetExhausted: false,
    runtimeBudgetExhausted: false,
    remainingDrcErrorIds: [],
    remainingViaInPadIds: [],
    remainingGuardErrorIds: [],
  })
  expect(solver.stats.contactSpanSearchIterationCount).toBeGreaterThan(0)
  expect(solver.stats.contactSpanSearchIterationCount).toBeLessThanOrEqual(
    50_000,
  )
})
