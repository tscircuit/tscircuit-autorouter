import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getBaseMaxIterations } from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverConfig"
import { createPipeline9HighDensityDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9HighDensityDrcEvaluator"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceRejectionReason,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9HighDensityForceCandidates"
import { isPipeline9HighDensityDrcCandidateBetter } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityDrcCandidateBetter"
import { getPipeline9DrcErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("Pipeline9 local forces use inert HD terminal identities without changing public point metadata", (): void => {
  const route: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: "terminal-node",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    startPcbPortId: "port-a-start",
    endPcbPortId: "port-a-end",
    route: [
      { x: -4, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [],
  }
  const originalRoute = structuredClone(route)
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "terminal-node",
    center: { x: 0, y: 0 },
    width: 10,
    height: 10,
    availableZ: [0, 1],
    portPoints: [
      { x: -4, y: 0, z: 0, connectionName: "A", pcb_port_id: "port-a-start" },
      { x: 4, y: 0, z: 0, connectionName: "A", pcb_port_id: "port-a-end" },
    ],
  }
  const connMap = new ConnectivityMap({
    A: ["A", "port-a-start", "port-a-end"],
    B: ["B", "port-b-start", "port-b-end"],
  })
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    obstacles: [
      ...[-4, 4].map((x) => ({
        type: "rect" as const,
        circuitJsonMetadata: {
          pcb_smtpad_id: x < 0 ? "pad-a-start" : "pad-a-end",
          pcb_port_id: x < 0 ? "port-a-start" : "port-a-end",
        },
        center: { x, y: 0 },
        width: 1.2,
        height: 1.2,
        layers: ["top"],
        connectedTo: ["A", x < 0 ? "port-a-start" : "port-a-end"],
      })),
      {
        type: "rect",
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad-b-start",
          pcb_port_id: "port-b-start",
        },
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["B", "port-b-start"],
      },
    ],
    connections: [
      {
        name: "A",
        pointsToConnect: node.portPoints.map((point) => ({
          x: point.x,
          y: point.y,
          layer: "top",
          pcb_port_id: point.pcb_port_id,
        })),
      },
      {
        name: "B",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "port-b-start" },
          { x: 0, y: 4, layer: "top", pcb_port_id: "port-b-end" },
        ],
      },
    ],
  }
  const drcEvaluator = createPipeline9HighDensityDrcEvaluator({
    connections: [srj.connections[0]!],
    originalConnections: srj.connections,
    originalFixedHdRoutes: [],
    fixedHdRoutes: [],
    changedPreloadedTraceSections: [],
    hdRoutes: [route],
    layerCount: 2,
    obstacles: srj.obstacles,
    defaultViaHoleDiameter: 0.15,
    connMap,
    originalSrj: srj,
    srjWithPointPairs: srj,
  })
  const initialErrors = getPipeline9DrcErrors(drcEvaluator, [route])
  expect(initialErrors.length).toBeGreaterThan(0)
  const effort = 1
  let incumbentRoutes = [route]
  let currentErrors = initialErrors
  let attemptedPassCount = 0
  let yieldedCandidateCount = 0
  let acceptedPassCount = 0
  const rejections: Record<Pipeline9HighDensityForceRejectionReason, number> = {
    "no-motion": 0,
    anchor: 0,
    geometry: 0,
  }
  // Terminal locking must survive incremental repairs, not just a candidate
  // that happens to clear every official error in its first force application.
  while (
    currentErrors.length > 0 &&
    attemptedPassCount < getBaseMaxIterations(effort)
  ) {
    attemptedPassCount++
    let accepted = false
    const passInputRoutes = incumbentRoutes
    const originalPassInputRoutes = structuredClone(passInputRoutes)
    for (const candidate of getPipeline9HighDensityForceCandidates({
      node,
      hdRoutes: incumbentRoutes,
      forceContext: drcEvaluator.getForceContext(incumbentRoutes),
      errors: currentErrors,
      traceRouteIndexById: new Map([["A_0", 0]]),
      obstacles: srj.obstacles,
      layerCount: 2,
      viaDiameter: 0.3,
      viaHoleDiameter: 0.15,
      traceWidth: 0.1,
      obstacleMargin: 0.15,
      connMap,
      effort,
      onCandidateRejected: (reason): void => {
        rejections[reason]++
      },
    })) {
      yieldedCandidateCount++
      const candidateErrors = getPipeline9DrcErrors(drcEvaluator, candidate)
      if (
        !isPipeline9HighDensityDrcCandidateBetter(
          candidateErrors,
          currentErrors,
        )
      ) {
        continue
      }
      expect(candidate[0]!.route[0]).toEqual(originalRoute.route[0])
      expect(candidate[0]!.route.at(-1)).toEqual(originalRoute.route.at(-1))
      expect(candidate[0]!.startPcbPortId).toBe(originalRoute.startPcbPortId)
      expect(candidate[0]!.endPcbPortId).toBe(originalRoute.endPcbPortId)
      expect(
        candidate[0]!.route.every((point) => !("pcb_port_id" in point)),
      ).toBe(true)
      incumbentRoutes = candidate
      currentErrors = candidateErrors
      acceptedPassCount++
      accepted = true
      break
    }
    expect(passInputRoutes).toEqual(originalPassInputRoutes)
    if (!accepted) break
  }
  // Include progress and rejection categories in a hosted failure: zero
  // candidates is different from useful steps that exhaust the shared budget.
  expect({
    remainingErrors: currentErrors.length,
    attemptedPassCount,
    yieldedCandidateCount,
    acceptedPassCount,
    rejections,
  }).toMatchObject({ remainingErrors: 0 })
  expect(acceptedPassCount).toBeGreaterThan(0)
  expect(getPipeline9DrcErrors(drcEvaluator, incumbentRoutes)).toHaveLength(0)
  expect(route).toEqual(originalRoute)
})
