import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

type ForceObservation = {
  family: Pipeline9HighDensityForceFamily
  routes: HighDensityRoute[]
  errors: Pipeline9DrcError[]
}

test("Pipeline9 endpoint pad candidates clear a synthetic conflict without the rigid candidate's foreign-via regression", (): void => {
  // This is the hosted synthetic mechanism proof, not a captured sample12 case.
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "synthetic-node",
    startPcbPortId: "A-start",
    endPcbPortId: "A-end",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0, pcb_port_id: "A-start" },
      { x: -1, y: 0.2, z: 0, traceThickness: 0.1 },
      { x: 1, y: 0.2, z: 0, traceThickness: 0.1 },
      { x: 2, y: 0, z: 0, pcb_port_id: "A-end" },
    ],
    vias: [],
  }
  const pad = {
    type: "pcb_smtpad" as const,
    pcb_smtpad_id: "foreign-pad",
    pcb_component_id: "foreign-component",
    pcb_port_id: "foreign-port",
    shape: "rect" as const,
    x: -0.8,
    y: 0.42,
    width: 0.2,
    height: 0.2,
    layer: "top" as const,
  }
  const via: PcbVia = {
    type: "pcb_via",
    pcb_via_id: "foreign-via",
    x: 1,
    y: -0.12,
    hole_diameter: 0.15,
    outer_diameter: 0.3,
    layers: ["top", "bottom"],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "synthetic-node",
    center: { x: 0, y: 0 },
    width: 6,
    height: 6,
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
    return structuredClone([trace, pad, via])
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
    pcb_pad_id: pad.pcb_smtpad_id,
  })
  const errors: Pipeline9DrcError[] = initialErrors.map((error) => ({
    ...error,
    __pad_ids: [pad.pcb_smtpad_id],
    __pad_copper: [pad],
  }))
  const original = structuredClone({ route, pad, via, node, obstacles, errors })
  const observations: ForceObservation[] = []
  const attempts: Pipeline9HighDensityForceFamily[] = []
  const attemptedErrors: number[] = []
  for (const routes of getPipeline9HighDensityForceCandidates({
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
    onCandidateAttempted: (family): void => {
      attempts.push(family)
    },
  })) {
    observations.push({
      family: attempts.at(-1)!,
      routes,
      errors: getDrcErrors(getCircuitJson(routes[0]!), options).errors.map(
        (error): Pipeline9DrcError => ({ ...error }),
      ),
    })
  }
  expect(attemptedErrors).toEqual([0])
  expect(attempts.slice(0, 2)).toEqual(["pad-wire", "native"])
  expect(
    attempts.filter(
      (family) => family === "pad-wire-0" || family === "pad-wire-1",
    ),
  ).toEqual(["pad-wire-0", "pad-wire-1"])
  const firstAccepted = observations.find((observation) =>
    isPipeline9HighDensityDrcCandidateBetter(observation.errors, errors),
  )
  expect(firstAccepted).toBe(
    observations.find((observation) => observation.family === "pad-wire-0"),
  )
  expect(firstAccepted?.family).toBe("pad-wire-0")
  expect(firstAccepted?.errors).toHaveLength(0)
  const rigid = observations.find(
    (observation) => observation.family === "pad-wire",
  )
  if (!rigid) {
    throw new Error("The distinct original rigid candidate must remain")
  }
  expect(observations[0]).toBe(rigid)
  expect(rigid.errors).toHaveLength(1)
  expect(rigid.errors[0]).toMatchObject({
    type: "pcb_via_trace_clearance_error",
    pcb_trace_id: "A_0",
    pcb_via_id: via.pcb_via_id,
  })
  expect(isPipeline9HighDensityDrcCandidateBetter(rigid.errors, errors)).toBe(
    false,
  )
  for (const observation of observations) {
    if (
      observation.family !== "pad-wire-0" &&
      observation.family !== "pad-wire-1"
    ) {
      continue
    }
    const heldIndex = observation.family === "pad-wire-0" ? 2 : 1
    const candidate = observation.routes[0]!
    expect(candidate.route[heldIndex]).toEqual(route.route[heldIndex])
    expect(candidate.route[0]).toEqual(route.route[0])
    expect(candidate.route.at(-1)).toEqual(route.route.at(-1))
    expect(candidate.vias).toEqual(route.vias)
    expect(candidate).toEqual({ ...route, route: candidate.route })
  }
  expect({ route, pad, via, node, obstacles, errors }).toEqual(original)
})
