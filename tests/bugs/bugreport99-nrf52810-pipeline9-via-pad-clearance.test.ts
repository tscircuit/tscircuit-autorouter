import { checkViaPadClearance } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import {
  type ConnectivityMap,
  getFullConnectivityMapFromCircuitJson,
} from "circuit-json-to-connectivity-map"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import srjJson from "../../fixtures/bug-reports/bugreport99-nrf52810-drc-identity-swap/bugreport99-nrf52810-drc-identity-swap.srj.json" with {
  type: "json",
}

type CircuitVia = Extract<AnyCircuitElement, { type: "pcb_via" }> & {
  pcb_trace_id?: string
}

type ViaPadViolation = {
  actualClearance: number
  center: { x: number; y: number }
  componentId: string
  ownerTraceId: string
  padId: string
  portName: string
}

const srj = srjJson as SimpleRouteJson
const requiredViaPadClearance = srj.minViaEdgeToPadEdgeClearance ?? 0.1
const roundMetric = (value: number): number => Math.round(value * 1e9) / 1e9

const getOutputConnectivity = (
  solver: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  outputTraces: SimplifiedPcbTrace[],
  circuitJson: AnyCircuitElement[],
): ConnectivityMap => {
  const connMap = getConnectivityMapFromSimpleRouteJson(
    solver.srjWithPointPairs!,
  )
  connMap.addConnections(
    outputTraces.flatMap((trace) =>
      trace.connection_name
        ? [[trace.pcb_trace_id, trace.connection_name]]
        : [],
    ),
  )
  connMap.addConnections(
    circuitJson.flatMap((element) =>
      element.type === "pcb_via" &&
      typeof (element as CircuitVia).pcb_trace_id === "string"
        ? [
            [
              element.pcb_via_id,
              (element as CircuitVia).pcb_trace_id!,
            ],
          ]
        : [],
    ),
  )
  return connMap
}

test("bugreport99 records Pipeline9 nRF52810 via-to-pad clearance violations", () => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(srj),
    { cacheProvider: null },
  )

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  const outputTraces = solver.getOutputSimplifiedPcbTraces()
  const evaluatedDrc = evaluateRelaxedDrc({
    inputSrj: solver.originalSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: outputTraces,
  })
  const connMap = getOutputConnectivity(
    solver,
    outputTraces,
    evaluatedDrc.circuitJson,
  )
  const viaById = new Map(
    evaluatedDrc.circuitJson.flatMap((element) =>
      element.type === "pcb_via"
        ? [[element.pcb_via_id, element as CircuitVia] as const]
        : [],
    ),
  )
  const obstacleByPadId = new Map(
    srj.obstacles.flatMap((obstacle) => {
      const padId = obstacle.circuitJsonMetadata?.pcb_smtpad_id
      return typeof padId === "string" ? [[padId, obstacle] as const] : []
    }),
  )
  const violations: ViaPadViolation[] = checkViaPadClearance(
    evaluatedDrc.circuitJson,
    { connMap, minClearance: requiredViaPadClearance },
  ).map((error) => {
    const [viaId, padId] = error.pcb_pad_ids
    const via = viaById.get(viaId)!
    const obstacle = obstacleByPadId.get(padId)!
    return {
      actualClearance: roundMetric(Number(error.actual_clearance)),
      center: {
        x: roundMetric(Number(error.center!.x)),
        y: roundMetric(Number(error.center!.y)),
      },
      componentId: obstacle.componentId!,
      ownerTraceId: via.pcb_trace_id!,
      padId,
      portName: obstacle.circuitJsonMetadata!.source_port_name!,
    }
  })

  expect(violations).toEqual([
    {
      actualClearance: 0,
      center: { x: 4.877247105, y: 0.109485708 },
      componentId: "pcb_component_2",
      ownerTraceId: "source_net_3_mst1_0",
      padId: "pcb_smtpad_58",
      portName: "VBAT_N",
    },
    {
      actualClearance: 0.085,
      center: { x: 9.433505208, y: 3.5775 },
      componentId: "pcb_component_29",
      ownerTraceId: "source_net_1_mst14_0",
      padId: "pcb_smtpad_105",
      portName: "pin2",
    },
    {
      actualClearance: 0.083452537,
      center: { x: 1.238273731, y: 11.124491625 },
      componentId: "pcb_component_22",
      ownerTraceId: "source_net_0_mst7_0",
      padId: "pcb_smtpad_90",
      portName: "pin1",
    },
    {
      actualClearance: 0.083452537,
      center: { x: 1.238273731, y: 11.124491625 },
      componentId: "pcb_component_22",
      ownerTraceId: "source_net_0_mst8_0",
      padId: "pcb_smtpad_90",
      portName: "pin1",
    },
  ])
  expect(
    new Set(
      checkViaPadClearance(evaluatedDrc.circuitJson, {
        connMap,
        minClearance: requiredViaPadClearance,
      }).map((error) => {
        const [viaId, padId] = error.pcb_pad_ids
        const via = viaById.get(viaId)!
        return `${padId}:${via.x},${via.y}`
      }),
    ).size,
  ).toBe(3)

  // Circuit JSON aliases suppress the two coincident C1 transitions, while
  // the SRJ logical ownership above preserves all four foreign-net owners.
  const circuitConnectivity = getFullConnectivityMapFromCircuitJson(
    evaluatedDrc.circuitJson,
  )
  circuitConnectivity.addConnections(
    evaluatedDrc.circuitJson.flatMap((element) =>
      element.type === "pcb_via" &&
      typeof (element as CircuitVia).pcb_trace_id === "string"
        ? [
            [
              element.pcb_via_id,
              (element as CircuitVia).pcb_trace_id!,
            ],
          ]
        : [],
    ),
  )
  expect(
    checkViaPadClearance(evaluatedDrc.circuitJson, {
      connMap: circuitConnectivity,
      minClearance: requiredViaPadClearance,
    }).map((error) => ({
      actualClearance: roundMetric(Number(error.actual_clearance)),
      padId: error.pcb_pad_ids[1],
    })),
  ).toEqual([
    { actualClearance: 0, padId: "pcb_smtpad_58" },
    {
      actualClearance: 0.085,
      padId: "pcb_smtpad_105",
    },
  ])
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats
      .drcBranchPortfolioViaInPadPhaseAttempted,
  ).toBe(true)
  expect(
    solver.pipeline9JointDrcRepairSolver?.stats
      .globalDrcForceImproveViaInPadCandidateAttempts,
  ).toBe(0)
})
