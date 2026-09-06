import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Pipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import type { Pipeline9HighDensityForceFeedback } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
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
  startNodeRepair: (node: NodeWithPortPoints) => void
}
type LocalGateResult = ReturnType<
  NonNullable<Pipeline9HighDensityDrcEvaluator["evaluateLocalCandidate"]>
>
type DrcInput = Parameters<Pipeline9HighDensityDrcEvaluator>[0]
type DrcResult = ReturnType<Pipeline9HighDensityDrcEvaluator>

test("Pipeline9 returns rejected candidate feedback only to its active force generator without bypassing DRC gates", (): void => {
  const nodes: NodeWithPortPoints[] = ["A", "B"].map(
    (connectionName, index): NodeWithPortPoints => ({
      capacityMeshNodeId: `node-${connectionName}`,
      center: { x: index * 4, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [-1, 1].map((offset) => ({
        x: index * 4 + offset,
        y: 0,
        z: 0,
        connectionName,
      })),
    }),
  )
  const routes: HighDensityRoute[] = nodes.map(
    (node): HighDensityRoute => ({
      connectionName: node.portPoints[0]!.connectionName,
      rootConnectionName: node.portPoints[0]!.connectionName,
      regionId: node.capacityMeshNodeId,
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { ...node.portPoints[0]! },
        { ...node.center, z: 0 },
        { ...node.portPoints[1]! },
      ],
      vias: [],
    }),
  )
  const candidatesA = [0.01, 0.02, 0.03].map(
    (y): HighDensityRoute => ({
      ...routes[0]!,
      route: routes[0]!.route.map((point, index) => ({
        ...point,
        y: index === 1 ? y : point.y,
      })),
    }),
  )
  const candidatesB = [0.01, 0.02].map(
    (y): HighDensityRoute => ({
      ...routes[1]!,
      route: routes[1]!.route.map((point, index) => ({
        ...point,
        y: index === 1 ? y : point.y,
      })),
    }),
  )
  const padA: Pipeline9DrcError = {
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "A_0",
    pcb_pad_id: "pad-a",
    actual_clearance: 0.05,
    minimum_clearance: 0.1,
    center: { x: 0, y: 0 },
  }
  const padB: Pipeline9DrcError = {
    ...padA,
    pcb_trace_id: "B_0",
    pcb_pad_id: "pad-b",
    center: { x: 4, y: 0 },
  }
  const worseA = { ...padA, actual_clearance: 0.04 }
  const improvedA = { ...padA, actual_clearance: 0.075 }
  const worseB = { ...padB, actual_clearance: 0.04 }
  // Force feedback is a separate exact-location representation, not the
  // quality gate's array or a successful-publication signal.
  const forceScopedA = [{ ...worseA, center: { x: 0.2, y: -0.1 } }]
  const forceFullA = [{ ...improvedA, center: { x: 0.3, y: -0.1 } }]
  const forceScopedB = [{ ...worseB, center: { x: 4.2, y: -0.1 } }]
  const fullResults = new Map<string, Pipeline9DrcError[]>([
    ["0,0", [padA, padB]],
    ["0.02,0", [padA, padB]],
    ["0.03,0", [padB]],
    ["0.03,0.02", []],
  ])
  const localResults = new Map<string, LocalGateResult>([
    [
      "A_0:0.01",
      {
        currentErrors: [padA],
        candidateErrors: [worseA],
        candidateForceErrors: forceScopedA,
        candidateErrorPairsAreUnambiguous: true,
      },
    ],
    [
      "A_0:0.02",
      {
        currentErrors: [padA],
        candidateErrors: [improvedA],
        candidateForceErrors: forceFullA,
        candidateErrorPairsAreUnambiguous: true,
      },
    ],
    [
      "A_0:0.03",
      {
        currentErrors: [padA],
        candidateErrors: [],
        candidateForceErrors: [],
        candidateErrorPairsAreUnambiguous: true,
      },
    ],
    [
      "B_0:0.01",
      {
        currentErrors: [padB],
        candidateErrors: [worseB],
        candidateForceErrors: forceScopedB,
        candidateErrorPairsAreUnambiguous: true,
      },
    ],
    [
      "B_0:0.02",
      {
        currentErrors: [padB],
        candidateErrors: [],
        candidateForceErrors: [],
        candidateErrorPairsAreUnambiguous: true,
      },
    ],
  ])
  const connMap = new ConnectivityMap({
    A: ["A", "A_0"],
    B: ["B", "B_0"],
  })
  const fullCalls: string[] = []
  const localCalls: string[] = []
  const evaluator: Pipeline9HighDensityDrcEvaluator = Object.assign(
    ({ hdRoutes }: DrcInput): DrcResult => {
      if (!hdRoutes) throw new Error("The handoff test requires HD routes")
      const key = hdRoutes.map((route) => route.route[1]!.y).join(",")
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
    candidateRoutes,
    changedTraceIds,
  }): LocalGateResult => {
    expect(changedTraceIds.size).toBe(1)
    const traceId = [...changedTraceIds][0]!
    const route = candidateRoutes.find(
      (candidate) => `${candidate.connectionName}_0` === traceId,
    )
    if (!route) throw new Error("The changed force route must exist")
    const key = `${traceId}:${route.route[1]!.y}`
    const result = localResults.get(key)
    if (!result) throw new Error(`Unexpected scoped evaluation: ${key}`)
    localCalls.push(key)
    return structuredClone(result)
  }
  const solver = new Pipeline9HighDensityDrcRepairSolver({
    nodePortPoints: nodes,
    hdRoutes: routes,
    fixedHdRoutes: [],
    newConnections: nodes.map((node) => ({
      name: node.portPoints[0]!.connectionName,
      pointsToConnect: node.portPoints.map((point) => ({
        x: point.x,
        y: point.y,
        layer: "top",
      })),
    })),
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
  const controlledGenerator = (
    candidates: HighDensityRoute[],
    received: Pipeline9HighDensityForceFeedback[],
  ): ForceGenerator => {
    const generator = (function* (): ForceGenerator {
      for (const candidate of candidates) yield [candidate]
      throw new Error("An accepted or restarted generator must not resume")
    })()
    const next = generator.next.bind(generator)
    // Observe the first .next argument too: native generators ignore that
    // argument before their first yield, which could hide stale feedback.
    generator.next = (
      feedback?: Pipeline9HighDensityForceFeedback,
    ): IteratorResult<HighDensityRoute[], void> => {
      received.push(feedback)
      return next(feedback)
    }
    return generator
  }
  const original = structuredClone({ nodes, routes, localResults, fullResults })
  solver.step()
  expect(fullCalls).toEqual(["0,0"])
  access.startNodeRepair(nodes[0]!)
  const receivedA: Pipeline9HighDensityForceFeedback[] = []
  access.activeForceCandidates = controlledGenerator(candidatesA, receivedA)
  solver.step()
  expect(receivedA).toEqual([undefined])
  expect(access.activeForceCandidateFeedback).toEqual({ errors: forceScopedA })
  expect(localCalls).toEqual(["A_0:0.01"])
  expect(fullCalls).toEqual(["0,0"])
  expect(solver.outputHdRoutes).toBe(routes)
  expect(solver.currentErrors).toEqual([padA, padB])
  expect(solver.stats.acceptedRepairCount).toBe(0)
  solver.step()
  expect(receivedA).toEqual([undefined, { errors: forceScopedA }])
  expect(access.activeForceCandidateFeedback).toEqual({ errors: forceFullA })
  expect(fullCalls).toEqual(["0,0", "0.02,0"])
  expect(solver.outputHdRoutes).toBe(routes)
  expect(solver.currentErrors).toEqual([padA, padB])
  expect(solver.stats.acceptedRepairCount).toBe(0)
  solver.step()
  expect(receivedA).toEqual([
    undefined,
    { errors: forceScopedA },
    { errors: forceFullA },
  ])
  expect(solver.outputHdRoutes[0]).toEqual(candidatesA[2])
  expect(solver.outputHdRoutes[1]).toBe(routes[1])
  expect(solver.currentErrors).toEqual([padB])
  expect(solver.stats.acceptedRepairCount).toBe(1)
  expect(access.activeForceCandidates).toBeNull()
  expect(access.activeForceCandidateFeedback).toBeUndefined()
  access.startNodeRepair(nodes[1]!)
  const receivedB: Pipeline9HighDensityForceFeedback[] = []
  access.activeForceCandidates = controlledGenerator(
    [candidatesB[0]!],
    receivedB,
  )
  solver.step()
  expect(receivedB).toEqual([undefined])
  expect(access.activeForceCandidateFeedback).toEqual({ errors: forceScopedB })
  expect(solver.outputHdRoutes[1]).toBe(routes[1])
  expect(solver.currentErrors).toEqual([padB])
  // Restart while actual rejected-candidate feedback is still pending. It
  // belongs to the abandoned search, never the replacement generator.
  access.startNodeRepair(nodes[1]!)
  expect(access.activeForceCandidateFeedback).toBeUndefined()
  const receivedRestart: Pipeline9HighDensityForceFeedback[] = []
  access.activeForceCandidates = controlledGenerator(
    [candidatesB[1]!],
    receivedRestart,
  )
  solver.step()
  expect(receivedRestart).toEqual([undefined])
  expect(receivedB).toEqual([undefined])
  expect(solver.outputHdRoutes[1]).toEqual(candidatesB[1])
  expect(solver.currentErrors).toEqual([])
  expect(access.activeForceCandidateFeedback).toBeUndefined()
  expect(solver.stats.acceptedForceRepairCount).toBe(2)
  expect(solver.stats.localCandidateEvaluationCount).toBe(5)
  expect(solver.stats.fullCandidateEvaluationCount).toBe(3)
  expect(fullCalls).toEqual(["0,0", "0.02,0", "0.03,0", "0.03,0.02"])
  expect(localCalls).toEqual([
    "A_0:0.01",
    "A_0:0.02",
    "A_0:0.03",
    "B_0:0.01",
    "B_0:0.02",
  ])
  solver.step()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect({ nodes, routes, localResults, fullResults }).toEqual(original)
})
