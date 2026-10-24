import { expect, test } from "bun:test"
import { CollectiveClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/CollectiveClearanceSolver"
import { getRepairViaGeometry } from "@tscircuit/repair04"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("collective projection preserves terminals, junctions, through-obstacle transitions and width metadata", (): void => {
  const routes: HighDensityRoute[] = [{
    connectionName: "wire_a", rootConnectionName: "net_a", traceThickness: 0.1, viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0, pcb_port_id: "terminal_a" },
      { x: -1, y: 0, z: 0, traceThickness: 0.15 },
      { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 1, pcb_port_id: "terminal_b" },
    ], vias: [],
  }, {
    connectionName: "wire_junction", rootConnectionName: "net_a", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: -1, y: -1, z: 0 }], vias: [],
  }, {
    connectionName: "wire_b", rootConnectionName: "net_b", traceThickness: 0.1, viaDiameter: 0.3,
    route: [
      { x: -2, y: 0.18, z: 0 }, { x: -1, y: 0.18, z: 0 },
      { x: 0, y: 0.18, z: 0 }, { x: 2, y: 0.18, z: 0 },
    ], vias: [],
  }]
  const original = structuredClone(routes)
  const solver = new CollectiveClearanceSolver({
    srj: {
      layerCount: 2, minTraceWidth: 0.1,
      bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
      obstacles: [], connections: [],
    },
    routes, bounds: { minX: -3, minY: -3, maxX: 3, maxY: 3 },
    boundaryMargin: 0, allowViaMovement: true,
    lockedPointIndices: routes.map((route): boolean[] => route.route.map((): boolean => false)),
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  const output: HighDensityRoute[] = solver.getOutput()
  expect(output[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(output[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(output[0]!.route[1]).toEqual(original[0]!.route[1])
  expect(output[1]!.route).toEqual(original[1]!.route)
  expect(output[0]!.route[2]).toEqual(original[0]!.route[2])
  expect(output[0]!.route[3]).toEqual(original[0]!.route[3])
  expect(getRepairViaGeometry(output[0]!, 2)).toEqual([])
  for (let index = 0; index < routes.length; index++) {
    expect(output[index]!.connectionName).toBe(original[index]!.connectionName)
    expect(output[index]!.rootConnectionName).toBe(original[index]!.rootConnectionName)
    expect(output[index]!.route.length).toBe(original[index]!.route.length)
    for (let pointIndex = 0; pointIndex < routes[index]!.route.length; pointIndex++) {
      const point = output[index]!.route[pointIndex]!
      const before = original[index]!.route[pointIndex]!
      expect(point.z).toBe(before.z)
      expect(point.traceThickness).toBe(before.traceThickness)
      expect(Math.abs(point.x - before.x)).toBeLessThanOrEqual(0.25)
      expect(Math.abs(point.y - before.y)).toBeLessThanOrEqual(0.25)
    }
  }
  expect(routes).toEqual(original)
})
