import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Pipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import { Pipeline9HighDensityDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityDrcRepairSolver"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type { HighDensityRoute } from "lib/types/high-density-types"

type CandidateEvaluationAccess = {
  evaluateCandidateBoardRoutes: (
    candidateRoutes: HighDensityRoute[],
    candidateKey: string,
  ) => boolean
}

test("Pipeline9 prunes impossible local copper pairs before full DRC without losing remote owner pairs", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "node-a",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const candidateRoute: HighDensityRoute = {
    ...route,
    route: [route.route[0]!, { x: 0, y: 0.1, z: 0 }, route.route[2]!],
  }
  const padA: Pipeline9DrcError = {
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: "A_0",
    pcb_pad_id: "pad-a",
    actual_clearance: 0.05,
    minimum_clearance: 0.1,
  }
  const padB: Pipeline9DrcError = {
    ...padA,
    pcb_pad_id: "pad-b",
    actual_clearance: 0.08,
  }
  const remoteVia: Pipeline9DrcError = {
    type: "pcb_via_trace_clearance_error",
    pcb_trace_id: "A_0",
    pcb_trace_ids: ["A_0", "fixed-B"],
    pcb_via_id: "via_7",
    pcb_via_ids: ["via_7"],
    __via_owner_trace_ids: ["A_0"],
    __trace_segment_owner_trace_id: "fixed-B",
    actual_clearance: 0.05,
    minimum_clearance: 0.1,
  }
  const fullCurrentErrors = [padA, padB, remoteVia]
  const improvedPad = { ...padA, actual_clearance: 0.075 }
  const improvedRemoteVia = {
    ...remoteVia,
    pcb_via_id: "via_2",
    pcb_via_ids: ["via_2"],
    actual_clearance: 0.075,
  }
  const cases: {
    name: string
    localCandidateErrors: Pipeline9DrcError[]
    fullCandidateErrors: Pipeline9DrcError[]
    expectedFullCalls: number
    accepted: boolean
  }[] = [
    {
      name: "a new local pad pair cannot pass the full pair guard",
      localCandidateErrors: [{ ...padA, pcb_pad_id: "pad-c" }],
      fullCandidateErrors: [],
      expectedFullCalls: 0,
      accepted: false,
    },
    {
      name: "fewer local errors cannot compensate for a worse retained pair",
      localCandidateErrors: [{ ...padB, actual_clearance: 0.01 }],
      fullCandidateErrors: [],
      expectedFullCalls: 0,
      accepted: false,
    },
    {
      name: "safe local progress still requires a successful full check",
      localCandidateErrors: [improvedPad],
      fullCandidateErrors: [improvedPad, remoteVia],
      expectedFullCalls: 1,
      accepted: true,
    },
    {
      name: "a full-board rejection overrides apparently safe local progress",
      localCandidateErrors: [improvedPad],
      fullCandidateErrors: fullCurrentErrors,
      expectedFullCalls: 1,
      accepted: false,
    },
    {
      name: "an existing remote via-owner pair is not a new local pair",
      localCandidateErrors: [improvedRemoteVia],
      fullCandidateErrors: [improvedRemoteVia],
      expectedFullCalls: 1,
      accepted: true,
    },
  ]
  for (const scenario of cases) {
    let fullCalls = 0
    let localCalls = 0
    const evaluator: Pipeline9HighDensityDrcEvaluator =
      (): ReturnType<Pipeline9HighDensityDrcEvaluator> => {
        fullCalls++
        return {
          errors: scenario.fullCandidateErrors,
          errorsWithCenters: scenario.fullCandidateErrors,
        }
      }
    evaluator.evaluateLocalCandidate = ({ changedTraceIds }): {
      currentErrors: Pipeline9DrcError[]
      candidateErrors: Pipeline9DrcError[]
    } => {
      localCalls++
      expect([...changedTraceIds], scenario.name).toEqual(["A_0"])
      // The remote conflict belongs to the same mutable via owner, but its
      // old location is not in this scoped baseline. Full identities govern.
      return {
        currentErrors: [padA, padB],
        candidateErrors: scenario.localCandidateErrors,
      }
    }
    const solver = new Pipeline9HighDensityDrcRepairSolver({
      nodePortPoints: [],
      hdRoutes: [route],
      fixedHdRoutes: [],
      newConnections: [
        {
          name: "A",
          pointsToConnect: [
            { x: -1, y: 0, layer: "top" },
            { x: 1, y: 0, layer: "top" },
          ],
        },
      ],
      drcEvaluator: evaluator,
      connMap: new ConnectivityMap({ A: ["A"] }),
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
    solver.currentErrors = fullCurrentErrors
    const access = solver as unknown as CandidateEvaluationAccess
    // Exercise acceptance only; this test never steps a routing search.
    expect(
      access.evaluateCandidateBoardRoutes([candidateRoute], scenario.name),
      scenario.name,
    ).toBe(scenario.accepted)
    expect(localCalls, scenario.name).toBe(1)
    expect(fullCalls, scenario.name).toBe(scenario.expectedFullCalls)
    expect(solver.stats.fullCandidateEvaluationCount, scenario.name).toBe(
      scenario.expectedFullCalls,
    )
    expect(solver.outputHdRoutes[0], scenario.name).toBe(route)
    expect(solver.currentErrors, scenario.name).toBe(fullCurrentErrors)
  }
})
