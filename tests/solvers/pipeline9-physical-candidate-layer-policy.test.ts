import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9PhysicalRouteValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9PhysicalRouteValidator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("candidate checks preserve physical via spans, own plated copper, width floors and declared clearances", (): void => {
  const route: HighDensityRoute = {
    connectionName: "signal",
    rootConnectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -0.5, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0.5, z: 1 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const srj: SimpleRouteJson = {
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    layerCount: 8,
    minTraceWidth: 0.1,
    allowBlindAndBuriedVias: false,
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.3,
        height: 0.3,
        layers: ["bottom"],
        connectedTo: [],
      },
    ],
    connections: [{ name: "signal", pointsToConnect: [] }],
  }
  const connMap = new ConnectivityMap({ own: ["signal", "own-plated-pad"] })
  const validator = (physicalSrj: SimpleRouteJson) =>
    createPipeline9PhysicalRouteValidator({
      physicalSrj,
      connMap,
      obstacleMargin: 0.8,
    })
  expect(validator(srj)([route])).toBe(false)
  expect(validator({ ...srj, allowBlindAndBuriedVias: true })([route])).toBe(
    true,
  )
  const plated = {
    ...srj,
    obstacles: [
      {
        ...srj.obstacles[0]!,
        layers: [
          "top",
          "inner1",
          "inner2",
          "inner3",
          "inner4",
          "inner5",
          "inner6",
          "bottom",
        ],
        connectedTo: ["signal", "own-plated-pad", "pcb_plated_hole_own"],
        circuitJsonMetadata: { pcb_plated_hole_id: "pcb_plated_hole_own" },
      },
    ],
  }
  const ownPth: HighDensityRoute = {
    ...route,
    route: [
      { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
      { x: 0, y: 0, z: 7 },
    ],
    vias: [],
  }
  expect(validator(plated)([ownPth])).toBe(true)
  const beside: HighDensityRoute = {
    ...route,
    route: route.route.map((p) => ({ ...p, x: 0.4 })),
    vias: [{ x: 0.4, y: 0 }],
  }
  const padGap = { ...srj, minPadEdgeToPadEdgeClearance: 0.11 }
  expect(validator(padGap)([beside])).toBe(false)
  expect(
    validator({ ...padGap, minViaEdgeToPadEdgeClearance: 0.1 })([beside]),
  ).toBe(true)
  const thin: HighDensityRoute = {
    ...route,
    traceThickness: 0.02,
    route: [
      { x: -1, y: 0.26, z: 7 },
      { x: 1, y: 0.26, z: 7 },
    ],
    vias: [],
  }
  expect(validator({ ...srj, minTraceWidth: 0.1 })([thin])).toBe(false)
  expect(validator({ ...srj, minTraceWidth: 0.02 })([thin])).toBe(true)
  expect(validator(srj)).toBe(validator(srj))
})
