import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("joint repair projects fresh copper before detours and keeps legacy preload stage selection", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  const route = fixture.routes[0]!
  route.route = [
    { x: -4, y: 0, z: 0, pcb_port_id: "start" },
    { x: -0.5, y: 0.29, z: 0 },
    { x: 0.5, y: 0.29, z: 0 },
    { x: 4, y: 0, z: 0, pcb_port_id: "end" },
  ]
  const original = structuredClone(route)
  const params: ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0] =
    {
      srj,
      srjWithPointPairs: srj,
      originalSrj: srj,
      newConnections: srj.connections,
      newHdRoutes: fixture.routes,
      updatedPreloadedTraces: [],
      mutatedPreloadedTraceIds: new Set(),
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
      obstacles: srj.obstacles,
      layerCount: srj.layerCount,
      defaultViaDiameter: 0.3,
      defaultViaHoleDiameter: 0.15,
      effort: 1,
      colorMap: {},
      projectCopperClearanceBeforeDetours: true,
    }
  const solver = new Pipeline9JointDrcRepairSolver(params)
  expect(
    srj.obstacles.some((obstacle): boolean =>
      Boolean(obstacle.isNonPlatedHole),
    ),
  ).toBeFalse()
  expect(solver.stats.initialJointDrcIssueCount).toBeGreaterThan(0)
  expect(solver.getCurrentPhase()).toBe("clearanceProjectionSolver")
  while (
    solver.getCurrentPhase() === "clearanceProjectionSolver" &&
    !solver.failed
  )
    solver.step()
  expect(solver.failed).toBeFalse()
  const projected = solver.clearanceProjectionSolver!.getOutput()
  const validation = fixture.drcEvaluator({ traces: [], routes: projected })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(0)
  expect(projected[0]!.route).not.toEqual(original.route)
  expect(projected[0]!.route[0]).toEqual(original.route[0])
  expect(projected[0]!.route.at(-1)).toEqual(original.route.at(-1))
  expect(projected[0]!.vias).toEqual(original.vias)
  // The existing portfolio receives the actual projected geometry.
  solver.step()
  expect(solver.exactRepairSolver!.params.hdRoutes).toEqual(projected)
  solver.solve()
  const outputValidation = fixture.drcEvaluator({
    traces: [],
    routes: solver.getOutput(),
  })
  expect(
    Array.isArray(outputValidation)
      ? outputValidation
      : outputValidation.errors,
  ).toHaveLength(0)
  expect(route).toEqual(original)

  const legacy = new Pipeline9JointDrcRepairSolver({
    ...params,
    projectCopperClearanceBeforeDetours: false,
  })
  expect(legacy.stats.initialJointDrcIssueCount).toBeGreaterThan(0)
  expect(legacy.getCurrentPhase()).toBe("exactRepairSolver")
  expect(legacy.clearanceProjectionSolver).toBeUndefined()

  const preloadedTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed_preload",
    connection_name: "fixed_net",
    route: [
      { route_type: "wire", x: -2, y: 6, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 6, width: 0.1, layer: "top" },
    ],
  }
  const preloadedSrj = { ...srj, traces: [preloadedTrace] }
  const preloadParams: ConstructorParameters<
    typeof Pipeline9JointDrcRepairSolver
  >[0] = {
    ...params,
    srj: preloadedSrj,
    srjWithPointPairs: preloadedSrj,
    originalSrj: preloadedSrj,
    updatedPreloadedTraces: [preloadedTrace],
    connMap: getConnectivityMapFromSimpleRouteJson(preloadedSrj),
  }
  const originalPreload = structuredClone(preloadedTrace)
  for (const projectCopperClearanceBeforeDetours of [false, undefined]) {
    const legacyPreload = new Pipeline9JointDrcRepairSolver({
      ...preloadParams,
      projectCopperClearanceBeforeDetours,
    })
    expect(legacyPreload.stats.initialJointDrcIssueCount).toBeGreaterThan(0)
    expect(legacyPreload.getCurrentPhase()).toBe("exactRepairSolver")
    expect(legacyPreload.clearanceProjectionSolver).toBeUndefined()
    expect(legacyPreload.getUpdatedPreloadedTraces()).toEqual([originalPreload])
  }
})
