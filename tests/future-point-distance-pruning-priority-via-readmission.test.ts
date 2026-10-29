import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { createFuturePointDistancePruningStats } from "lib/solvers/HighDensitySolver/futurePointDistancePruningContext"
import { makeFutureDistancePruningNode } from "./fixtures/futurePointDistancePruningSynthetic"

test("a rejected endpoint-via checker and reused-options native search each receive their own internal admission", () => {
  const node = makeFutureDistancePruningNode(1)
  node.portPoints[0] = { connectionName: "net0", x: 0, y: 0, z: 0 }
  node.portPoints[1] = { connectionName: "net0", x: 0, y: 0, z: 1 }
  const stats = createFuturePointDistancePruningStats()
  const previousDetailed = PriorityDagIntraNodeSolver.detailedWorkDiagnostics
  PriorityDagIntraNodeSolver.detailedWorkDiagnostics = true
  let p: PriorityDagIntraNodeSolver
  try {
    p = new PriorityDagIntraNodeSolver({ nodeWithPortPoints: node, priorityFamilySize: 6, viaDiameter: .25, viaHoleDiameter: .1, minViaHoleEdgeToViaHoleEdgeClearance: .1, traceWidth: .1, experimentFuturePointDistancePruning: true, futurePointDistancePruningStats: stats })
  } finally { PriorityDagIntraNodeSolver.detailedWorkDiagnostics = previousDetailed }
  const tasks = (p as any).tasks as any[]
  const current = tasks.findIndex((task) => task.connectionName === "net0")
  const ancestor = tasks.findIndex((task) => task.connectionName === "net1")
  const state = { ancestors: tasks.map((_task, i) => new Set(i === current ? [ancestor] : [])), witnesses: Array(tasks.length).fill(undefined) }
  state.witnesses[ancestor] = { route: { connectionName: "net1", rootConnectionName: "net1", traceThickness: 5, viaDiameter: .25, vias: [], route: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }] }, ancestors: [] }
  ;(p as any).startTask(current, state)
  expect(p.priorityDiagnostics.priorityEndpointViaAttempts).toBe(1)
  expect(p.priorityDiagnostics.priorityEndpointViaAccepted).toBeUndefined()
  expect(p.priorityDiagnostics.priorityNativeSearches).toBe(1)
  expect(p.activeSubSolver).not.toBeNull()
  expect(stats.instances).toBe(2)
})
