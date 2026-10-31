import type { HighDensityRoute, SimpleRouteJson } from "high-density-repair03/lib"

type Point = HighDensityRoute["route"][number]

/** Six distinct nets; n2 and n3 start with a positive copper gap. */
export const createTraceViaShortInput = (): {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
} => {
  const hdRoutes: HighDensityRoute[] = [
    [0.01, 0.42, 0.08, 1],
    [0.31, 1.31, 0.13, 0],
    [0.65, 2.57, 0.55, 0],
    [0.8, 1.18, 0.86, 1],
    [1.08, 2.07, 1.24, 1],
    [1.3, 1.91, 1.32, 0],
  ].map(([y, x, viaY, z], index) => ({
    connectionName: `n${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ x: x!, y: viaY! }],
    route: [
      { x: 0, y: y!, z: z! },
      { x: x!, y: viaY!, z: z! },
      { x: x!, y: viaY!, z: 1 - z! },
      { x: 3, y: y!, z: 1 - z! },
    ],
  }))
  return {
    hdRoutes,
    srj: {
      bounds: { minX: -1, minY: -1, maxX: 4, maxY: 3 },
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.3,
      obstacles: [],
      connections: hdRoutes.map((route) => ({
        name: route.connectionName,
        pointsToConnect: [],
      })),
    },
  }
}

/** Independent point-to-segment oracle for this two-layer through-via fixture. */
export const getTraceViaCopperGap = (routes: HighDensityRoute[]): number => {
  const trace = routes.find((route) => route.connectionName === "n2")!
  const viaRoute = routes.find((route) => route.connectionName === "n3")!
  let gap = Infinity
  for (const via of viaRoute.vias) {
    for (let index = 1; index < trace.route.length; index++) {
      const start: Point = trace.route[index - 1]!
      const end: Point = trace.route[index]!
      if (start.z !== end.z) continue
      const dx = end.x - start.x
      const dy = end.y - start.y
      const squaredLength = dx * dx + dy * dy
      const t =
        squaredLength === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((via.x - start.x) * dx + (via.y - start.y) * dy) /
                  squaredLength,
              ),
            )
      gap = Math.min(
        gap,
        Math.hypot(via.x - start.x - t * dx, via.y - start.y - t * dy) -
          (trace.traceThickness + viaRoute.viaDiameter) / 2,
      )
    }
  }
  return gap
}
