import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import {
  PostPowerDrcRepairSolver,
  getCheckedViaInPadIdentities,
  getDrcErrorIdentity,
  getViaPadClearanceErrors,
} from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/post-power-drc-repair-solver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getDrcErrors } from "lib/testing/getDrcErrors"
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

test("Pipeline 7 post-power repair clears the captured CM5 residual", (): void => {
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
  ).toHaveLength(134)
  const liftedSourceTrace22 = residualTraces.find(
    (trace) => trace.pcb_trace_id === "source_trace_22_0",
  )!
  expect(liftedSourceTrace22.route).toHaveLength(80)
  expect(
    liftedSourceTrace22.route.filter(
      (point) => point.route_type === "via" && point.via_diameter === undefined,
    ),
  ).toEqual([
    expect.objectContaining({
      from_layer: "bottom",
      to_layer: "inner1",
    }),
    expect.objectContaining({
      from_layer: "inner1",
      to_layer: "bottom",
    }),
  ])

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
    pcb_trace_error: 9,
    pcb_via_trace_clearance_error: 3,
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
    "via_pad_clearance_via_50_pcb_smtpad_112",
  ])
  expect(
    getCheckedViaInPadIdentities({
      circuitJson: baselineDrc.circuitJson,
      srj: inputSrj,
    }),
  ).toEqual([
    "source_net_4_0:-1.049990:8.640060:top-inner1:pcb_smtpad_106",
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
    "overlap_source_net_10_mst1_0_source_net_8_0",
  ])
  expect(
    getCheckedViaInPadIdentities({
      circuitJson: residualDrc.circuitJson,
      srj: inputSrj,
    }),
  ).toHaveLength(0)
  expect(getTraceErrorIds(finalDrc.errors)).toEqual([
    "overlap_source_net_10_mst1_0_pcb_smtpad_0.490_0.000",
  ])
  expect(
    inputSrj.obstacles.some(
      (obstacle) =>
        obstacle.isCopperPour === true &&
        obstacle.layers.includes("inner1") &&
        obstacle.center.x === 0.48999999999999844 &&
        obstacle.center.y === 0,
    ),
  ).toBe(true)

  const authoritativePadIds = new Set(
    inputSrj.obstacles.flatMap((obstacle) => {
      if (obstacle.obstacleRole !== "pad") return []
      const padId =
        obstacle.circuitJsonMetadata?.pcb_smtpad_id ??
        obstacle.circuitJsonMetadata?.pcb_plated_hole_id
      return padId ? [padId] : []
    }),
  )
  const authoritativeCircuitJson = finalDrc.circuitJson.filter((element) => {
    if (element.type === "pcb_smtpad")
      return authoritativePadIds.has(element.pcb_smtpad_id)
    if (element.type === "pcb_plated_hole")
      return authoritativePadIds.has(element.pcb_plated_hole_id)
    return true
  })
  expect(
    getDrcErrors(authoritativeCircuitJson, {
      supplementalConnMap: getConnectivityMapFromSimpleRouteJson({
        ...srjWithPointPairs,
        traces: finalTraces,
      }),
      traceClearance: inputSrj.minTraceToPadEdgeClearance,
    }).errors,
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
    initialViaInPadCount: 0,
    finalViaInPadCount: 0,
    initialGuardErrorCount: 1,
    finalGuardErrorCount: 1,
    candidateEvaluationCount: 1,
    acceptedLayerLiftCount: 1,
    candidateBudgetExhausted: false,
    runtimeBudgetExhausted: false,
    remainingGuardErrorIds: ["via_obstacle:source_net_10_mst1_0:136"],
  })
})
