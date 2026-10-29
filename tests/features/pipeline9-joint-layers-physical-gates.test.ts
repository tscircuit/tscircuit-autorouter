import { expect, test } from "bun:test"
import { Pipeline9JointLayerAssignmentSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointLayerAssignmentSolver"
import { createJointLayerFixture, evaluateJointLayerFixture } from "tests/fixtures/joint-layer-assignment"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"

test("joint layers preserve pad, terminal, full-drill-span and original-board constraints", (): void => {
  const { routes, srj, connMap } = createJointLayerFixture()
  srj.obstacles.push({ type: "rect", obstacleId: "fixed_bottom_pad", center: { x: 1, y: 0 },
    width: 0.4, height: 0.4, layers: ["bottom"], connectedTo: ["foreign"],
    circuitJsonMetadata: { source_component_name: "blockers", source_port_name: "bottom_pad" } })
  expect(evaluateJointLayerFixture(srj, routes).valid).toBe(true)
  const solver = new Pipeline9JointLayerAssignmentSolver({ routes, fixedRoutes: [],
    layerCount: 2, connMap, clearance: 0.1, obstacles: srj.obstacles,
    evaluate: (candidate) => evaluateJointLayerFixture(srj, candidate) })
  solver.solve()
  expect(solver.stats.accepted).toBe(0)
  expect(solver.stats.copperRejected).toBeGreaterThan(0)
  expect(solver.getOutput()).toEqual(routes)
  const via = { ...routes[0], route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
    vias: [{ x: 0, y: 0 }] }
  const wire = { ...routes[1], route: [{ x: -1, y: 0, z: 2 }, { x: 1, y: 0, z: 2 }], vias: [] }
  expect(doPipeline9RoutesHaveCopperConflict({ left: via, right: wire,
    clearance: 0.1, layerCount: 4 })).toBe(true)
  expect(doPipeline9RoutesHaveCopperConflict({ left: via, right: wire,
    clearance: 0.1, layerCount: 4, allowBlindAndBuriedVias: true })).toBe(false)
  const invalid = structuredClone(routes)
  invalid[0].route[0].x = -5
  const invalidSolver = new Pipeline9JointLayerAssignmentSolver({ routes: invalid,
    fixedRoutes: [], layerCount: 2, connMap, clearance: 0.1,
    evaluate: (candidate) => evaluateJointLayerFixture(srj, candidate) })
  expect(invalidSolver.stats.baselineValid).toBe(false)
  expect(invalidSolver.stats.accepted).toBe(0)
  // An unreferenced SRJ obstacle need not materialize as a Circuit JSON pad.
  // The original-geometry guard must still stop the proposed layer change.
  const unknown = createJointLayerFixture()
  unknown.srj.obstacles.push({ type: "rect", obstacleId: "unreferenced_pad",
    center: { x: 1, y: 0 }, width: 0.4, height: 0.4, layers: ["bottom"], connectedTo: [] })
  const guarded = new Pipeline9JointLayerAssignmentSolver({ routes: unknown.routes,
    fixedRoutes: [], layerCount: 2, connMap: unknown.connMap, clearance: 0.1,
    obstacles: unknown.srj.obstacles,
    evaluate: (candidate) => evaluateJointLayerFixture(unknown.srj, candidate) })
  guarded.solve()
  expect(guarded.stats.baselineValid).toBe(true)
  expect(guarded.stats.accepted).toBe(0)
  expect(guarded.getOutput()).toEqual(unknown.routes)
})
