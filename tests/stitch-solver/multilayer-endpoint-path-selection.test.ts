import { expect, test } from "bun:test"
import {
  EndpointClusterIndex,
  selectRoutesAlongEndpointPath,
} from "lib/solvers/RouteStitchingSolver/routeStitchingEndpointHelpers"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("endpoint paths retain a farther same-layer branch before a buried via", () => {
  const makeRoute = (
    start: HighDensityIntraNodeRoute["route"][number],
    end: HighDensityIntraNodeRoute["route"][number],
  ): HighDensityIntraNodeRoute => ({
    connectionName: "preloaded_section",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [start, end],
    vias: start.z === end.z ? [] : [{ x: end.x, y: end.y }],
    jumpers: [],
  })
  const sameLayerTerminalBranch = makeRoute(
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
  )
  const middleBranch = makeRoute({ x: 0, y: 0, z: 1 }, { x: 2, y: 0, z: 1 })
  const endBranch = makeRoute({ x: 2, y: 0, z: 1 }, { x: 3, y: 0, z: 1 })

  const selectedRoutes = selectRoutesAlongEndpointPath({
    connectionName: "preloaded_section",
    hdRoutes: [sameLayerTerminalBranch, middleBranch, endBranch],
    start: { x: 0.1, y: 0, z: 0 },
    end: { x: 3, y: 0, z: 1 },
    endpointIndex: new EndpointClusterIndex(true),
    canStitchBetweenTerminals: () => true,
  })

  expect(selectedRoutes).not.toBeNull()
  expect(selectedRoutes!.hdRoutes).toHaveLength(3)
  expect(selectedRoutes!.hdRoutes).toContain(sameLayerTerminalBranch)
})
