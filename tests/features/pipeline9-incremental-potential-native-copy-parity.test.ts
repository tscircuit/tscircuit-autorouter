import { expect, test } from "bun:test"
import { FindClearancePathSolver as Native, type ClearancePathInput } from "@tscircuit/repair04"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/incrementalRepair/FindClearancePathSolver"

test("the licensed native kernel retains physical, drill and search semantics when no relaxed field is supplied", () => {
  for (const blind of [false, true]) for (const layers of [2, 4]) {
    const route = { connectionName: "wire", rootConnectionName: "own", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: layers - 1 }], vias: [] }
    const input: ClearancePathInput = { srj: { layerCount: layers, allowBlindAndBuriedVias: blind, minTraceWidth: 0.1, minTraceToHoleEdgeClearance: 0.2, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, connections: [{ name: "wire", rootConnectionName: "own", pointsToConnect: [] }], obstacles: [{ type: "rect", center: { x: 0, y: 0 }, width: 0.4, height: 1.5, ccwRotationDegrees: 25, layers: ["top"], connectedTo: ["foreign"] }, { type: "oval", shape: "circle", isNonPlatedHole: true, center: { x: 0.5, y: 0.5 }, width: 0.2, height: 0.2, layers: ["top", "bottom"], connectedTo: [] }] }, routes: [route], routeIndex: 0, start: route.route[0]!, end: route.route[1]!, bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 }, traceThickness: 0.1, traceClearance: 0.1, viaClearance: 0.2, viaHoleDiameter: 0.15, gridSize: 0.1, maxNodes: 10000, heuristicWeight: 3 }
    const native = new Native(input)
    const copied = new FindClearancePathSolver(input)
    native.solve()
    copied.solve()
    expect(copied.getOutput()).toEqual(native.getOutput())
    expect(copied.stats).toEqual(native.stats)
    expect(copied.iterations).toBe(native.iterations)
    expect(copied.failed).toBe(native.failed)
  }
})
