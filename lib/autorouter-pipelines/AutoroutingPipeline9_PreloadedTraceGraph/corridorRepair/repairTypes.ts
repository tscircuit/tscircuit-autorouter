import type { getFixedObstacleViolations } from "@tscircuit/repair04"

// Resolve the pinned repair package's own SRJ/route types, including oval pads.
type PhysicalInput = Parameters<typeof getFixedObstacleViolations>[0]
export type SimpleRouteJson = PhysicalInput["srj"]
export type HighDensityRoute = PhysicalInput["routes"][number]
export type SimplifiedPcbTrace = NonNullable<SimpleRouteJson["traces"]>[number]
