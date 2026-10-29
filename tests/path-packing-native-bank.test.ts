import { expect, test } from "bun:test"
import { PathPackingIntraNodeSolver } from "lib/solvers/HighDensitySolver/PathPackingIntraNodeSolver"
import { createPathPackingAudit } from "lib/solvers/HighDensitySolver/pathPackingGeometry"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { packingCrossingNode } from "./fixtures/pathPackingSynthetic"

test("the upstream packer generates diverse native paths and publishes only a complete validated assignment", () => {
  const audit = createPathPackingAudit()
  const board: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, minViaDiameter: 0.3,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: packingCrossingNode.portPoints.map((p, i) => ({ type: "rect" as const,
      center: { x: p.x, y: p.y }, width: 0.2, height: 0.2, layers: ["top"],
      connectedTo: [p.connectionName, `pcb_smtpad_${i}`],
      circuitJsonMetadata: { pcb_smtpad_id: `pcb_smtpad_${i}`, pcb_port_id: `pcb_port_${i}` } })),
    connections: ["a", "b"].map((name) => ({ name, pointsToConnect: packingCrossingNode.portPoints
      .filter((p) => p.connectionName === name).map((p) => ({ x: p.x, y: p.y, layer: "top",
        pcb_port_id: `pcb_port_${packingCrossingNode.portPoints.indexOf(p)}` })) })) }
  const input = { nodeWithPortPoints: structuredClone(packingCrossingNode), traceWidth: 0.1,
    viaDiameter: 0.3, viaHoleDiameter: 0.15, obstacleMargin: 0.1, layerCount: 2,
    obstacles: board.obstacles, boardGeometry: { bounds: board.bounds }, pathPackingStats: audit }
  const before = structuredClone(input.nodeWithPortPoints)
  const solver = new PathPackingIntraNodeSolver(input)
  expect(audit.activated).toBeFalse()
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.solvedRoutes).toHaveLength(2)
  expect(audit.activated).toBeTrue()
  expect(audit.bankTasks).toBe(2)
  expect(audit.nativeDistinctCandidates).toBeGreaterThan(audit.bankTasks)
  expect(audit.distinctCandidates).toBeGreaterThan(audit.bankTasks)
  expect(audit.distinctViaPatterns).toBeGreaterThan(2)
  expect(audit.generationSearchNodes).toBeGreaterThan(0)
  expect(audit.selectionStates).toBeGreaterThan(0)
  expect(audit.solvedNodes).toBe(1)
  expect(audit.workUnits).toBe(solver.iterations)
  expect(audit.workUnits).toBeLessThanOrEqual(solver.MAX_ITERATIONS)
  expect(Object.keys(audit)).toHaveLength(16)
  expect(input.nodeWithPortPoints).toEqual(before)
  const traces = solver.solvedRoutes.map((route, i) => ({ type: "pcb_trace" as const,
    pcb_trace_id: `packing_${i}`, connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, 2) }))
  const result = evaluateRelaxedDrc({ inputSrj: board, srjWithPointPairs: board,
    routedTraces: traces, includeBoardClearance: true,
    drcOptions: { traceClearance: 0.1, viaClearance: 0.1, viaToPadClearance: 0.1 } })
  expect(result.errors).toHaveLength(0)
  const tinyAudit = createPathPackingAudit()
  const exhausted = new PathPackingIntraNodeSolver({ ...input, pathPackingStats: tinyAudit, pathPackingMaxWork: 30 })
  exhausted.solve()
  expect(exhausted.solved).toBeFalse()
  expect(exhausted.failed).toBeTrue()
  expect(exhausted.solvedRoutes).toHaveLength(0)
  expect(tinyAudit.exhaustedNodes).toBe(1)
  expect(tinyAudit.workUnits).toBeLessThanOrEqual(30)
})
