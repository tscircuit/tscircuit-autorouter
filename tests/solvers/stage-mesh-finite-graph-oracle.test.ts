import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { buildConstrainedCorridorMesh } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/buildConstrainedCorridorMesh"
import { createMeshCorridorSearch } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/createMeshCorridorSearch"
import { createMeshInput, meshBox } from "../fixtures/constrained-corridor-mesh-fixture"

test("unit-weight mesh search matches an independent explicit local-cell directed graph and keeps shortcuts physical", (): void => {
  let seed = 718172, solved = 0
  for (let trial = 0; trial < 60; trial++) {
    const input = createMeshInput(), boxes: ReturnType<typeof meshBox>[] = []
    for (let i = 0; i < 3; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const x = seed / 2 ** 32 * 2.6 - 1.3
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      boxes.push(meshBox(x, seed / 2 ** 32 * 2.6 - 1.3, 0.25, 0.45))
    }
    const clear = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => boxes.every((box): boolean => segmentToBoundsMinDistance(a, b, box) + 1e-8 >= 0.15)
    const price = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
      const length = Math.hypot(a.x - b.x, a.y - b.y)
      return ((a.y + b.y) / 2 > -0.25 && (a.y + b.y) / 2 < 0.4 ? length * 0.8 : 0) + Math.max(0, b.x - a.x) * 0.03
    }
    const mesh = buildConstrainedCorridorMesh(input, boxes, { nodesPopped: 0, completionReason: "no-path" })
    const neighbors = mesh.sites.map(() => new Set<number>())
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    for (const cell of mesh.cells) {
      const ps = cell.vertices.map((id) => mesh.sites[id]!)
      const blocked = boxes.some((box): boolean => {
        const signs = [cross(ps[0]!, ps[1]!, box.a), cross(ps[1]!, ps[2]!, box.a), cross(ps[2]!, ps[0]!, box.a)]
        return signs.every((n) => n >= 0) || signs.every((n) => n <= 0)
      })
      if (blocked || !clear(ps[0]!, ps[1]!) || !clear(ps[1]!, ps[2]!) || !clear(ps[2]!, ps[0]!)) continue
      for (const a of cell.nodes) for (const b of cell.nodes) neighbors[a]!.add(b)
    }
    for (const set of neighbors) set.add(mesh.endId)
    const distances = mesh.sites.map((): number => Infinity), closed = new Set<number>()
    distances[mesh.startId] = 0
    for (let i = 0; i < mesh.sites.length; i++) {
      let best = -1
      for (let id = 0; id < mesh.sites.length; id++) if (!closed.has(id) && (best < 0 || distances[id]! < distances[best]!)) best = id
      if (best < 0 || !Number.isFinite(distances[best]!)) break
      closed.add(best)
      for (const id of neighbors[best]!) {
        if (closed.has(id) || !clear(mesh.sites[best]!, mesh.sites[id]!)) continue
        const a = mesh.sites[best]!, b = mesh.sites[id]!
        distances[id] = Math.min(distances[id]!, distances[best]! + Math.hypot(a.x - b.x, a.y - b.y) + price(a, b))
      }
    }
    const search = createMeshCorridorSearch({ input, barriers: boxes, clear, extraCost: price, clearsDrills: (): boolean => true, stats: { nodesPopped: 0, completionReason: "no-path" } })
    let result = search.step()
    while (result.status === "pending") result = search.step()
    expect(Boolean(result.path)).toBe(Number.isFinite(distances[mesh.endId]!))
    if (!result.path) continue
    solved++
    expect(Math.abs(result.modelCost! - distances[mesh.endId]!)).toBeLessThan(1e-7)
    let outputCost = 0
    for (let i = 1; i < result.path.length; i++) {
      const a = result.path[i - 1]!, b = result.path[i]!
      expect(clear(a, b)).toBe(true)
      outputCost += Math.hypot(a.x - b.x, a.y - b.y) + price(a, b)
    }
    expect(outputCost).toBeLessThanOrEqual(result.modelCost! + 1e-7)
  }
  expect(solved).toBeGreaterThan(30)
})
