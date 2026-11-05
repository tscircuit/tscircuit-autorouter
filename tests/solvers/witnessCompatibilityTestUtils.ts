import { RouteWitnessCompatibilityCatalog } from "lib/solvers/HighDensitySolver/RouteWitnessCompatibilityCatalog"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type Point = { x: number; y: number; z: number }

export function witnessRoute(connectionName: string, points: Point[]): HighDensityIntraNodeRoute {
  const vias: Array<{ x: number; y: number }> = []
  for (let i = 1; i < points.length; i++) {
    if (points[i].z !== points[i - 1].z)
      vias.push({ x: points[i].x, y: points[i].y })
  }
  return { connectionName, rootConnectionName: `root-${connectionName}`, traceThickness: 0.1, viaDiameter: 0.3, route: points, vias, regionId: "region" }
}

export function witnessCatalog(routes: HighDensityIntraNodeRoute[], overrides: Partial<ConstructorParameters<typeof RouteWitnessCompatibilityCatalog>[0]> = {}): RouteWitnessCompatibilityCatalog {
  return new RouteWitnessCompatibilityCatalog({
    tasks: routes.map((route) => ({ connectionName: route.connectionName, rootConnectionName: route.rootConnectionName, points: [route.route[0]!, route.route.at(-1)!] })),
    owners: routes.map((route) => route.connectionName),
    layerCount: 3,
    clearance: 0.1,
    viaHoleDiameter: 0.15,
    minimumHoleGap: 0.1,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    regionId: "region",
    ...overrides,
  })
}

export function witnessCharge(_name: string, count = 1): void {
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error("Invalid compatibility test work charge")
  // Pure catalog fixtures have no external solver budget. Integration tests
  // below use the actual priority family's work accounting instead.
}
