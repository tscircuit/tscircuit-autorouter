import { expect, test } from "bun:test"
import cases from "../fixtures/monotone-mesh-prior-union-polygons.json"
import { buildMonotoneCorridorMesh } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/buildMonotoneCorridorMesh"
import type { CorridorMeshStats } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/buildConstrainedCorridorMesh"
import { createMeshInput } from "../fixtures/constrained-corridor-mesh-fixture"

test("the seven captured failed-union polygon vertex sets are finite construction inputs without Boolean operations", (): void => {
  expect(cases.length).toBe(7)
  for (const item of cases) {
    // These are captured polygon proposals, not a reconstruction of the full
    // physical scene. This regression asserts construction only, not routing.
    const points = [...item.left.flat(), ...item.right]
    const input = createMeshInput()
    input.bounds = { minX: Math.min(...points.map((p) => p.x)) - 1, maxX: Math.max(...points.map((p) => p.x)) + 1,
      minY: Math.min(...points.map((p) => p.y)) - 1, maxY: Math.max(...points.map((p) => p.y)) + 1 }
    input.srj.bounds = input.bounds
    input.start = { x: input.bounds.minX, y: input.bounds.minY, z: 0 }
    input.end = { x: input.bounds.maxX, y: input.bounds.maxY, z: 0 }
    input.existingPath = points.map((p) => ({ ...p, z: 0 }))
    const stats: CorridorMeshStats = { nodesPopped: 0, completionReason: "no-path" }
    const mesh = buildMonotoneCorridorMesh(input, [], stats)
    expect(stats.meshSweepCalls).toBe(1)
    expect(stats.meshUnionCalls).toBe(0)
    expect(stats.meshDelaunayRefinementCalls).toBe(0)
    expect(mesh.cells.length).toBeGreaterThan(0)
    expect(mesh.memberships[mesh.startId]!.length).toBeGreaterThan(0)
    expect(mesh.memberships[mesh.endId]!.length).toBeGreaterThan(0)
  }
})
