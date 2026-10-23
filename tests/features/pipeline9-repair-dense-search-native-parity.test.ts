import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { FindClearancePathSolver, type ClearancePathInput } from "@tscircuit/repair04"
import { FindClearancePathSolver as Pipeline9FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/repairKernel/FindClearancePathSolver"

test("Pipeline9 dense search preserves native routes, pops and ordered cost calls across grid and physical domains", () => {
  let denseLookups = 0
  let cacheHits = 0
  let viaLookups = 0
  let sparseLookups = 0
  let avoidedPoints = 0
  for (let index = 0; index < 80; index++) {
    const nx = index < 72 ? index % 4 + 1 : 24 + index % 4
    const ny = index < 72 ? Math.floor(index / 4) % 4 + 1 : 19 + index % 5
    const layerCount = index % 3 + 2
    const gridSize = 0.2
    const bounds = { minX: -0.63, minY: -0.47, maxX: -0.63 + nx * gridSize + 0.001, maxY: -0.47 + ny * gridSize + 0.001 }
    const start = { x: bounds.minX + 0.1, y: bounds.minY + 0.1, z: 0 }
    const end = { x: bounds.minX + (nx - 0.5) * gridSize, y: bounds.minY + (ny - 0.5) * gridSize, z: index % 2 ? layerCount - 1 : 0 }
    const routes: ClearancePathInput["routes"] = [{ connectionName: "signal", traceThickness: 0.04, viaDiameter: 0.08, route: [start, end], vias: [] }]
    const input: ClearancePathInput = {
      srj: {
        layerCount,
        allowBlindAndBuriedVias: index % 5 === 0,
        bounds,
        minTraceWidth: 0.04,
        defaultObstacleMargin: 0.01,
        minTraceToHoleEdgeClearance: 0.012,
        minViaEdgeToPadEdgeClearance: 0.013,
        connections: [{ name: "signal", pointsToConnect: [{ ...start, layer: "top", pcb_port_id: "a" }, { ...end, layer: "top", pcb_port_id: "b" }] }],
        obstacles: index % 3 === 0 ? [{ type: "rect", center: { x: bounds.minX + nx * 0.1, y: bounds.minY + ny * 0.1 }, width: 0.06, height: 0.1, ccwRotationDegrees: index * 13, layers: ["top"], connectedTo: index % 2 ? ["signal"] : ["foreign"] }] : [],
        traces: index % 7 === 0 ? [{ type: "pcb_trace", pcb_trace_id: "fixed", connection_name: "foreign", route: [{ route_type: "wire", x: bounds.minX + 0.3, y: bounds.minY + 0.1, width: 0.02, layer: "bottom" }, { route_type: "via", x: bounds.minX + 0.3, y: bounds.minY + 0.1, from_layer: "bottom", to_layer: "top", via_diameter: 0.05 }, { route_type: "wire", x: bounds.minX + 0.3, y: bounds.minY + 0.7, width: 0.02, layer: "top" }] }] : [],
      },
      routes,
      routeIndex: 0,
      start,
      end,
      bounds,
      gridSize,
      traceThickness: 0.04,
      traceClearance: 0.01,
      viaClearance: 0.01,
      viaHoleDiameter: 0.03,
      heuristicWeight: index % 2 ? 3 : 1,
      maxNodes: 2200,
    }
    const nativeHash = createHash("sha256")
    const denseHash = createHash("sha256")
    const cost = (hash: ReturnType<typeof createHash>): NonNullable<ClearancePathInput["getAdditionalEdgeCost"]> => (a: ClearancePathInput["start"], b: ClearancePathInput["start"]): number => {
      const value = Math.abs(a.x + b.y) * 0.03
      hash.update(JSON.stringify([a, b, value]))
      return value
    }
    const native = new FindClearancePathSolver({ ...structuredClone(input), getAdditionalEdgeCost: cost(nativeHash) })
    const dense = new Pipeline9FindClearancePathSolver({ ...structuredClone(input), getAdditionalEdgeCost: cost(denseHash) })
    native.solve()
    dense.solve()
    expect(dense.failed).toBe(native.failed)
    expect(dense.getOutput()).toEqual(native.getOutput())
    expect(dense.stats).toEqual(native.stats)
    expect(denseHash.digest("hex")).toBe(nativeHash.digest("hex"))
    cacheHits += dense.diagnostics.densePlanarEdgeCacheHits + dense.diagnostics.denseViaSiteCacheHits
    denseLookups += dense.diagnostics.densePlanarEdgeLookups
    viaLookups += dense.diagnostics.denseViaSiteLookups
    avoidedPoints += dense.diagnostics.neighborPointAllocationsAvoided
  }
  const bounds = { minX: -5, maxX: 5, minY: -5, maxY: 5 }
  const start = { x: -4, y: -4, z: 0 }, end = { x: 4, y: 4, z: 1 }
  const sparse: ClearancePathInput = { srj: { layerCount: 2, minTraceWidth: 0.1, bounds, obstacles: [], connections: [] }, routes: [{ connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3, route: [start, end], vias: [] }], routeIndex: 0, start, end, bounds, gridSize: 0.005, traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.1, maxNodes: 32 }
  const native = new FindClearancePathSolver(structuredClone(sparse))
  const dense = new Pipeline9FindClearancePathSolver(structuredClone(sparse))
  native.solve()
  dense.solve()
  expect(dense.getOutput()).toEqual(native.getOutput())
  expect(dense.stats).toEqual(native.stats)
  sparseLookups += dense.diagnostics.sparseEdgeLookups
  expect(cacheHits).toBeGreaterThan(0)
  expect(denseLookups).toBeGreaterThan(0)
  expect(viaLookups).toBeGreaterThan(0)
  expect(sparseLookups).toBeGreaterThan(0)
  expect(avoidedPoints).toBeGreaterThan(0)
})
