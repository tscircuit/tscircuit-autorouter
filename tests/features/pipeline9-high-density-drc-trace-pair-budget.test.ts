import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  BROAD_MAX_MOVE,
  CLEARANCE_SLACK,
  getForceScalesForEffort,
  getMaxTargetedCandidateAttemptsForEffort,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceFamily,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("Pipeline9 trace-pair slots preserve the native chain and advance only the original error cursor", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "A",
      rootConnectionName: "A",
      regionId: "pair-node",
      traceThickness: 0.4,
      viaDiameter: 0.6,
      route: [
        { x: -4, y: -2, z: 0 },
        { x: -1, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 4, y: -2, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "B",
      rootConnectionName: "B",
      regionId: "pair-node",
      traceThickness: 0.4,
      viaDiameter: 0.6,
      route: [
        { x: -4, y: 2, z: 0 },
        { x: -1, y: 0.01, z: 0 },
        { x: 1, y: 0.01, z: 0 },
        { x: 4, y: 2, z: 0 },
      ],
      vias: [],
    },
  ]
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "pair-node",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: routes.flatMap((route) =>
      [route.route[0]!, route.route.at(-1)!].map((point) => ({
        ...point,
        connectionName: route.connectionName,
      })),
    ),
  }
  // Two original target records deliberately exercise the cursor independently
  // of how many private candidate families are attempted for the same pair.
  const errors: Pipeline9DrcError[] = ["first", "second"].map((id) => ({
    type: "pcb_trace_error",
    pcb_trace_error_id: id,
    pcb_trace_id: "A_0",
    pcb_trace_ids: ["A_0", "B_0"],
    center: { x: 0, y: 0 },
    minimum_clearance: 0.1,
  }))
  const connMap = new ConnectivityMap({ A: ["A", "A_0"], B: ["B", "B_0"] })
  const original = structuredClone({ routes, node, errors })
  for (const effort of [1, 2]) {
    const scales = getForceScalesForEffort(effort)
    const maxApplications = getMaxTargetedCandidateAttemptsForEffort(effort)
    // Even moving both contact endpoints by the maximum on every application
    // cannot clear this deep overlap within one scale. Every native slot must
    // therefore run; no-motion exhaustion remains valid for other geometry.
    expect(0.01 + 2 * BROAD_MAX_MOVE * maxApplications).toBeLessThan(
      0.4 + 0.1 + CLEARANCE_SLACK,
    )
    const attemptedErrors: number[] = []
    const attempts: {
      errorIndex: number
      family: Pipeline9HighDensityForceFamily
      scale: number
      application: number
    }[] = []
    const candidatesByFamily = new Map<
      Pipeline9HighDensityForceFamily,
      HighDensityRoute[][]
    >()
    const candidates = getPipeline9HighDensityForceCandidates({
      node,
      hdRoutes: routes,
      errors,
      traceRouteIndexById: new Map([
        ["A_0", 0],
        ["B_0", 1],
      ]),
      obstacles: [],
      layerCount: 2,
      viaDiameter: 0.6,
      viaHoleDiameter: 0.3,
      traceWidth: 0.4,
      obstacleMargin: 0.15,
      connMap,
      forceContext: { connMap, obstacles: [] },
      effort,
      onErrorAttempted: (errorIndex): void => {
        attemptedErrors.push(errorIndex)
      },
      onCandidateAttempted: (family, scale, application): void => {
        attempts.push({
          errorIndex: attemptedErrors.at(-1)!,
          family,
          scale,
          application,
        })
      },
    })
    for (const candidate of candidates) {
      const family = attempts.at(-1)!.family
      const previousCandidates = candidatesByFamily.get(family)
      if (previousCandidates) previousCandidates.push(candidate)
      else candidatesByFamily.set(family, [candidate])
    }
    expect(attemptedErrors).toEqual([0, 1])
    for (const errorIndex of [0, 1]) {
      const targetAttempts = attempts.filter(
        (attempt) => attempt.errorIndex === errorIndex,
      )
      expect(targetAttempts).toEqual(
        scales.flatMap((scale, scaleIndex) =>
          Array.from({ length: maxApplications }, (_, application) => ({
            errorIndex,
            family:
              scaleIndex === 1 && application < 2
                ? application === 0
                  ? "trace-pair-0"
                  : "trace-pair-1"
                : "native",
            scale,
            application,
          })),
        ),
      )
    }
    expect(attempts).toHaveLength(
      errors.length * scales.length * maxApplications,
    )
    for (const [family, candidates] of candidatesByFamily) {
      if (family === "native") continue
      expect(candidates).toHaveLength(errors.length)
      const stationaryIndex = family === "trace-pair-0" ? 1 : 0
      for (const candidate of candidates) {
        // Each side starts from the incumbent, never the other side's move.
        expect(candidate[stationaryIndex]).toEqual(routes[stationaryIndex])
        for (const [index, route] of candidate.entries()) {
          expect(route.route[0]).toEqual(routes[index]!.route[0])
          expect(route.route.at(-1)).toEqual(routes[index]!.route.at(-1))
        }
      }
    }
    expect(candidatesByFamily.has("trace-pair-0")).toBe(true)
    expect(candidatesByFamily.has("trace-pair-1")).toBe(true)
  }
  expect({ routes, node, errors }).toEqual(original)
})
