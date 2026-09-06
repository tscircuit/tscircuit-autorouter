import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

type RoutePoint = HighDensityIntraNodeRoute["route"][number]

test("an exact terminal path wins over a nearby via shortcut requiring new gaps", (): void => {
  const chainPoints: HighDensityIntraNodeRoute["route"] = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 3, z: 0 },
    { x: 3, y: 3, z: 0 },
    { x: 6, y: 3, z: 0 },
    { x: 6, y: 0, z: 0 },
  ]
  const completeRoute: HighDensityIntraNodeRoute = {
    connectionName: "complete-path-net",
    startPcbPortId: "start-port",
    endPcbPortId: "end-port",
    traceThickness: 0.15,
    viaDiameter: 0.6,
    route: chainPoints,
    vias: [],
  }
  const chainFragments = chainPoints.slice(0, -1).map(
    (point, index): HighDensityIntraNodeRoute => ({
      connectionName: completeRoute.connectionName,
      ...(index === 0 ? { startPcbPortId: "start-port" } : {}),
      ...(index === chainPoints.length - 2 ? { endPcbPortId: "end-port" } : {}),
      traceThickness: completeRoute.traceThickness,
      viaDiameter: completeRoute.viaDiameter,
      route: [point, chainPoints[index + 1]!],
      vias: [],
    }),
  )
  const nearbyViaSpur: HighDensityIntraNodeRoute = {
    connectionName: completeRoute.connectionName,
    traceThickness: completeRoute.traceThickness,
    viaDiameter: completeRoute.viaDiameter,
    route: [
      { x: 0.5, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 1 },
      { x: 6, y: 0.5, z: 1 },
      { x: 6, y: 0.5, z: 0 },
    ],
    vias: [
      { x: 0.5, y: 0 },
      { x: 6, y: 0.5 },
    ],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: completeRoute.traceThickness,
    minViaDiameter: completeRoute.viaDiameter,
    minViaHoleDiameter: 0.3,
    bounds: { minX: -1, maxX: 7, minY: -1, maxY: 4 },
    obstacles: [],
    connections: [
      {
        name: completeRoute.connectionName,
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "start-port" },
          { x: 6, y: 0, layer: "top", pcb_port_id: "end-port" },
        ],
      },
    ],
  }
  const srjSnapshot = structuredClone(srj)
  const originalRoutes = [nearbyViaSpur, ...chainFragments]
  const originalSnapshot = structuredClone(originalRoutes)
  const completeTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "complete-path-trace",
    connection_name: completeRoute.connectionName,
    route: convertHdRouteToSimplifiedRoute(completeRoute, srj.layerCount),
  }
  const baselineCircuitJson = convertToCircuitJson(srj, [completeTrace])
  expect(getDrcErrors(baselineCircuitJson).errors).toEqual([])

  // The existing chain has four route edges. The shortcut has only three
  // graph edges, but two are invented gaps and its middle edge adds two vias.
  // Comparing only graph hop counts therefore selects the wrong copper.
  expect(chainFragments).toHaveLength(4)
  expect(nearbyViaSpur.vias).toHaveLength(2)
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
    const inputSnapshot = structuredClone(routes)
    const solver = new MultipleHighDensityRouteStitchSolver3({
      connections: srj.connections,
      hdRoutes: routes,
      layerCount: srj.layerCount,
      preserveTerminalPcbPortIds: true,
    })
    solver.solve()

    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(true)
    expect(solver.mergedHdRoutes).toHaveLength(1)
    const merged = solver.mergedHdRoutes[0]!
    const startsAtStart = merged.startPcbPortId === "start-port"
    const expectedPoints = startsAtStart
      ? chainPoints
      : [...chainPoints].reverse()
    expect(merged.startPcbPortId).toBe(
      startsAtStart ? "start-port" : "end-port",
    )
    expect(merged.endPcbPortId).toBe(startsAtStart ? "end-port" : "start-port")
    expect(
      merged.route.map(
        ({ x, y, z }): RoutePoint => ({
          x,
          y,
          z,
        }),
      ),
    ).toEqual(expectedPoints)
    expect(merged.vias).toEqual([])
    expect(merged.traceThickness).toBe(completeRoute.traceThickness)
    for (const point of merged.route) {
      expect(point.x).toBeGreaterThanOrEqual(srj.bounds.minX)
      expect(point.x).toBeLessThanOrEqual(srj.bounds.maxX)
      expect(point.y).toBeGreaterThanOrEqual(srj.bounds.minY)
      expect(point.y).toBeLessThanOrEqual(srj.bounds.maxY)
    }

    const simplifiedRoute = convertHdRouteToSimplifiedRoute(
      merged,
      srj.layerCount,
    )
    expect(simplifiedRoute[0]).toMatchObject({
      route_type: "wire",
      x: expectedPoints[0]!.x,
      y: expectedPoints[0]!.y,
      layer: "top",
    })
    expect(simplifiedRoute[simplifiedRoute.length - 1]).toMatchObject({
      route_type: "wire",
      x: expectedPoints[expectedPoints.length - 1]!.x,
      y: expectedPoints[expectedPoints.length - 1]!.y,
      layer: "top",
    })
    const circuitJson = convertToCircuitJson(srj, [
      { ...completeTrace, route: simplifiedRoute },
    ])
    expect(
      circuitJson.filter((element): boolean => element.type === "pcb_via"),
    ).toEqual([])
    expect(getDrcErrors(circuitJson).errors).toEqual([])
    expect(routes).toEqual(inputSnapshot)
    expect(originalRoutes).toEqual(originalSnapshot)
    expect(srj).toEqual(srjSnapshot)
  }
})
