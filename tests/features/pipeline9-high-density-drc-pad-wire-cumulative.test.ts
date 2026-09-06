import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import type { PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
  TRACE_PAD_REPAIR_MAX_MOVE,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("Pipeline9 cumulative compensated pad-wire candidates never inherit native via movement", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "pad-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 1, z: 1 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 2, z: 0 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "pad-node",
    center: { x: 1, y: 0 },
    width: 8,
    height: 8,
    availableZ: [0, 1],
    portPoints: [route.route[0]!, route.route.at(-1)!].map((point) => ({
      ...point,
      connectionName: "A",
    })),
  }
  const pad = {
    type: "pcb_smtpad" as const,
    pcb_smtpad_id: "foreign-pad",
    pcb_component_id: "B-component",
    pcb_port_id: "B-port",
    shape: "rect" as const,
    x: 0.1,
    y: -0.12,
    width: 0.02,
    height: 0.02,
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
  const connMap = new ConnectivityMap({
    A: ["A", "A_0"],
    B: ["foreign-pad"],
  })
  const trace: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "A_0",
    source_trace_id: "A",
    route: route.route.map((point): PcbTrace["route"][number] => ({
      route_type: "wire",
      x: point.x,
      y: point.y,
      width: route.traceThickness,
      layer: point.z === 0 ? "top" : "bottom",
    })),
  }
  // This constraint deliberately needs multiple capped wire steps. It tests
  // private candidate accumulation, not acceptance of a complete board repair.
  const errors = checkPadTraceClearance([trace, pad], {
    connMap,
    minClearance: 0.1,
  })
  expect(errors).toHaveLength(1)
  const original = structuredClone({ route, node, pad, obstacles, errors })
  const attempts: {
    family: Pipeline9HighDensityForceFamily
    scale: number
    application: number
  }[] = []
  const iterator = getPipeline9HighDensityForceCandidates({
    node,
    hdRoutes: [route],
    errors: errors.map((error) => ({
      ...error,
      __pad_ids: [pad.pcb_smtpad_id],
      __pad_copper: [pad],
    })),
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
    onCandidateAttempted: (family, scale, application): void => {
      attempts.push({ family, scale, application })
    },
  })
  const first = iterator.next()
  if (first.done) throw new Error("Expected the first capped pad-wire move")
  const firstSnapshot = structuredClone(first.value)
  const native = iterator.next()
  if (native.done) throw new Error("Expected independent native via movement")
  const nativeSnapshot = structuredClone(native.value)
  const second = iterator.next()
  if (second.done) throw new Error("Expected a cumulative second wire move")
  const firstScale = getForceScalesForEffort(1)[0]
  expect(attempts).toEqual([
    { family: "pad-wire", scale: firstScale, application: 0 },
    { family: "native", scale: firstScale, application: 1 },
    { family: "pad-wire", scale: firstScale, application: 2 },
  ])
  expect(attempts).toHaveLength(getMaxTargetedCandidateAttemptsForEffort(1))
  expect(first.value[0]!.route[3]!.y).toBeCloseTo(
    TRACE_PAD_REPAIR_MAX_MOVE,
    12,
  )
  expect(second.value[0]!.route[3]!.y).toBeGreaterThan(
    first.value[0]!.route[3]!.y,
  )
  expect(native.value[0]!.vias).not.toEqual(route.vias)
  for (const candidate of [first.value, second.value]) {
    expect(candidate[0]!.vias).toEqual(route.vias)
    for (const [index, point] of route.route.entries()) {
      if (index !== 3) expect(candidate[0]!.route[index]).toEqual(point)
    }
  }
  expect(first.value).toEqual(firstSnapshot)
  expect(native.value).toEqual(nativeSnapshot)
  expect({ route, node, pad, obstacles, errors }).toEqual(original)
})
