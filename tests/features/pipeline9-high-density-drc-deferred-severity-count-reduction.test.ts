import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  createPipeline9HighDensityDrcEvaluator,
  type Pipeline9HighDensityDrcEvaluator,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
  type Pipeline9HighDensityForceFeedback,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
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

type ForceGenerator = Generator<
  HighDensityRoute[],
  void,
  Pipeline9HighDensityForceFeedback
>
type ForceStageAccess = {
  activeForceCandidates: ForceGenerator | null
  activeForceFamily: Pipeline9HighDensityForceFamily | undefined
  startNodeRepair: (node: NodeWithPortPoints) => void
}
type ForceObservation = {
  family: Pipeline9HighDensityForceFamily
  routes: HighDensityRoute[]
  errors: Pipeline9DrcError[]
}
type DrcInput = Parameters<Pipeline9HighDensityDrcEvaluator>[0]
type DrcResult = ReturnType<Pipeline9HighDensityDrcEvaluator>
type LocalGateResult = ReturnType<
  NonNullable<Pipeline9HighDensityDrcEvaluator["evaluateLocalCandidate"]>
>

test("Pipeline9 examines a later existing force candidate before publishing a severity-only improvement", (): void => {
  // This is deliberately synthetic scheduling, not a captured SRJ21 sample2
  // node. Both candidate geometries come from the real force generator and
  // are checked by the official evaluator; only their two-slot order changes.
  const anchored: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "deferred-pair-node",
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
    capacityMeshNodeId: "deferred-pair-node",
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
  const nativeEvaluator = createPipeline9HighDensityDrcEvaluator({
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
  const errors = getPipeline9DrcErrors(nativeEvaluator, routes)
  expect(errors).toHaveLength(1)
  expect(errors[0]!.type).toBe("pcb_trace_error")
  let attemptedFamily: Pipeline9HighDensityForceFamily | undefined
  const observations: ForceObservation[] = []
  for (const candidate of getPipeline9HighDensityForceCandidates({
    node,
    hdRoutes: routes,
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
    forceContext: nativeEvaluator.getForceContext(routes),
    effort: 1,
    onCandidateAttempted: (family): void => {
      attemptedFamily = family
    },
  })) {
    if (attemptedFamily === undefined) {
      throw new Error("A published force candidate requires its source family")
    }
    observations.push({
      family: attemptedFamily,
      routes: candidate,
      errors: getPipeline9DrcErrors(nativeEvaluator, candidate),
    })
  }
  const severity = observations.find(
    (observation) =>
      observation.family === "native" &&
      observation.errors.length === errors.length &&
      isPipeline9HighDensityDrcCandidateBetter(observation.errors, errors),
  )
  const clean = observations.find(
    (observation) =>
      observation.family === "trace-pair-1" && observation.errors.length === 0,
  )
  if (!severity || !clean) {
    throw new Error("The real force fixture must provide both distinct repairs")
  }
  const orderedCandidates: ForceObservation[] = [severity, clean]
  expect(getPipeline9DrcScore(severity.errors)).toBeLessThan(
    getPipeline9DrcScore(errors),
  )
  expect(
    isPipeline9HighDensityDrcCandidateBetter(clean.errors, severity.errors),
  ).toBe(true)
  const fullCalls: HighDensityRoute[][] = []
  const localCalls: LocalGateResult[] = []
  const evaluator: Pipeline9HighDensityDrcEvaluator = Object.assign(
    (input: DrcInput): DrcResult => {
      if (!input.hdRoutes) throw new Error("The stage must evaluate HD routes")
      fullCalls.push(input.hdRoutes)
      return nativeEvaluator(input)
    },
    nativeEvaluator,
  )
  const nativeLocalEvaluator = nativeEvaluator.evaluateLocalCandidate
  if (!nativeLocalEvaluator) {
    throw new Error("The official stage fixture requires its scoped evaluator")
  }
  evaluator.evaluateLocalCandidate = (input): LocalGateResult => {
    expect(input.currentRoutes).toBe(routes)
    const result = nativeLocalEvaluator(input)
    localCalls.push(result)
    return result
  }
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: [node],
    hdRoutes: routes,
    fixedHdRoutes: [],
    newConnections: srj.connections,
    drcEvaluator: evaluator,
    connMap,
    colorMap: {},
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    drcClearance: 0.1,
    effort: 1,
  })
  const access = solver as unknown as ForceStageAccess
  const visitedFamilies: Pipeline9HighDensityForceFamily[] = []
  solver.step()
  access.startNodeRepair(node)
  access.activeForceCandidates = (function* (): ForceGenerator {
    for (const observation of orderedCandidates) {
      access.activeForceFamily = observation.family
      visitedFamilies.push(observation.family)
      yield observation.routes
    }
    throw new Error("The count-reducing candidate must publish immediately")
  })()
  solver.step()
  expect(visitedFamilies).toEqual(["native"])
  expect(localCalls).toHaveLength(1)
  expect(fullCalls).toHaveLength(2)
  expect(solver.outputHdRoutes).toBe(routes)
  expect(solver.currentErrors).toEqual(errors)
  expect(solver.stats.acceptedRepairCount).toBe(0)
  expect(access.activeForceCandidates).not.toBeNull()
  solver.step()
  expect(visitedFamilies).toEqual(["native", "trace-pair-1"])
  expect(localCalls).toHaveLength(2)
  expect(fullCalls).toHaveLength(3)
  expect(solver.currentErrors).toEqual([])
  expect(solver.outputHdRoutes).toEqual(clean.routes)
  expect(solver.outputHdRoutes[0]).toBe(anchored)
  expect(solver.outputHdRoutes[1]!.route[0]).toEqual(movable.route[0])
  expect(solver.outputHdRoutes[1]!.route.at(-1)).toEqual(movable.route.at(-1))
  expect(solver.stats.acceptedRepairCount).toBe(1)
  expect(solver.stats.acceptedDrcCountReducingRepairCount).toBe(1)
  expect(solver.stats.acceptedSeverityOnlyRepairCount).toBe(0)
  expect(solver.stats.nodeRepairAttemptCount).toBe(1)
  expect(access.activeForceCandidates).toBeNull()
  expect({ routes, node, srj }).toEqual(original)
})
