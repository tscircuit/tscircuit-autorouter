import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("a terminal claim does not force traversal of a spur beside anonymous connected copper", (): void => {
  const points: HighDensityIntraNodeRoute["route"] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 3, y: 0, z: 0 },
  ]
  const chain = points.slice(0, -1).map(
    (point, index): HighDensityIntraNodeRoute => ({
      connectionName: "terminal-adjacency-net",
      ...(index === 2 ? { endPcbPortId: "end-port" } : {}),
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [point, points[index + 1]!],
      vias: [],
    }),
  )
  const taggedSpur: HighDensityIntraNodeRoute = {
    connectionName: "terminal-adjacency-net",
    startPcbPortId: "start-port",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [points[0]!, { x: 0, y: 1, z: 0 }],
    vias: [],
  }
  const hdRoutes = [taggedSpur, ...chain]
  const inputSnapshot = structuredClone(hdRoutes)
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: taggedSpur.connectionName,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "start-port" },
          { x: 3, y: 0, layer: "top", pcb_port_id: "end-port" },
        ],
      },
    ],
    hdRoutes,
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
    allowedLayerTransitionPointKeys: new Set<string>(),
  })
  expect(solver.unsolvedRoutes).toHaveLength(1)
  const selected = solver.unsolvedRoutes[0]!
  expect(selected.hdRoutes).toHaveLength(3)
  expect(selected.hdRoutes).not.toContain(taggedSpur)
  expect(new Set(selected.hdRoutes).size).toBe(selected.hdRoutes.length)
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const merged = solver.mergedHdRoutes[0]!
  const startsAtStart = merged.startPcbPortId === "start-port"
  expect(merged.endPcbPortId).toBe(startsAtStart ? "end-port" : "start-port")
  expect(merged.route).toEqual(startsAtStart ? points : [...points].reverse())
  expect(merged.vias).toEqual([])
  expect(hdRoutes).toEqual(inputSnapshot)
})
