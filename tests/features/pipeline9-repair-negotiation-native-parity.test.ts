import { expect, test } from "bun:test"
import { NegotiateTraceClearanceSolver, type NegotiatedClearanceInput, type ClearancePathSearchStats } from "@tscircuit/repair04"
import { NegotiateTraceClearanceSolver as Pipeline9NegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/repairKernel/NegotiateTraceClearanceSolver"

test("Pipeline9 negotiation keeps native exact route witnesses, search sequence and accounting", () => {
  let calls = 0
  let maps = 0
  for (const layerCount of [2, 4]) {
    const bounds = { minX: -1.5, maxX: 1.5, minY: -1.5, maxY: 1.5 }
    const routes: NegotiatedClearanceInput["routes"] = [
      { connectionName: "horizontal", rootConnectionName: "net_a", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [] },
      { connectionName: "vertical", rootConnectionName: "net_b", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 }], vias: [] },
      { connectionName: "branch", rootConnectionName: "net_a", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0.5, y: -1, z: 0 }, { x: 0.5, y: 0.6, z: 0 }], vias: [] },
      { connectionName: "drill", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -0.5, y: 0.5, z: 0 }, { x: -0.5, y: 0.5, z: layerCount - 1 }], vias: [{ x: -0.5, y: 0.5 }] },
    ]
    const input: NegotiatedClearanceInput = {
      srj: { layerCount, minTraceWidth: 0.1, bounds, obstacles: [{ type: "rect", center: { x: 0.6, y: 0.2 }, width: 0.1, height: 0.2, layers: ["top"], ccwRotationDegrees: 31, connectedTo: ["foreign"] }], connections: routes.map((route) => ({ name: route.connectionName, rootConnectionName: route.rootConnectionName, pointsToConnect: route.route.map((p) => ({ x: p.x, y: p.y, layer: "top" })) })) },
      routes,
      bounds,
      dirtyRouteIndices: [0, 1, 2],
      isLocked: (): boolean => false,
      allowLayerChanges: true,
      traceClearance: 0.1,
      viaClearance: 0.1,
      viaHoleDiameter: 0.15,
      maxPathSearchNodes: 12000,
      maxPathSearchNodesPerCall: 2000,
      maxPathSearchCalls: 18,
      pathHeuristicWeight: 3,
    }
    const nativeSearches: ClearancePathSearchStats[] = []
    const denseSearches: ClearancePathSearchStats[] = []
    const native = new NegotiateTraceClearanceSolver({ ...input, onSearch: (stats): void => { nativeSearches.push({ ...stats }) } })
    const dense = new Pipeline9NegotiateTraceClearanceSolver({ ...input, onSearch: (stats): void => { denseSearches.push({ ...stats }) } })
    native.solve()
    dense.solve()
    expect(dense.getOutput()).toEqual(native.getOutput())
    expect(dense.stats).toEqual(native.stats)
    expect(denseSearches).toEqual(nativeSearches)
    calls += dense.diagnostics.additionalCostCalls
    maps += dense.diagnostics.ownerCostMapAllocations
    expect(dense.diagnostics.searchCount).toBe(nativeSearches.length)
  }
  expect(calls).toBeGreaterThan(0)
  expect(maps).toBeGreaterThan(0)
  expect(maps).toBeLessThan(calls)
})
