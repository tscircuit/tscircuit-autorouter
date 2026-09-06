import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityIntraNodeRoute["route"][number]

test("terminal path selection skips a blocked nearest approach for a clear existing path", (): void => {
  const alternatePoints: RoutePoint[] = [
    { x: 0, y: 0.6, z: 0 },
    { x: 0, y: 2, z: 0 },
    { x: 4, y: 2, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  const shortRoute: HighDensityIntraNodeRoute = {
    connectionName: "approach-net",
    endPcbPortId: "end-port",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0.5, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ],
    vias: [],
  }
  const alternateRoutes = alternatePoints.slice(0, -1).map(
    (point, index): HighDensityIntraNodeRoute => ({
      connectionName: shortRoute.connectionName,
      ...(index === alternatePoints.length - 2
        ? { endPcbPortId: "end-port" }
        : {}),
      traceThickness: shortRoute.traceThickness,
      viaDiameter: shortRoute.viaDiameter,
      route: [point, alternatePoints[index + 1]!],
      vias: [],
    }),
  )
  const foreignRoute: HighDensityIntraNodeRoute = {
    connectionName: "foreign-net",
    startPcbPortId: "foreign-start",
    endPcbPortId: "foreign-end",
    traceThickness: 0.05,
    viaDiameter: 0.3,
    route: [
      { x: 0.25, y: -0.2, z: 0 },
      { x: 0.25, y: 0.2, z: 0 },
    ],
    vias: [],
  }
  const connections: SimpleRouteConnection[] = [
    {
      name: shortRoute.connectionName,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "start-port" },
        { x: 4, y: 0, layer: "top", pcb_port_id: "end-port" },
      ],
    },
    {
      name: foreignRoute.connectionName,
      pointsToConnect: [
        { x: 0.25, y: -0.2, layer: "top", pcb_port_id: "foreign-start" },
        { x: 0.25, y: 0.2, layer: "top", pcb_port_id: "foreign-end" },
      ],
    },
  ]
  const originalRoutes = [shortRoute, foreignRoute, ...alternateRoutes]
  const inputSnapshot = structuredClone({ originalRoutes, connections })
  const completePoints: RoutePoint[] = [
    { x: 0, y: 0, z: 0 },
    ...alternatePoints,
  ]

  // The closest route endpoint is half a unit from the start, but reaching
  // it crosses foreign copper. The slightly farther vertical approach stays
  // clear and reaches the same terminal through three existing fragments.
  for (const reverseInput of [false, true]) {
    const routes = reverseInput
      ? [...originalRoutes].reverse().map(
          (route): HighDensityIntraNodeRoute => ({
            ...route,
            startPcbPortId: route.endPcbPortId,
            endPcbPortId: route.startPcbPortId,
            route: [...route.route].reverse(),
          }),
        )
      : originalRoutes
    const routeSnapshot = structuredClone(routes)
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
    expect(solver.mergedHdRoutes).toHaveLength(2)
    const merged = solver.mergedHdRoutes.find(
      (route): boolean => route.connectionName === shortRoute.connectionName,
    )!
    const startsAtStart = merged.startPcbPortId === "start-port"
    expect(merged.startPcbPortId).toBe(
      startsAtStart ? "start-port" : "end-port",
    )
    expect(merged.endPcbPortId).toBe(
      startsAtStart ? "end-port" : "start-port",
    )
    expect(merged.route).toEqual(
      startsAtStart ? completePoints : [...completePoints].reverse(),
    )
    expect(merged.traceThickness).toBe(shortRoute.traceThickness)
    expect(merged.vias).toEqual([])

    const foreignMerged = solver.mergedHdRoutes.find(
      (route): boolean => route.connectionName === foreignRoute.connectionName,
    )!
    const foreignStartsAtStart =
      foreignMerged.startPcbPortId === "foreign-start"
    expect(foreignMerged.startPcbPortId).toBe(
      foreignStartsAtStart ? "foreign-start" : "foreign-end",
    )
    expect(foreignMerged.endPcbPortId).toBe(
      foreignStartsAtStart ? "foreign-end" : "foreign-start",
    )
    expect(foreignMerged.route).toEqual(
      foreignStartsAtStart
        ? foreignRoute.route
        : [...foreignRoute.route].reverse(),
    )
    expect(foreignMerged.traceThickness).toBe(foreignRoute.traceThickness)
    expect(foreignMerged.vias).toEqual([])
    expect(routes).toEqual(routeSnapshot)
    expect({ originalRoutes, connections }).toEqual(inputSnapshot)
  }
})
