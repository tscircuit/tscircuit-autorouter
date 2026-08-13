import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("a borrowed same-root bridge does not import sibling terminal identities", () => {
  const makeConnection = (
    name: string,
    startX: number,
    endX: number,
  ): SimpleRouteConnection =>
    ({
      name,
      pointsToConnect: [
        {
          x: startX,
          y: 0,
          layer: "top",
          pcb_port_id: `${name}_start`,
        },
        {
          x: endX,
          y: 0,
          layer: "top",
          pcb_port_id: `${name}_end`,
        },
      ],
      __rootConnectionNames: ["root"],
    }) as SimpleRouteConnection
  const makeRoute = (
    connectionName: string,
    startX: number,
    endX: number,
    terminalIds: {
      startPcbPortId?: string
      endPcbPortId?: string
    } = {},
  ): HighDensityIntraNodeRoute => ({
    connectionName,
    rootConnectionName: "root",
    route: [
      { x: startX, y: 0, z: 0 },
      { x: endX, y: 0, z: 0 },
    ],
    vias: [],
    jumpers: [],
    traceThickness: 0.15,
    viaDiameter: 0.3,
    ...terminalIds,
  })

  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      makeConnection("current", 0, 10),
      makeConnection("sibling", 4, 6),
      makeConnection("decoy", 20, 21),
    ],
    hdRoutes: [
      makeRoute("current", 0, 4, {
        startPcbPortId: "current_start",
      }),
      makeRoute("current", 6, 10, {
        endPcbPortId: "current_end",
      }),
      makeRoute("sibling", 4, 6, {
        startPcbPortId: "sibling_start",
        endPcbPortId: "sibling_end",
      }),
      makeRoute("decoy", 20, 21),
    ],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })

  const currentRoute = solver.unsolvedRoutes.find(
    (route) => route.connectionName === "current",
  )!
  const bridgeRoute = currentRoute.hdRoutes.find(
    (route) => route.connectionName === "sibling",
  )!

  expect(currentRoute.hdRoutes).toHaveLength(3)
  expect(bridgeRoute.startPcbPortId).toBeUndefined()
  expect(bridgeRoute.endPcbPortId).toBeUndefined()
  expect(
    currentRoute.hdRoutes.find((route) => route.startPcbPortId)
      ?.startPcbPortId,
  ).toBe("current_start")
  expect(
    currentRoute.hdRoutes.find((route) => route.endPcbPortId)?.endPcbPortId,
  ).toBe("current_end")
})
