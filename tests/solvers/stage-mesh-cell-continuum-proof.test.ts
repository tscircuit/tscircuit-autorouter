import { expect, test } from "bun:test"
import { pointToSegmentDistance, segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { createMeshCorridorCellVerifier } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/createMeshCorridorSearch"
import type { CorridorMesh, CorridorMeshStats, MeshBarrier } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/buildConstrainedCorridorMesh"

test("lazy convex-cell proof rejects wholly internal primitives and every accepted continuum sample is physically free", (): void => {
  const sites = [{ x: -3, y: -2, z: 0 }, { x: 3, y: -2, z: 0 }, { x: 0, y: 3, z: 0 }]
  const mesh: CorridorMesh = { sites, cells: [{ vertices: [0, 1, 2], nodes: [0, 1, 2], z: 0, bounds: { minX: -3, maxX: 3, minY: -2, maxY: 3 } }],
    memberships: [[0], [0], [0]], startId: 0, endId: 1, addProjection: (): number => { throw new Error("No projection in cell proof") } }
  const internal: MeshBarrier = { minX: -0.1, maxX: 0.1, minY: -0.1, maxY: 0.1, minZ: 0, maxZ: 0,
    a: { x: 0, y: 0, z: 0 }, b: { x: 0, y: 0, z: 0 }, radius: 0.1 }
  const stats: CorridorMeshStats = { nodesPopped: 0, completionReason: "no-path" }
  let checks = 0
  const oracle = createMeshCorridorCellVerifier(mesh, [internal], (): boolean => { checks++; return true }, stats)
  expect(oracle(0)).toBe(false)
  expect(checks).toBe(3)
  expect(stats.meshAnchorContainmentTests).toBe(1)
  expect(oracle(0)).toBe(false)
  expect(checks).toBe(3)
  let accepted = 0, seed = 35179
  for (let trial = 0; trial < 160; trial++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const x = seed / 2 ** 32 * 12 - 6
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const y = seed / 2 ** 32 * 12 - 6
    const barrier = { ...internal, minX: x - 0.15, maxX: x + 0.45, minY: y - 0.15, maxY: y + 0.15,
      a: { x, y, z: 0 }, b: { x: x + 0.3, y, z: 0 }, radius: 0.15 }
    const clear = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => {
      return segmentToSegmentMinDistance(a, b, barrier.a, barrier.b) >= 0.35
    }
    const certify = createMeshCorridorCellVerifier(mesh, [barrier], clear, { nodesPopped: 0, completionReason: "no-path" })
    if (!certify(0)) continue
    accepted++
    for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16 - i; j++) {
      const p = { x: sites[0]!.x + (sites[1]!.x - sites[0]!.x) * i / 16 + (sites[2]!.x - sites[0]!.x) * j / 16,
        y: sites[0]!.y + (sites[1]!.y - sites[0]!.y) * i / 16 + (sites[2]!.y - sites[0]!.y) * j / 16 }
      expect(pointToSegmentDistance(p, barrier.a, barrier.b)).toBeGreaterThanOrEqual(0.35)
    }
  }
  expect(accepted).toBeGreaterThan(50)
})
