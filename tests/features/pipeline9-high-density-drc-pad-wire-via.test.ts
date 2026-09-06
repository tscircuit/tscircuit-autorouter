import { expect, test } from "bun:test"
import {
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
  MAX_ERROR_MOVE,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import {
  getPipeline9DrcErrors,
  type Pipeline9DrcError,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

type CapturedRoute = Omit<HighDensityRoute, "route"> & {
  route: (HighDensityRoute["route"][number] & Partial<PortPoint>)[]
}

test("Pipeline9 repairs sample9 pad clearance without displacing either via", (): void => {
  // Captured before Pipeline9's new HD stage in SRJ18 sample9, cmn4. The
  // nearby net36 wire is immutable during the target net21 fragment's force.
  const targetName = "source_trace_21__source_net_21_mst1"
  const fixedName = "source_trace_36__source_net_36_mst36"
  const route: CapturedRoute = {
    connectionName: targetName,
    rootConnectionName: "source_trace_21",
    regionId: "cmn_4__sub_0_0",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      {
        portPointId: "ce317_pp0_z0::0",
        x: -16.2,
        y: -5.624,
        z: 0,
        connectionName: targetName,
        rootConnectionName: "connectivity_net50",
        nextPortPointId: "ce358_pp0_z0::0",
      },
      { x: -16.098, y: -5.547, z: 0 },
      { x: -16.049, y: -5.345, z: 0 },
      { x: -16.049, y: -5.345, z: 1 },
      { x: -15.933, y: -5.445, z: 1 },
      { x: -15.794, y: -5.537, z: 1 },
      { x: -15.688, y: -5.563, z: 1 },
      { x: -15.586, y: -5.57, z: 1 },
      { x: -15.485, y: -5.572, z: 1 },
      { x: -15.386, y: -5.569, z: 1 },
      { x: -15.289, y: -5.56, z: 1 },
      { x: -15.196, y: -5.526, z: 1 },
      { x: -15.126, y: -5.489, z: 1 },
      { x: -15.126, y: -5.489, z: 0 },
      { x: -15.076, y: -5.547, z: 0 },
      {
        portPointId: "ce358_pp0_z0::0",
        x: -15.075,
        y: -5.649,
        z: 0,
        connectionName: targetName,
        rootConnectionName: "connectivity_net50",
        prevPortPointId: "ce317_pp0_z0::0",
      },
    ],
    vias: [
      { x: -16.049, y: -5.345 },
      { x: -15.126, y: -5.489 },
    ],
  }
  const fixedRoute: HighDensityRoute = {
    connectionName: fixedName,
    rootConnectionName: "source_trace_36",
    regionId: "cmn_4__sub_0_0",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -16.2, y: -4.749, z: 0 },
      { x: -16.2, y: -4.836, z: 0 },
      { x: -16.079, y: -4.907, z: 0 },
      { x: -15.963, y: -4.95, z: 0 },
      { x: -15.848, y: -4.993, z: 0 },
      { x: -15.774, y: -5.05, z: 0 },
      { x: -15.7, y: -5.139, z: 0 },
      { x: -15.659, y: -5.235, z: 0 },
      { x: -15.644, y: -5.341, z: 0 },
      { x: -15.653, y: -5.451, z: 0 },
      { x: -15.689, y: -5.547, z: 0 },
      { x: -15.788, y: -5.649, z: 0 },
    ],
    vias: [],
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_4__sub_0_0",
    center: { x: -11.9605, y: -1.8360000000000012 },
    width: 8.479,
    height: 7.6259999999999994,
    availableZ: [0, 1, 2, 3],
    portPoints: [
      {
        ...route.route[0]!,
        x: -16.200000000000003,
        y: -5.6240000000000006,
        connectionName: targetName,
      },
      { ...route.route.at(-1)!, connectionName: targetName },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -18, maxX: -7, minY: -7, maxY: 3 },
    connections: [
      ...[route, fixedRoute].map((fragment) => ({
        name: fragment.connectionName,
        pointsToConnect: [fragment.route[0]!, fragment.route.at(-1)!].map(
          (point) => ({ x: point.x, y: point.y, layer: "top" }),
        ),
      })),
      {
        name: "pad123-owner",
        pointsToConnect: [
          {
            x: -16.8,
            y: -5.249,
            layer: "top",
            pcb_port_id: "pcb_port_123",
          },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: -16.8, y: -5.249 },
        width: 1.2,
        height: 0.3,
        layers: ["top"],
        connectedTo: ["pad123-owner", "pcb_port_123"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_123",
          pcb_port_id: "pcb_port_123",
        },
      },
    ],
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(srj)
  const boardRoutes = [route, fixedRoute]
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: srj.connections.slice(0, 2),
    originalConnections: srj.connections,
    hdRoutes: boardRoutes,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    originalSrj: srj,
    srjWithPointPairs: srj,
    layerCount: 4,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
  })
  const errors = getPipeline9DrcErrors(evaluator, boardRoutes)
  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_pad_id: "pcb_smtpad_123",
    pcb_trace_id: `${targetName}_0`,
  })
  expect(errors[0]!.actual_clearance).toBeCloseTo(0.08401448724426523, 12)
  const original = structuredClone({ boardRoutes, node, srj, errors })
  const attempts: {
    family: Pipeline9HighDensityForceFamily
    scale: number
    application: number
  }[] = []
  const observations: {
    family: Pipeline9HighDensityForceFamily
    scale: number
    application: number
    candidate: HighDensityRoute
    errors: Pipeline9DrcError[]
  }[] = []
  const attemptedErrors: number[] = []
  for (const candidate of getPipeline9HighDensityForceCandidates({
    node,
    hdRoutes: [route],
    errors,
    traceRouteIndexById: new Map([[`${targetName}_0`, 0]]),
    obstacles: srj.obstacles,
    layerCount: 4,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    connMap,
    forceContext: evaluator.getForceContext(boardRoutes),
    effort: 1,
    onErrorAttempted: (index): void => {
      attemptedErrors.push(index)
    },
    onCandidateAttempted: (family, scale, application): void => {
      attempts.push({ family, scale, application })
    },
  })) {
    const attempt = attempts.at(-1)!
    observations.push({
      ...attempt,
      candidate: candidate[0]!,
      errors: getPipeline9DrcErrors(evaluator, [candidate[0]!, fixedRoute]),
    })
  }
  expect(attemptedErrors).toEqual([0])
  const first = observations[0]!
  expect(first.family).toBe("pad-wire")
  expect(first.errors).toHaveLength(0)
  expect(
    isPipeline9HighDensityDrcCandidateBetter(first.errors, errors),
  ).toBeTrue()
  for (const observation of observations) {
    if (observation.family !== "pad-wire") continue
    expect(observation.candidate.vias).toEqual(route.vias)
    expect(observation.candidate.route).toHaveLength(route.route.length)
    for (const [index, point] of route.route.entries()) {
      // Only the one free endpoint of the offending top-layer segment moves.
      if (index !== 1) {
        expect(observation.candidate.route[index]).toEqual(point)
      }
    }
  }
  const firstScale = getForceScalesForEffort(1)[0]
  const firstScaleTrials = observations.filter(
    (observation) => observation.scale === firstScale,
  )
  expect(firstScaleTrials.map((observation) => observation.family)).toEqual([
    "pad-wire",
    "native",
    "pad-wire",
  ])
  const firstWire = firstScaleTrials[0]!.candidate
  const native = firstScaleTrials[1]!.candidate
  const secondWire = firstScaleTrials[2]!.candidate
  expect(firstWire.route[1]!.x).toBeGreaterThan(route.route[1]!.x)
  expect(secondWire.route[1]!.x).toBeGreaterThan(firstWire.route[1]!.x)
  // The native family's incidental via motion never leaks into the next
  // cumulative wire-only trial. Each family starts from its own incumbent.
  const originalVia = route.vias[0]!
  const padCenter = srj.obstacles[0]!.center
  const viaDistance = Math.hypot(
    originalVia.x - padCenter.x,
    originalVia.y - padCenter.y,
  )
  expect(native.vias[0]!.x).toBeCloseTo(
    originalVia.x +
      ((originalVia.x - padCenter.x) / viaDistance) * MAX_ERROR_MOVE,
    12,
  )
  expect(secondWire.vias).toEqual(route.vias)
  for (const scale of getForceScalesForEffort(1)) {
    const scaleAttempts = attempts.filter((attempt) => attempt.scale === scale)
    expect(scaleAttempts.length).toBeLessThanOrEqual(
      getMaxTargetedCandidateAttemptsForEffort(1),
    )
    expect(scaleAttempts.map((attempt) => attempt.application)).toEqual([
      0,
      1,
      2,
    ])
    expect(scaleAttempts.map((attempt) => attempt.family)).toEqual([
      "pad-wire",
      "native",
      "pad-wire",
    ])
  }
  expect({ boardRoutes, node, srj, errors }).toEqual(original)
})
