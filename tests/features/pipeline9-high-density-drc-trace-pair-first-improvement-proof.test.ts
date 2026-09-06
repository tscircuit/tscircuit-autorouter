import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import {
  getPipeline9DrcErrors,
  getPipeline9DrcScore,
  type Pipeline9DrcError,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("Pipeline9 native severity acceptance precedes an available exact one-sided repair", (): void => {
  const anchored: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "pair-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -0.3, y: 0, z: 0 },
      { x: 0.3, y: 0, z: 0 },
    ],
    vias: [],
  }
  const movable: HighDensityRoute = {
    ...anchored,
    connectionName: "B",
    rootConnectionName: "B",
    route: [
      { x: -1, y: 1, z: 0 },
      { x: 0, y: 0.05, z: 0 },
      { x: 0, y: 0.5, z: 0 },
      { x: 1, y: 1, z: 0 },
    ],
  }
  const routes = [anchored, movable]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "pair-node",
    center: { x: 0, y: 0 },
    width: 6,
    height: 6,
    availableZ: [0, 1],
    portPoints: routes.flatMap((route) =>
      [route.route[0]!, route.route.at(-1)!].map((point) => ({
        ...point,
        connectionName: route.connectionName,
      })),
    ),
  }
  const connMap = new ConnectivityMap({ A: ["A"], B: ["B"] })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [route.route[0]!, route.route.at(-1)!].map((point) => ({
        x: point.x,
        y: point.y,
        layer: "top",
      })),
    })),
  }
  const evaluator = createPipeline9HighDensityDrcEvaluator({
    connections: srj.connections,
    originalConnections: srj.connections,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    hdRoutes: routes,
    layerCount: 2,
    obstacles: [],
    defaultViaHoleDiameter: 0.15,
    connMap,
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  const original = structuredClone({ routes, node, srj })
  let incumbent = routes
  for (let visit = 0; visit < 2; visit++) {
    const errors = getPipeline9DrcErrors(evaluator, incumbent)
    expect(errors).toHaveLength(1)
    expect(errors[0]!.type).toBe("pcb_trace_error")
    const attempts: {
      family: Pipeline9HighDensityForceFamily
      scale: number
      application: number
    }[] = []
    const observations: {
      family: Pipeline9HighDensityForceFamily
      scale: number
      application: number
      routes: HighDensityRoute[]
      errors: Pipeline9DrcError[]
    }[] = []
    for (const candidate of getPipeline9HighDensityForceCandidates({
      node,
      hdRoutes: incumbent,
      errors,
      traceRouteIndexById: new Map([
        ["A_0", 0],
        ["B_0", 1],
      ]),
      obstacles: [],
      layerCount: 2,
      viaDiameter: 0.3,
      viaHoleDiameter: 0.15,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      connMap,
      forceContext: evaluator.getForceContext(incumbent),
      effort: 1,
      onCandidateAttempted: (family, scale, application): void => {
        attempts.push({ family, scale, application })
      },
    })) {
      observations.push({
        ...attempts.at(-1)!,
        routes: candidate,
        errors: getPipeline9DrcErrors(evaluator, candidate),
      })
    }
    // The production stage publishes the first strict improvement and drops
    // its generator. Enumerate the remaining existing slots only to prove
    // which already-supported repair is missed by that acceptance order.
    const firstAcceptedIndex = observations.findIndex((observation) =>
      isPipeline9HighDensityDrcCandidateBetter(observation.errors, errors),
    )
    expect(firstAcceptedIndex).toBeGreaterThanOrEqual(0)
    const firstAccepted = observations[firstAcceptedIndex]!
    expect(firstAccepted.family).toBe("native")
    expect(firstAccepted.scale).toBe(1)
    expect(firstAccepted.application).toBe(visit === 0 ? 1 : 0)
    expect(firstAccepted.errors).toHaveLength(1)
    expect(getPipeline9DrcScore(firstAccepted.errors)).toBeLessThan(
      getPipeline9DrcScore(errors),
    )
    const oneSidedIndex = observations.findIndex(
      (observation) => observation.family === "trace-pair-1",
    )
    expect(oneSidedIndex).toBeGreaterThan(firstAcceptedIndex)
    const oneSided = observations[oneSidedIndex]!
    expect(oneSided.errors).toHaveLength(0)
    expect(
      isPipeline9HighDensityDrcCandidateBetter(
        oneSided.errors,
        firstAccepted.errors,
      ),
    ).toBe(true)
    expect(oneSided.routes[1]!.route[1]!.y).toBeCloseTo(0.2, 12)
    for (const observation of observations) {
      expect(observation.routes[0]).toEqual(anchored)
      expect(observation.routes[1]!.route[0]).toEqual(movable.route[0])
      expect(observation.routes[1]!.route.at(-1)).toEqual(movable.route.at(-1))
      expect(observation.routes.every((route) => route.vias.length === 0)).toBe(
        true,
      )
    }
    // Revisit only the actually first-accepted incumbent, not the later clean
    // candidate. A single remaining error leaves the error cursor at index 0.
    incumbent = firstAccepted.routes
  }
  expect({ routes, node, srj }).toEqual(original)
})
