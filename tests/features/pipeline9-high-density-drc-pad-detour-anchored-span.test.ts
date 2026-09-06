import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
  type Pipeline9HighDensityForceRejectionReason,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type ForceAttempt = {
  family: Pipeline9HighDensityForceFamily
  scale: number
  application: number
}
type ForceObservation = ForceAttempt & {
  route: HighDensityRoute
  errors: Pipeline9DrcError[]
}
type ForceRejection = {
  family: Pipeline9HighDensityForceFamily
  reason: Pipeline9HighDensityForceRejectionReason
}

test("Pipeline9 inserts an official-clean pad bypass without moving the interior ports that reject native translation", (): void => {
  // Synthetic positive-gap clearance: the official checker suppresses typed
  // pad-clearance records for actual contact. Do not relabel a contact error
  // to manufacture eligibility for this typed-physical-pad candidate family.
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "anchored-pad-node",
    startPcbPortId: "A-port-0",
    endPcbPortId: "A-port-3",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [-3, -2, 2, 3].map((x, index) => ({
      x,
      y: 0,
      z: 0,
      pcb_port_id: `A-port-${index}`,
    })),
    vias: [],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: route.regionId!,
    center: { x: 0, y: 0 },
    width: 8,
    height: 4,
    availableZ: [0, 1],
    portPoints: route.route.map((point) => ({
      ...point,
      connectionName: "A",
    })),
  }
  const pad = {
    type: "pcb_smtpad" as const,
    pcb_smtpad_id: "foreign-pad",
    pcb_component_id: "foreign-component",
    pcb_port_id: "foreign-port",
    shape: "rect" as const,
    x: 0,
    y: 0.17,
    width: 0.2,
    height: 0.1,
    layer: "top" as const,
  }
  const obstacles: Obstacle[] = [
    {
      type: "rect",
      center: { x: pad.x, y: pad.y },
      width: pad.width,
      height: pad.height,
      layers: [pad.layer],
      connectedTo: [pad.pcb_smtpad_id],
    },
  ]
  const ports: AnyCircuitElement[] = route.route.map(
    (point): AnyCircuitElement => ({
      type: "pcb_port",
      pcb_port_id: point.pcb_port_id!,
      source_port_id: `source-${point.pcb_port_id}`,
      pcb_component_id: "A-component",
      x: point.x,
      y: point.y,
      layers: ["top"],
    }),
  )
  const getCircuitJson = (candidate: HighDensityRoute): AnyCircuitElement[] => {
    const trace: PcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "A_0",
      source_trace_id: "A",
      route: candidate.route.map((point, index): PcbTrace["route"][number] => ({
        route_type: "wire",
        x: point.x,
        y: point.y,
        width: point.traceThickness ?? candidate.traceThickness,
        layer: "top",
        start_pcb_port_id: point.pcb_port_id,
        end_pcb_port_id:
          index === candidate.route.length - 1
            ? candidate.endPcbPortId
            : undefined,
      })),
    }
    return structuredClone([trace, pad, ...ports])
  }
  const options = {
    includeTraceContinuity: false,
    includeBoardEdge: false,
    traceClearance: 0.1,
    viaClearance: 0.1,
  }
  const circuitJson = getCircuitJson(route)
  const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
  const initialErrors = getDrcErrors(circuitJson, options).errors
  expect(initialErrors).toHaveLength(1)
  expect(initialErrors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "A_0",
    pcb_pad_id: pad.pcb_smtpad_id,
  })
  const errors: Pipeline9DrcError[] = initialErrors.map((error) => ({
    ...error,
    __pad_ids: [pad.pcb_smtpad_id],
    __pad_copper: [pad],
  }))
  const original = structuredClone({ route, node, pad, ports, obstacles, errors })
  for (const effort of [1, 2]) {
    const attempts: ForceAttempt[] = []
    const rejections: ForceRejection[] = []
    const observations: ForceObservation[] = []
    const attemptedErrors: number[] = []
    for (const candidates of getPipeline9HighDensityForceCandidates({
      node,
      hdRoutes: [route],
      errors,
      traceRouteIndexById: new Map([["A_0", 0]]),
      obstacles,
      layerCount: 2,
      viaDiameter: 0.3,
      viaHoleDiameter: 0.15,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      connMap,
      forceContext: { connMap, obstacles },
      effort,
      onErrorAttempted: (errorIndex): void => {
        attemptedErrors.push(errorIndex)
      },
      onCandidateAttempted: (family, scale, application): void => {
        attempts.push({ family, scale, application })
      },
      onCandidateRejected: (reason): void => {
        rejections.push({ family: attempts.at(-1)!.family, reason })
      },
    })) {
      observations.push({
        ...attempts.at(-1)!,
        route: candidates[0]!,
        errors: getDrcErrors(getCircuitJson(candidates[0]!), options).errors.map(
          (error): Pipeline9DrcError => ({ ...error }),
        ),
      })
    }
    expect(attemptedErrors).toEqual([0])
    expect(rejections).toEqual([
      { family: "native", reason: "anchor" },
      { family: "native", reason: "anchor" },
    ])
    expect(attempts).toEqual([
      { family: "native", scale: 1, application: 0 },
      { family: "native", scale: 1.75, application: 0 },
      { family: "pad-detour-nearest", scale: -1, application: 0 },
      { family: "pad-detour-opposite", scale: -1, application: 1 },
    ])
    expect(attempts.length).toBeLessThanOrEqual(
      getForceScalesForEffort(effort).length *
        getMaxTargetedCandidateAttemptsForEffort(effort),
    )
    expect(observations.map((candidate) => candidate.family)).toEqual([
      "pad-detour-nearest",
      "pad-detour-opposite",
    ])
    for (const candidate of observations) {
      expect(candidate.errors).toEqual([])
      expect(candidate.route.route).toHaveLength(route.route.length + 4)
      expect(candidate.route.route.filter((point) => point.pcb_port_id)).toEqual(
        route.route,
      )
      expect(candidate.route.vias).toEqual(route.vias)
      expect(candidate.route).toEqual({ ...route, route: candidate.route.route })
    }
    expect(observations[0]!.route.route[3]!.y).toBeLessThan(0)
    expect(observations[1]!.route.route[3]!.y).toBeGreaterThan(pad.y)
  }
  expect({ route, node, pad, ports, obstacles, errors }).toEqual(original)
})
