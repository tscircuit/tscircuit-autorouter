import { expect, test } from "bun:test"
import { buildConstrainedCorridorMesh, meshBarrierRing, meshTriangleContains, type CorridorMeshStats } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/buildConstrainedCorridorMesh"
import { createMeshInput, meshBox } from "../fixtures/constrained-corridor-mesh-fixture"

test("constrained layer meshes retain nested/overlapping/touching boundaries and hole rings without fallback or jitter", (): void => {
  for (const boxes of [
    [meshBox(0, 0, 2, 2), meshBox(0, 0, 1, 1), meshBox(0.8, 0, 1, 1)],
    [meshBox(-0.5, 0, 1, 1), meshBox(0.5, 0, 1, 1)],
    [meshBox(-1, 0, 0.3, 2.3), meshBox(1, 0, 0.3, 2.3), meshBox(0, -1, 2.3, 0.3), meshBox(0, 1, 2.3, 0.3)],
  ]) {
    const input = createMeshInput(), stats: CorridorMeshStats = { nodesPopped: 0, completionReason: "no-path" }
    const mesh = buildConstrainedCorridorMesh(input, boxes, stats)
    expect(mesh.cells.length).toBeGreaterThan(0)
    expect(stats.meshConstraintVerification).toBe(stats.meshConstraints)
    expect(stats.meshUnionFaces).toBeGreaterThan(0)
    expect(mesh.sites[mesh.startId]!.x).toBe(input.start.x)
    expect(mesh.sites[mesh.endId]!.y).toBe(input.end.y)
  }
  const input = createMeshInput(), stats: CorridorMeshStats = { nodesPopped: 0, completionReason: "no-path" }
  buildConstrainedCorridorMesh(input, [meshBox(-1, 0, 0.3, 2.3), meshBox(1, 0, 0.3, 2.3), meshBox(0, -1, 2.3, 0.3), meshBox(0, 1, 2.3, 0.3)], stats)
  expect(stats.meshUnionFaces).toBe(2)
  const capsule = { ...meshBox(0, 0, 1, 1), rect: undefined, radius: 0.4, a: { x: -0.5, y: 0, z: 0 }, b: { x: 0.5, y: 0, z: 0 } }
  const ring = meshBarrierRing(capsule, 0.15)
  for (const center of [capsule.a, capsule.b]) for (let i = 0; i < 360; i++) {
    const p = { x: center.x + 0.55 * Math.cos(i * Math.PI / 180), y: center.y + 0.55 * Math.sin(i * Math.PI / 180) }
    expect(ring.some((_, j): boolean => meshTriangleContains(p, ring[0]!, ring[j]!, ring[(j + 1) % ring.length]!))).toBe(true)
  }
})
