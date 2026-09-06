import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import {
  getPipeline9DrcScore,
  type Pipeline9DrcError,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
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

test("Pipeline9 retains a broad pad's complete rigid repair before a same-count endpoint improvement", (): void => {
  // This synthetic pad spans nearly the entire free segment. Rotating one
  // endpoint improves clearance but leaves the opposite pad corner too close.
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "broad-pad-node",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -4, y: 2, z: 0, pcb_port_id: "A-start" },
      { x: -1, y: 0, z: 0, traceThickness: 0.1 },
      { x: 1, y: 0, z: 0, traceThickness: 0.1 },
      { x: 4, y: 2, z: 0, pcb_port_id: "A-end" },
    ],
    vias: [],
  }
  const pad = {
    type: "pcb_smtpad" as const,
    pcb_smtpad_id: "broad-foreign-pad",
    pcb_component_id: "foreign-component",
    pcb_port_id: "foreign-port",
    shape: "rect" as const,
    x: 0,
    y: -0.12,
    width: 1.8,
    height: 0.02,
    layer: "top" as const,
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "broad-pad-node",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: [route.route[0]!, route.route.at(-1)!].map((point) => ({
      ...point,
      connectionName: "A",
    })),
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
        start_pcb_port_id: index === 0 ? candidate.startPcbPortId : undefined,
        end_pcb_port_id:
          index === candidate.route.length - 1
            ? candidate.endPcbPortId
            : undefined,
      })),
    }
    return structuredClone([trace, pad])
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
  const original = structuredClone({ route, node, pad, obstacles, errors })
  const attempts: ForceAttempt[] = []
  const attemptedErrors: number[] = []
  const observations: ForceObservation[] = []
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
    effort: 1,
    onErrorAttempted: (index): void => {
      attemptedErrors.push(index)
    },
    onCandidateAttempted: (family, scale, application): void => {
      attempts.push({ family, scale, application })
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
  const firstAccepted = observations.find((candidate) =>
    isPipeline9HighDensityDrcCandidateBetter(candidate.errors, errors),
  )
  expect(firstAccepted).toBe(observations[0])
  expect(firstAccepted).toMatchObject({
    family: "pad-wire",
    scale: 1,
    application: 0,
    errors: [],
  })
  const endpointCandidates = observations.filter(
    (candidate) =>
      candidate.family === "pad-wire-0" || candidate.family === "pad-wire-1",
  )
  expect(endpointCandidates.map((candidate) => candidate.family)).toEqual([
    "pad-wire-0",
    "pad-wire-1",
  ])
  // Reconstruct only the old visitation order using these exact same published
  // candidates: its first accepted severity step discarded the rigid repair.
  const previousPrefixOrder = [
    ...endpointCandidates,
    ...observations.filter(
      (candidate) =>
        candidate.family !== "pad-wire-0" && candidate.family !== "pad-wire-1",
    ),
  ]
  const previousFirstAccepted = previousPrefixOrder.find((candidate) =>
    isPipeline9HighDensityDrcCandidateBetter(candidate.errors, errors),
  )
  expect(previousFirstAccepted).toBe(endpointCandidates[0])
  expect(previousFirstAccepted?.errors).toHaveLength(1)
  expect(previousFirstAccepted?.errors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "A_0",
    pcb_pad_id: pad.pcb_smtpad_id,
  })
  expect(getPipeline9DrcScore(previousFirstAccepted!.errors)).toBeLessThan(
    getPipeline9DrcScore(errors),
  )
  expect(previousFirstAccepted!.route.route[2]).toEqual(route.route[2])
  expect(firstAccepted!.route.route[1]!.y).toBeCloseTo(0.07, 12)
  expect(firstAccepted!.route.route[2]!.y).toBeCloseTo(0.07, 12)
  for (const candidate of observations) {
    expect(candidate.route.route[0]).toEqual(route.route[0])
    expect(candidate.route.route.at(-1)).toEqual(route.route.at(-1))
    expect(candidate.route.vias).toEqual(route.vias)
    expect(candidate.route).toEqual({ ...route, route: candidate.route.route })
  }
  expect({ route, node, pad, obstacles, errors }).toEqual(original)
})
