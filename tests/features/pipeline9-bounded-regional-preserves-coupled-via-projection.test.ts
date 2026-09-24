import { expect, test } from "bun:test"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("independent wire repair does not suppress a complete coupled via repair", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  fixture.originalSrj.obstacles = []
  const terminals = [
    [
      { x: -2, y: 0, layer: "top" },
      { x: 2, y: 0, layer: "bottom" },
    ],
    [
      { x: 0.29, y: -1, layer: "top" },
      { x: 0.29, y: 1, layer: "top" },
    ],
  ]
  for (const [index, connection] of fixture.originalSrj.connections.entries()) {
    connection.pointsToConnect = terminals[index]!.map((point, pi) => ({
      ...point,
      pcb_port_id: `terminal_${index}_${pi}`,
    }))
    for (const point of connection.pointsToConnect) {
      fixture.originalSrj.obstacles.push({
        type: "rect",
        center: { x: point.x, y: point.y },
        width: 0.2,
        height: 0.2,
        layers: [point.layer!],
        connectedTo: [connection.name, point.pcb_port_id!],
        circuitJsonMetadata: {
          pcb_smtpad_id: `pad_${point.pcb_port_id}`,
          pcb_port_id: point.pcb_port_id,
        },
      })
    }
  }
  fixture.routes[0]!.route = [
    { x: -2, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 2, y: 0, z: 1 },
  ]
  fixture.routes[0]!.vias = [{ x: 0, y: 0 }]
  fixture.routes[1]!.route = [
    { x: 0.29, y: -1, z: 0 },
    { x: 0.29, y: 1, z: 0 },
  ]
  const original = structuredClone(fixture.routes)
  const before = fixture.drcEvaluator({ routes: fixture.routes, traces: [] })
  expect(Array.isArray(before) ? before : before.errors).toHaveLength(1)
  const result = applyPipeline9BoundedRegionalRepairs({
    ...fixture,
    budget: { maxRegions: 1, maxCandidateAttempts: 1, maxPathSearchNodes: 1 },
  })
  const after = fixture.drcEvaluator({ routes: result.routes, traces: [] })
  expect(Array.isArray(after) ? after : after.errors).toEqual([])
  expect(result.repaired).toBe(true)
  expect(result.attemptedRegionCount).toBe(0)
  expect(result.routes[0]!.vias).not.toEqual(original[0]!.vias)
  expect(result.routes[1]).toEqual(original[1])
  expect(fixture.routes).toEqual(original)
})
