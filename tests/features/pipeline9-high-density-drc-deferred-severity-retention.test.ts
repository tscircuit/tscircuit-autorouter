import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Pipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import type {
  Pipeline9HighDensityForceFamily,
  Pipeline9HighDensityForceFeedback,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import type { Pipeline9HighDensityForceContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceObstacles"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

type ForceGenerator = Generator<
  HighDensityRoute[],
  void,
  Pipeline9HighDensityForceFeedback
>
type ForceStageAccess = {
  activeForceCandidates: ForceGenerator | null
  activeForceCandidateFeedback: Pipeline9HighDensityForceFeedback
  activeForceFamily: Pipeline9HighDensityForceFamily | undefined
  startNodeRepair: (node: NodeWithPortPoints) => void
}
type ForceTrial = {
  route: HighDensityRoute
  family: Pipeline9HighDensityForceFamily
}
type LocalGateResult = ReturnType<
  NonNullable<Pipeline9HighDensityDrcEvaluator["evaluateLocalCandidate"]>
>
type DrcInput = Parameters<Pipeline9HighDensityDrcEvaluator>[0]
type DrcResult = ReturnType<Pipeline9HighDensityDrcEvaluator>

test("Pipeline9 retains validated severity progress through worse, rejected and duplicate force trials", (): void => {
  // This controlled scheduling fixture isolates pending-candidate ownership and
  // both quality gates. It does not claim these mocked errors occur on a board.
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "pending-force-node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [-1, 1].map((x) => ({
      x,
      y: 0,
      z: 0,
      connectionName: "A",
    })),
  }
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: node.capacityMeshNodeId,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const routes = [route]
  const candidates = [0.01, 0.02, 0.03, 0.04].map(
    (y): HighDensityRoute => ({
      ...route,
      route: route.route.map((point, index) => ({
        ...point,
        y: index === 1 ? y : point.y,
      })),
    }),
  )
  const initial: Pipeline9DrcError = {
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "A_0",
    pcb_pad_id: "pad-a",
    actual_clearance: 0.04,
    minimum_clearance: 0.1,
    center: { x: 0, y: 0 },
  }
  const best = { ...initial, actual_clearance: 0.07 }
  const weaker = { ...initial, actual_clearance: 0.06 }
  const scopedOnly = { ...initial, actual_clearance: 0.08 }
  const worse = { ...initial, actual_clearance: 0.02 }
  const newPair = { ...initial, pcb_pad_id: "pad-b", actual_clearance: 0.09 }
  const forceErrors = [best, weaker, scopedOnly, newPair].map(
    (error, index): Pipeline9DrcError[] => [
      { ...error, center: { x: 0.1 * (index + 1), y: -0.1 } },
    ],
  )
  const fullResults = new Map<number, Pipeline9DrcError[]>([
    [0, [initial]],
    [0.01, [best]],
    [0.02, [weaker]],
    [0.03, [worse]],
  ])
  const localResults = new Map<number, LocalGateResult>(
    [best, weaker, scopedOnly, newPair].map(
      (error, index): [number, LocalGateResult] => [
        candidates[index]!.route[1]!.y,
        {
          currentErrors: [initial],
          candidateErrors: [error],
          candidateForceErrors: forceErrors[index]!,
          candidateErrorPairsAreUnambiguous: true,
        },
      ],
    ),
  )
  const connMap = new ConnectivityMap({ A: ["A", "A_0"] })
  const fullCalls: number[] = []
  const localCalls: number[] = []
  const evaluator: Pipeline9HighDensityDrcEvaluator = Object.assign(
    ({ hdRoutes }: DrcInput): DrcResult => {
      if (!hdRoutes || hdRoutes.length !== 1) {
        throw new Error("The pending-candidate test requires exactly one route")
      }
      const key = hdRoutes[0]!.route[1]!.y
      const errors = fullResults.get(key)
      if (!errors) throw new Error(`Unexpected full evaluation: ${key}`)
      fullCalls.push(key)
      return {
        errors: structuredClone(errors),
        errorsWithCenters: structuredClone(errors),
      }
    },
    {
      getForceContext: (): Pipeline9HighDensityForceContext => ({
        connMap,
        obstacles: [],
      }),
    },
  )
  evaluator.evaluateLocalCandidate = ({
    currentRoutes,
    candidateRoutes,
    changedTraceIds,
  }): LocalGateResult => {
    expect(currentRoutes).toBe(routes)
    expect(changedTraceIds).toEqual(new Set(["A_0"]))
    const key = candidateRoutes[0]!.route[1]!.y
    const result = localResults.get(key)
    if (!result) throw new Error(`Unexpected scoped evaluation: ${key}`)
    localCalls.push(key)
    return structuredClone(result)
  }
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: [node],
    hdRoutes: routes,
    fixedHdRoutes: [],
    newConnections: [
      {
        name: "A",
        pointsToConnect: node.portPoints.map((point) => ({
          x: point.x,
          y: point.y,
          layer: "top",
        })),
      },
    ],
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
  const trials: ForceTrial[] = [
    { route: candidates[0]!, family: "native-feedback" },
    { route: candidates[1]!, family: "native" },
    { route: candidates[2]!, family: "pad-wire" },
    { route: candidates[3]!, family: "trace-pair-0" },
    // Revisiting identical geometry must not turn the transient accepted slot
    // into a stale fast-path publication or overwrite its original family.
    { route: structuredClone(candidates[0]!), family: "native" },
  ]
  const received: Pipeline9HighDensityForceFeedback[] = []
  const generator = (function* (): ForceGenerator {
    for (const trial of trials) {
      access.activeForceFamily = trial.family
      yield [trial.route]
    }
  })()
  const next = generator.next.bind(generator)
  generator.next = (
    feedback?: Pipeline9HighDensityForceFeedback,
  ): IteratorResult<HighDensityRoute[], void> => {
    received.push(feedback)
    return next(feedback)
  }
  const original = structuredClone({ node, routes, candidates, forceErrors })
  solver.step()
  access.startNodeRepair(node)
  access.activeForceCandidates = generator
  for (let trialIndex = 0; trialIndex < trials.length; trialIndex++) {
    solver.step()
    expect(solver.outputHdRoutes).toBe(routes)
    expect(solver.currentErrors).toEqual([initial])
    expect(solver.stats.acceptedRepairCount).toBe(0)
    expect(access.activeForceCandidates).toBe(generator)
    expect(access.activeForceCandidateFeedback).toEqual(
      trialIndex < forceErrors.length
        ? { errors: forceErrors[trialIndex]! }
        : undefined,
    )
  }
  expect(localCalls).toEqual([0.01, 0.02, 0.03, 0.04])
  expect(fullCalls).toEqual([0, 0.01, 0.02, 0.03])
  expect(solver.stats.duplicateCandidateCount).toBe(1)
  solver.step()
  expect(received).toEqual([
    undefined,
    ...forceErrors.map((errors) => ({ errors })),
    undefined,
  ])
  expect(solver.outputHdRoutes).toEqual([candidates[0]])
  expect(solver.currentErrors).toEqual([best])
  expect(solver.stats.acceptedRepairCount).toBe(1)
  expect(solver.stats.acceptedForceRepairCount).toBe(1)
  expect(solver.stats.acceptedForceFeedbackRepairCount).toBe(1)
  expect(solver.stats.acceptedSeverityOnlyRepairCount).toBe(1)
  expect(solver.stats.acceptedDrcCountReducingRepairCount).toBe(0)
  expect(solver.stats.acceptedSeamForceRepairCount).toBe(0)
  expect(solver.stats.acceptedRerouteRepairCount).toBe(0)
  expect(solver.stats.nodeRepairAttemptCount).toBe(1)
  expect(solver.activeSubSolver).toBeNull()
  expect(access.activeForceCandidates).toBeNull()
  expect(access.activeForceCandidateFeedback).toBeUndefined()
  expect({ node, routes, candidates, forceErrors }).toEqual(original)
})
