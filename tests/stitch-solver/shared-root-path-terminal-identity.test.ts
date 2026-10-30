import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("a shared-root path can pass another known terminal without accepting foreign tags", (): void => {
  const a = { x: 0, y: 0, z: 0, pcb_port_id: "a" }
  const b = { x: 2, y: 0, z: 0, pcb_port_id: "b" }
  const c = { x: 1, y: 0, z: 0, pcb_port_id: "c" }
  const left = { x: 0.5, y: 0, z: 0 }
  const right = { x: 1.5, y: 0, z: 0 }
  const connections: SimpleRouteConnection[] = [
    {
      name: "ab",
      __rootConnectionNames: ["signal"],
      pointsToConnect: [a, b].map((p) => ({ ...p, layer: "top" as const })),
    },
    {
      name: "bc",
      __rootConnectionNames: ["signal"],
      pointsToConnect: [b, c].map((p) => ({ ...p, layer: "top" as const })),
    },
  ]
  const common = {
    rootConnectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
  }
  const hdRoutes: HighDensityIntraNodeRoute[] = [
    { ...common, connectionName: "ab", startPcbPortId: "a", route: [a, left] },
    { ...common, connectionName: "ab", endPcbPortId: "b", route: [right, b] },
    { ...common, connectionName: "bc", endPcbPortId: "c", route: [left, c] },
    {
      ...common,
      connectionName: "bc",
      startPcbPortId: "b",
      endPcbPortId: "c",
      route: [b, right, c],
    },
  ]
  const original = structuredClone(hdRoutes)
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections,
    hdRoutes,
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(2)
  const ab = solver.mergedHdRoutes.find(
    (route) => route.connectionName === "ab",
  )!
  expect({
    [ab.startPcbPortId!]: ab.route[0],
    [ab.endPcbPortId!]: ab.route.at(-1),
  }).toEqual({
    a: { x: a.x, y: a.y, z: a.z },
    b: { x: b.x, y: b.y, z: b.z },
  })
  expect(hdRoutes).toEqual(original)
  const invalid = structuredClone(hdRoutes)
  invalid[3]!.endPcbPortId = "foreign"
  expect((): void => {
    const invalidSolver = new MultipleHighDensityRouteStitchSolver3({
      connections,
      hdRoutes: invalid,
      layerCount: 2,
      preserveTerminalPcbPortIds: true,
    })
    invalidSolver.solve()
  }).toThrow('unknown PCB terminal "foreign"')
})
