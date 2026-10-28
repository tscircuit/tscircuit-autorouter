import { expect, test } from "bun:test"
import { certifyPipeline9BoundaryPortOrder } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/certifyPipeline9BoundaryPortOrder"
import { makeBoundaryPortOrderGraph } from "./fixtures/boundary-port-order.fixture"

test("only complete nonoverlapping physical side families receive an order certificate", () => {
  const graph = makeBoundaryPortOrderGraph()
  // An endpoint of the lower common edge remains an open point of the larger
  // center rectangle. The Tiny producer must place new duplicates inward.
  graph.ports[0]!.d.y = 0
  expect(certifyPipeline9BoundaryPortOrder({ graph: graph, terminalRegionIds: new Set() })).toBe(1)
  expect(graph.regions[0]!.d.boundaryPortOrderPreserved).toBe(true)
  expect(graph.regions.slice(1).every((r) => r.d.boundaryPortOrderPreserved === undefined)).toBe(true)
  // Recomputing after a changed family must remove the prior positive proof.
  graph.regions[1]!.d.center.y = -0.25
  graph.regions[1]!.d.height = 1.5
  expect(certifyPipeline9BoundaryPortOrder({ graph: graph, terminalRegionIds: new Set() })).toBe(0)
  expect(graph.regions[0]!.d.boundaryPortOrderPreserved).toBeUndefined()
  for (const [x, y] of [[1, 1], [0, 0], [1.0001, 0]]) {
    const uncertain = makeBoundaryPortOrderGraph()
    uncertain.ports[0]!.d.x = x!
    uncertain.ports[0]!.d.y = y!
    expect(certifyPipeline9BoundaryPortOrder({ graph: uncertain, terminalRegionIds: new Set() })).toBe(0)
    expect(uncertain.regions[0]!.d.boundaryPortOrderPreserved).toBeUndefined()
  }
  const layers = makeBoundaryPortOrderGraph()
  layers.regions[1]!.d.center.y = 0
  layers.regions[1]!.d.height = 2
  layers.ports[1]!.d.z = 1
  expect(certifyPipeline9BoundaryPortOrder({ graph: layers, terminalRegionIds: new Set() })).toBe(1)
  const endpoint = makeBoundaryPortOrderGraph()
  expect(certifyPipeline9BoundaryPortOrder({ graph: endpoint, terminalRegionIds: new Set(["center"]) })).toBe(0)
  expect(endpoint.regions[0]!.d.boundaryPortOrderPreserved).toBeUndefined()
  const contradictory = makeBoundaryPortOrderGraph()
  const originalData = contradictory.regions[1]!.d
  const data = originalData as typeof originalData & {
    bounds?: { minX: number; maxX: number; minY: number; maxY: number }
  }
  data.bounds = { minX: 1.1, maxX: 3, minY: -1, maxY: 0 }
  expect(certifyPipeline9BoundaryPortOrder({ graph: contradictory, terminalRegionIds: new Set() })).toBe(0)
  expect(contradictory.regions[0]!.d.boundaryPortOrderPreserved).toBeUndefined()
})
