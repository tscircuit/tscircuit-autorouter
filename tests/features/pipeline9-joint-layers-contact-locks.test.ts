import { expect, test } from "bun:test"
import { Pipeline9JointLayerAssignmentSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointLayerAssignmentSolver"
import { createJointLayerFixture, evaluateJointLayerFixture } from "tests/fixtures/joint-layer-assignment"

test("same-net junctions and internal terminals stay fixed while distant fragments remain eligible", (): void => {
  for (const contact of [false, true]) {
    const { routes, srj, connMap } = createJointLayerFixture()
    const peer = { ...routes[0], route: contact
      ? [{ x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }]
      : [{ x: -3, y: 3.5, z: 0 }, { x: -2, y: 3.5, z: 0 }], vias: [] }
    const snapshot = structuredClone({ routes, peer })
    const solver = new Pipeline9JointLayerAssignmentSolver({ routes, fixedRoutes: [peer],
      layerCount: 2, connMap, clearance: 0.1, obstacles: srj.obstacles,
      evaluate: (candidate) => evaluateJointLayerFixture(srj, candidate) })
    solver.solve()
    expect(solver.stats.sharedNetRoutes).toBe(1)
    expect(solver.stats.accepted > 0).toBe(!contact)
    expect({ routes, peer }).toEqual(snapshot)
  }
  const { routes, srj, connMap } = createJointLayerFixture()
  routes[0].route[2].pcb_port_id = "internal_locked_terminal"
  const locked = new Pipeline9JointLayerAssignmentSolver({ routes, fixedRoutes: [],
    layerCount: 2, connMap, clearance: 0.1, obstacles: srj.obstacles,
    evaluate: (candidate) => evaluateJointLayerFixture(srj, candidate) })
  locked.solve()
  expect(locked.stats.accepted).toBe(0)
  expect(locked.getOutput()).toEqual(routes)
  const fresh = createJointLayerFixture()
  const limited = new Pipeline9JointLayerAssignmentSolver({ routes: fresh.routes, fixedRoutes: [],
    layerCount: 2, connMap: fresh.connMap, clearance: 0.1, obstacles: fresh.srj.obstacles, maxSearchStates: 1,
    evaluate: (candidate) => evaluateJointLayerFixture(fresh.srj, candidate) })
  limited.solve()
  expect(limited.stats.searchStates).toBe(1)
  expect(limited.stats.workLimitReached).toBe(1)
  expect(limited.stats.accepted).toBe(0)
  expect(limited.getOutput()).toEqual(fresh.routes)
})
