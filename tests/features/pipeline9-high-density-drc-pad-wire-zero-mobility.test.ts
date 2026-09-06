import { expect, test } from "bun:test"
import { checkPadTraceClearance } from "@tscircuit/checks"
import type { PcbTrace } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import {
  applyPipeline9PadTraceForce,
  getPipeline9PadTraceForceMobility,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9PadTraceForce"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceCandidateParams,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { getPipeline9PadCopperForceTarget } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PadCopperForceTarget"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"

test("Pipeline9 keeps the native-only schedule when the pad witness is a locked endpoint", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "pad-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 2, z: 0 },
    ],
    vias: [],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "pad-node",
    center: { x: 2, y: 0 },
    width: 6,
    height: 6,
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
    x: -0.12,
    y: 0,
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
      layer: "top",
    })),
  }
  const errors = checkPadTraceClearance([trace, pad], {
    connMap,
    minClearance: 0.1,
  })
  expect(errors).toHaveLength(1)
  const target = getPipeline9PadCopperForceTarget({
    pad,
    route,
    obstacles,
    layerCount: 2,
  })!
  expect(target.tracePoint).toEqual({ x: 0, y: 0 })
  expect(
    getPipeline9PadTraceForceMobility({
      route,
      target,
      protectedPointIndexes: new Set(),
    }),
  ).toEqual({ pointIndexes: [1], contactWeight: 0 })
  const original = structuredClone({ route, node, pad, obstacles, errors })
  expect(
    applyPipeline9PadTraceForce({
      route,
      target,
      protectedPointIndexes: new Set(),
      minimumClearance: errors[0]!.minimum_clearance,
      scale: 1,
    }),
  ).toBe(false)
  const attempts: {
    family: Pipeline9HighDensityForceFamily
    scale: number
    application: number
  }[] = []
  const attemptedErrors: number[] = []
  const params: Pipeline9HighDensityForceCandidateParams = {
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
    onErrorAttempted: (errorIndex): void => {
      attemptedErrors.push(errorIndex)
    },
  }
  for (const candidate of getPipeline9HighDensityForceCandidates(params)) {
    expect(candidate[0]!.route[0]).toEqual(route.route[0])
    expect(candidate[0]!.route.at(-1)).toEqual(route.route.at(-1))
  }
  expect(attemptedErrors).toEqual([0])
  expect(attempts.length).toBeGreaterThan(0)
  expect(attempts.every((attempt) => attempt.family === "native")).toBe(true)
  expect(attempts.length).toBeLessThanOrEqual(
    getForceScalesForEffort(1).length *
      getMaxTargetedCandidateAttemptsForEffort(1),
  )
  const movablePad = { ...pad, x: 0.4, y: -0.12 }
  const movableObstacles = obstacles.map((obstacle) => ({
    ...obstacle,
    center: { x: movablePad.x, y: movablePad.y },
  }))
  const movableErrors = checkPadTraceClearance([trace, movablePad], {
    connMap,
    minClearance: 0.1,
  })
  expect(movableErrors).toHaveLength(1)
  for (const invalid of [undefined, Number.NaN, Infinity, -0.1]) {
    const malformed = getPipeline9HighDensityForceCandidates({
      ...params,
      errors: movableErrors.map((error) => ({
        ...error,
        minimum_clearance: invalid,
        __pad_ids: [pad.pcb_smtpad_id],
        __pad_copper: [movablePad],
      })),
      obstacles: movableObstacles,
      forceContext: { connMap, obstacles: movableObstacles },
    })
    expect(() => malformed.next()).toThrow(
      "Pipeline9 pad-wire target requires an official clearance",
    )
  }
  expect({ route, node, pad, obstacles, errors }).toEqual(original)
})
