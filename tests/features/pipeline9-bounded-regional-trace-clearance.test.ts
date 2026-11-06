import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const createTraceClearanceCorridorFixture = (): {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  connMap: ReturnType<typeof getConnectivityMapFromSimpleRouteJson>
  drcEvaluator: DrcEvaluator
} => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.2,
    minTraceToPadEdgeClearance: 0.45,
    minViaDiameter: 0.6,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -6, maxX: 6, minY: -6, maxY: 6 },
    obstacles: [
      {
        type: "rect",
        center: { x: -3, y: 0.4 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["signal", "signal_start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad_signal_start",
          pcb_port_id: "signal_start",
        },
      },
      {
        type: "rect",
        center: { x: 3, y: 0.4 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["signal", "signal_end"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad_signal_end",
          pcb_port_id: "signal_end",
        },
      },
      {
        type: "rect",
        center: { x: -3, y: 1.35 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["blocker", "blocker_start"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad_blocker_start",
          pcb_port_id: "blocker_start",
        },
      },
      {
        type: "rect",
        center: { x: 3, y: 1.35 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["blocker", "blocker_end"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pad_blocker_end",
          pcb_port_id: "blocker_end",
        },
      },
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["foreign_pad"],
        circuitJsonMetadata: { pcb_smtpad_id: "pad_foreign" },
      },
      {
        type: "rect",
        center: { x: 0, y: 1.95 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["ceiling_pad"],
        circuitJsonMetadata: { pcb_smtpad_id: "pad_ceiling" },
      },
    ],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          {
            x: -3,
            y: 0.4,
            layer: "top",
            pointId: "signal_start",
            pcb_port_id: "signal_start",
          },
          {
            x: 3,
            y: 0.4,
            layer: "top",
            pointId: "signal_end",
            pcb_port_id: "signal_end",
          },
        ],
      },
      {
        name: "blocker",
        pointsToConnect: [
          {
            x: -3,
            y: 1.35,
            layer: "top",
            pointId: "blocker_start",
            pcb_port_id: "blocker_start",
          },
          {
            x: 3,
            y: 1.35,
            layer: "top",
            pointId: "blocker_end",
            pcb_port_id: "blocker_end",
          },
        ],
      },
    ],
  }

  const routes: HighDensityRoute[] = [
    {
      connectionName: "signal",
      rootConnectionName: "signal",
      traceThickness: 0.2,
      viaDiameter: 0.6,
      route: [
        { x: -3, y: 0.4, z: 0, pcb_port_id: "signal_start" },
        { x: 0, y: 0.4, z: 0 },
        { x: 3, y: 0.4, z: 0, pcb_port_id: "signal_end" },
      ],
      vias: [],
    },
    {
      connectionName: "blocker",
      rootConnectionName: "blocker",
      traceThickness: 0.2,
      viaDiameter: 0.6,
      route: [
        { x: -3, y: 1.35, z: 0, pcb_port_id: "blocker_start" },
        { x: -1.5, y: 1.15, z: 0 },
        { x: 1.5, y: 1.15, z: 0 },
        { x: 3, y: 1.35, z: 0, pcb_port_id: "blocker_end" },
      ],
      vias: [],
    },
  ]

  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const drcEvaluator: DrcEvaluator = ({ routes: candidate, hdRoutes }) => {
    const evaluatedRoutes = candidate ?? hdRoutes
    if (!evaluatedRoutes) throw new Error("Missing candidate geometry")
    return evaluateRelaxedDrc({
      inputSrj: originalSrj,
      srjWithPointPairs: originalSrj,
      routedTraces: convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: originalSrj.connections,
        originalConnections: originalSrj.connections,
        hdRoutes: evaluatedRoutes,
        layerCount: originalSrj.layerCount,
        obstacles: originalSrj.obstacles,
        defaultViaHoleDiameter: 0.3,
        connMap,
      }),
      drcOptions: {
        traceClearance: originalSrj.minTraceToPadEdgeClearance,
      },
    }) as unknown as ReturnType<DrcEvaluator>
  }

  return { originalSrj, routes, connMap, drcEvaluator }
}

test("bounded regional negotiation honors declared minTraceToPadEdgeClearance between traces", (): void => {
  const { originalSrj, routes, connMap, drcEvaluator } =
    createTraceClearanceCorridorFixture()

  const solver = new Pipeline9BoundedRegionalRepairSolver({
    originalSrj,
    routes,
    connMap,
    syntheticConnectionNames: new Set(),
    drcEvaluator,
    budget: {
      maxRegions: 1,
      maxCandidateAttempts: 64,
      maxPathSearchNodes: 120_000,
      regionSizes: [10],
    },
  })
  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const result = solver.getResult()
  expect(result.repaired).toBeTrue()
  expect(result.publishedDrcIssueCount).toBe(0)

  const validation = drcEvaluator({
    routes: result.routes,
    traces: [],
  })
  expect(Array.isArray(validation) ? validation : validation.errors).toEqual([])
})

test("joint DRC repair solves declared 0.45mm trace clearance without falling through bounded regional repair", (): void => {
  const { originalSrj, routes, connMap, drcEvaluator } =
    createTraceClearanceCorridorFixture()

  const solver = new Pipeline9JointDrcRepairSolver({
    srj: originalSrj,
    srjWithPointPairs: originalSrj,
    originalSrj,
    newConnections: originalSrj.connections,
    newHdRoutes: routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap,
    obstacles: originalSrj.obstacles,
    layerCount: originalSrj.layerCount,
    defaultViaDiameter: 0.6,
    defaultViaHoleDiameter: 0.3,
    effort: 1,
    colorMap: { signal: "red", blocker: "blue" },
  })
  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.boundedRegionalRepairRepaired).toBe(true)
  expect(solver.stats.initialBoundedRegionalRepairPublishedDrcIssueCount).toBe(
    0,
  )

  const validation = drcEvaluator({
    routes: solver.getOutput(),
    traces: [],
  })
  expect(Array.isArray(validation) ? validation : validation.errors).toEqual([])
})
