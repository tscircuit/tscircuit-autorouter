import { expect, test } from "bun:test"
import { PolyHypergraphPortPointPathingSolver } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/PolyHypergraphPortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"

test("octagonal terminals reject a blocked requested layer instead of attaching to another layer", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    obstacles: [{ type: "rect", center: { x: 5, y: 5 }, width: 2, height: 2,
      layers: ["top"], connectedTo: [] }],
    connections: [{ name: "blocked", pointsToConnect: [
      { x: 5, y: 5, layer: "top" }, { x: 9, y: 9, layer: "top" },
    ] }],
  }
  expect(() => new PolyHypergraphPortPointPathingSolver({
    srj, regionShape: "octagonal",
  })).toThrow('cannot place start of "blocked" on its requested layer')
  srj.connections[0]!.pointsToConnect[0] = { x: 5, y: 5, layer: "bottom" }
  const solver = new PolyHypergraphPortPointPathingSolver({ srj, regionShape: "octagonal" })
  solver.solve()
  expect(solver.solved).toBe(true)
  const terminal = solver.serializedGraph.ports.find((port) =>
    port.portId === "terminal-start-port-blocked")!
  expect(terminal.d.z).toBe(1)
})
