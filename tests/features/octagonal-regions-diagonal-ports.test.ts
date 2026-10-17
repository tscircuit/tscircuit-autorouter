import { expect, test } from "bun:test"
import { PolyHypergraphPortPointPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/PolyHypergraphPortPointPathingSolver"
import srj from "../../fixtures/features/octagonal-regions.json"
import type { SimpleRouteJson } from "lib/types"

test("octagonal pathing connects split seams and routes through diagonal boundary ports", () => {
  const solver = new PolyHypergraphPortPointPathingSolver({
    srj: srj as SimpleRouteJson, regionShape: "octagonal", effort: 0.2,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.usedUnconstrainedDelaunayFallback).toBe(false)
  const graph = solver.serializedGraph
  const regions = new Map(graph.regions.map((region) => [region.regionId, region]))
  const diagonalPorts = graph.ports.filter((port) => {
    const polygon = regions.get(port.region1Id)!.d.polygon
    return polygon.some((a, i) => {
      const b = polygon[(i + 1) % polygon.length]!
      const dx = b.x - a.x
      const dy = b.y - a.y
      const cross = dx * (port.d.y - a.y) - dy * (port.d.x - a.x)
      return Math.abs(dx) > 1e-7 && Math.abs(dy) > 1e-7 && Math.abs(cross) < 1e-7
    })
  })
  expect(diagonalPorts.length).toBeGreaterThan(0)
  const usedPorts = new Set(solver.nodesWithPortPoints.flatMap((node) =>
    node.portPoints.map((point) => point.portPointId)))
  expect(diagonalPorts.some((port) => usedPorts.has(port.portId))).toBe(true)
})
