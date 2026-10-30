import { expect, test } from "bun:test"
import { planPipeline9ParallelRegionalTasks } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/planPipeline9ParallelRegionalTasks"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("region planner skips shared source routes and continues to later independent regions", (): void => {
  const fixture = createBoundedRegionalRepairFixture(3)
  const srj = fixture.originalSrj
  srj.bounds.maxY = 90
  for (let index = 1; index < 3; index++) {
    const offset = index * 39
    for (const obstacle of srj.obstacles.slice(index * 3, index * 3 + 3)) obstacle.center.y += offset
    for (const point of srj.connections[index]!.pointsToConnect) point.y += offset
    for (const point of fixture.routes[index]!.route) point.y += offset
  }
  fixture.routes[0]!.route.push({ x: 4, y: 40, z: 0 })
  const tasks = planPipeline9ParallelRegionalTasks({
    srj,
    routes: fixture.routes,
    errors: [0, 40, 80].map((y, index) => ({ pcb_trace_id: `signal_${index}`, center: { x: 0, y } })),
    maxTasks: 2,
    maxPathSearchCalls: 20,
    maxPathSearchNodes: 200_000,
    maxPathSearchNodesPerCall: 100_000,
    maxLogicalIterations: 1_000_000,
  })
  expect(tasks).toHaveLength(2)
  expect(tasks.map((task) => task.region.mutableBounds.minY)).toEqual([-7.5, 72.5])
  const firstSources = new Set(tasks[0]!.region.routeMappings.map((mapping) => mapping.sourceRouteIndex))
  expect(tasks[1]!.region.routeMappings.every((mapping) => !firstSources.has(mapping.sourceRouteIndex))).toBe(true)
  const conflictingOnly = planPipeline9ParallelRegionalTasks({
    srj,
    routes: fixture.routes,
    errors: [0, 40].map((y, index) => ({ pcb_trace_id: `signal_${index}`, center: { x: 0, y } })),
    maxTasks: 2,
    maxPathSearchCalls: 20,
    maxPathSearchNodes: 200_000,
    maxPathSearchNodesPerCall: 100_000,
    maxLogicalIterations: 1_000_000,
  })
  expect(conflictingOnly).toHaveLength(1)
})
