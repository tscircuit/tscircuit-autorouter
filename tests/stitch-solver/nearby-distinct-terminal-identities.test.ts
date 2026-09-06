import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

type RoutePoint = HighDensityIntraNodeRoute["route"][number]

test("nearby distinct PCB terminals retain their identities and exact copper path", (): void => {
  const points: RoutePoint[] = [
    { x: 0, y: 0, z: 1 },
    { x: 1, y: 0, z: 1 },
    { x: 1, y: 1, z: 1 },
    { x: 0.005, y: 0.005, z: 1 },
  ]
  const connections: SimpleRouteConnection[] = [
    {
      name: "nearby-terminal-net",
      pointsToConnect: [
        { x: 0, y: 0, layer: "bottom", pcb_port_id: "start-port" },
        { x: 0.005, y: 0.005, layer: "bottom", pcb_port_id: "end-port" },
      ],
    },
  ]
  const fragments = points.slice(0, -1).map(
    (point, index): HighDensityIntraNodeRoute => ({
      connectionName: connections[0]!.name,
      ...(index === 0 ? { startPcbPortId: "start-port" } : {}),
      ...(index === points.length - 2 ? { endPcbPortId: "end-port" } : {}),
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [point, points[index + 1]!],
      vias: [],
    }),
  )
  const fragmentSnapshot = structuredClone(fragments)
  const connectionSnapshot = structuredClone(connections)

  // The terminals are within the geometric endpoint-clustering tolerance,
  // but they are different declared ports at different physical coordinates.
  // Three existing fragments also require endpoint-path selection to retain
  // both terminal identities instead of collapsing the start and end keys.
  expect(fragments).toHaveLength(3)
  for (const reverseInput of [false, true]) {
    const routes = reverseInput
      ? [...fragments].reverse().map(
          (route): HighDensityIntraNodeRoute => ({
            ...route,
            startPcbPortId: route.endPcbPortId,
            endPcbPortId: route.startPcbPortId,
            route: [...route.route].reverse(),
          }),
        )
      : fragments
    const inputSnapshot = structuredClone(routes)
    const solver = new MultipleHighDensityRouteStitchSolver3({
      connections,
      hdRoutes: routes,
      layerCount: 2,
      allowedLayerTransitionPointKeys: new Set<string>(),
      preserveTerminalPcbPortIds: true,
    })
    solver.solve()

    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(solver.mergedHdRoutes).toHaveLength(1)
    const merged = solver.mergedHdRoutes[0]!
    const startsAtStart = merged.startPcbPortId === "start-port"
    const expectedPoints = startsAtStart ? points : [...points].reverse()
    expect(merged.startPcbPortId).toBe(
      startsAtStart ? "start-port" : "end-port",
    )
    expect(merged.endPcbPortId).toBe(
      startsAtStart ? "end-port" : "start-port",
    )
    expect(
      merged.route.map(({ x, y, z }): RoutePoint => ({ x, y, z })),
    ).toEqual(expectedPoints)
    expect(merged.vias).toEqual([])
    expect(merged.traceThickness).toBe(0.15)

    const simplifiedRoute = convertHdRouteToSimplifiedRoute(merged, 2)
    expect(simplifiedRoute).toHaveLength(expectedPoints.length)
    for (const [index, point] of expectedPoints.entries()) {
      expect(simplifiedRoute[index]).toMatchObject({
        route_type: "wire",
        x: point.x,
        y: point.y,
        layer: "bottom",
        width: 0.15,
      })
    }
    expect(routes).toEqual(inputSnapshot)
    expect(fragments).toEqual(fragmentSnapshot)
    expect(connections).toEqual(connectionSnapshot)
  }
})
