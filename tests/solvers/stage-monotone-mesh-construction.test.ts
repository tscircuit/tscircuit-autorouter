import { expect, test } from "bun:test"
import { buildMonotoneCorridorMesh } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/buildMonotoneCorridorMesh"
import type { CorridorMeshStats } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/buildConstrainedCorridorMesh"
import { createMeshInput, meshBox } from "../fixtures/constrained-corridor-mesh-fixture"

test("one raw-support monotone XY mesh is extruded without union, constraints or Delaunay refinement and retains exact endpoints", (): void => {
  for (const mode of ["ordinary", "coincident", "collinear", "crop-edge"] as const) {
    const input = createMeshInput()
    input.srj.layerCount = 4
    input.allowLayerChanges = true
    if (mode === "coincident") input.end = { ...input.start, z: 3 }
    if (mode === "collinear") {
      input.start = { x: -2, y: 0, z: 0 }; input.end = { x: 2, y: 0, z: 3 }
      input.existingPath = [input.start, input.start, { x: 0, y: 0, z: 0 }, input.end]
    }
    if (mode === "crop-edge") { input.start = { x: -3, y: 0, z: 0 }; input.end = { x: 3, y: 0, z: 3 } }
    const stats: CorridorMeshStats = { nodesPopped: 0, completionReason: "no-path" }
    const mesh = buildMonotoneCorridorMesh(input, [meshBox(0, 0, 1, 1), meshBox(0.3, 0, 1, 1), meshBox(0, 0, 0.2, 0.2), meshBox(0, 0, 1, 1, 3)], stats)
    expect(stats.meshSweepCalls).toBe(1)
    expect(stats.meshCdtCalls).toBe(1)
    expect(stats.meshUnionCalls).toBe(0)
    expect(stats.meshUnionPairs).toBe(0)
    expect(stats.meshConstraints).toBe(0)
    expect(stats.meshConstraintVerification).toBe(0)
    expect(stats.meshDelaunayRefinementCalls).toBe(0)
    expect(stats.meshExtrudedLayers).toBe(4)
    expect(stats.meshSweepTriangles).toBeGreaterThan(0)
    expect(stats.meshCells).toBe((stats.meshSweepTriangles as number) * 4)
    for (const [id, point] of [[mesh.startId, input.start], [mesh.endId, input.end]] as const) {
      expect(mesh.sites[id]!.x).toBe(point.x); expect(mesh.sites[id]!.y).toBe(point.y); expect(mesh.sites[id]!.z).toBe(point.z)
      expect(mesh.memberships[id]!.length).toBeGreaterThan(0)
    }
    const xyCells = (z: number): string[] => mesh.cells.filter((cell) => cell.z === z).map((cell): string => cell.vertices.map((id): string => `${mesh.sites[id]!.x}:${mesh.sites[id]!.y}`).sort().join("|")).sort()
    for (let z = 1; z < 4; z++) expect(xyCells(z)).toEqual(xyCells(0))
  }
  const bad = createMeshInput(); bad.start.x = Number.NaN
  expect(() => buildMonotoneCorridorMesh(bad, [], { nodesPopped: 0, completionReason: "no-path" })).toThrow("nonfinite")
})
