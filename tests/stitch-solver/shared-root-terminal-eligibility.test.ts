import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types"

test("shared-root paths exclude borrowed terminal branches and reject invalid owned tags", (): void => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "target",
      __rootConnectionNames: ["net"],
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "a" },
        { x: 10, y: 0, layer: "top", pcb_port_id: "b" },
      ],
    },
    {
      name: "borrowed",
      __rootConnectionNames: ["net"],
      pointsToConnect: [
        { x: 2, y: 0, layer: "top" },
        { x: 8, y: 0, layer: "top", pcb_port_id: "c" },
      ],
    },
    {
      name: "other",
      __rootConnectionNames: ["net"],
      pointsToConnect: [
        { x: 20, y: 0, layer: "top" },
        { x: 22, y: 0, layer: "top" },
      ],
    },
  ]
  const makeRoute = (
    connectionName: string,
    startX: number,
    endX: number,
    terminalIds: { startPcbPortId?: string; endPcbPortId?: string } = {},
  ): HighDensityIntraNodeRoute => ({
    connectionName,
    rootConnectionName: "net",
    route: [
      { x: startX, y: 0, z: 0 },
      { x: endX, y: 0, z: 0 },
    ],
    traceThickness: 0.15,
    viaDiameter: 0.3,
    vias: [],
    ...terminalIds,
  })
  const ownedRoutes = [
    makeRoute("target", 0, 2, { startPcbPortId: "a" }),
    makeRoute("target", 8, 10, { endPcbPortId: "b" }),
  ]
  const borrowedRoute = makeRoute("borrowed", 2, 8, { endPcbPortId: "c" })
  const params = {
    connections,
    hdRoutes: [...ownedRoutes, borrowedRoute, makeRoute("other", 20, 22)],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  }
  const solver = new MultipleHighDensityRouteStitchSolver3(params)
  const targetIslands = solver.unsolvedRoutes.filter(
    (route) => route.connectionName === "target",
  )

  expect(targetIslands).toHaveLength(2)
  expect(targetIslands.flatMap((island) => island.hdRoutes)).toEqual(
    ownedRoutes,
  )
  expect(borrowedRoute.endPcbPortId).toBe("c")
  const bridgeRoute = makeRoute("borrowed", 2, 8)
  const bridgeSolver = new MultipleHighDensityRouteStitchSolver3({
    ...params,
    hdRoutes: [...ownedRoutes, bridgeRoute, makeRoute("other", 20, 22)],
  })
  const bridgedTarget = bridgeSolver.unsolvedRoutes.filter(
    (route) => route.connectionName === "target",
  )
  expect(bridgedTarget).toHaveLength(1)
  expect(bridgedTarget[0]!.hdRoutes).toEqual([
    ownedRoutes[0]!,
    bridgeRoute,
    ownedRoutes[1]!,
  ])
  const malformedSolver = new MultipleHighDensityRouteStitchSolver3({
    ...params,
    connections: [connections[0]!],
    hdRoutes: [makeRoute("target", 0, 10, { startPcbPortId: "unknown" })],
  })
  expect(() => malformedSolver.solve()).toThrow(
    'unknown PCB terminal "unknown"',
  )
})
