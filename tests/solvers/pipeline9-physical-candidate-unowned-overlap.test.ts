import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createPipeline9PhysicalRouteValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9PhysicalRouteValidator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("opaque unowned barriers enforce overlap independently of IDs while typed pads retain clearance", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    layerCount: 8,
    minTraceWidth: 0.1,
    defaultObstacleMargin: 0.8,
    minTraceToPadEdgeClearance: 0.3,
    minViaEdgeToPadEdgeClearance: 0.3,
    connections: [],
    obstacles: [
      {
        obstacleId: "pcb_keepout_fixed",
        type: "rect",
        center: { x: 0.32, y: 0 },
        width: 0.3,
        height: 1,
        layers: ["inner4"],
        connectedTo: [],
      },
    ],
  }
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: -0.5, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 7 },
      { x: 0, y: 0.5, z: 7 },
    ],
    vias: [{ x: 0, y: 0 }],
  }
  const connMap = new ConnectivityMap({})
  const overlap = {
    ...route,
    route: route.route.map((point) => ({ ...point, x: 0.03 })),
    vias: [{ x: 0.03, y: 0 }],
  }
  for (const obstacleId of ["pcb_keepout_fixed", "opaque-object", undefined]) {
    const opaqueInput = {
      ...srj,
      obstacles: [{ ...srj.obstacles[0]!, obstacleId }],
    }
    const validate = createPipeline9PhysicalRouteValidator({ physicalSrj: opaqueInput, connMap, obstacleMargin: 0.8 })
    expect(validate([route])).toBe(true)
    expect(validate([overlap])).toBe(false)
  }
  const pad = {
    ...srj,
    obstacles: [{
      ...srj.obstacles[0]!,
      obstacleId: undefined,
      circuitJsonMetadata: { pcb_smtpad_id: "unconnected-pad", pcb_port_id: "unconnected-port" },
    }],
  }
  expect(createPipeline9PhysicalRouteValidator({ physicalSrj: pad, connMap, obstacleMargin: 0.8 })([route])).toBe(false)
  const hole = {
    ...srj,
    minTraceToHoleEdgeClearance: 0.3,
    obstacles: [{ ...srj.obstacles[0]!, obstacleId: undefined, isNonPlatedHole: true }],
  }
  const wire = {
    ...route,
    route: [{ x: 0, y: -0.5, z: 4 }, { x: 0, y: 0.5, z: 4 }],
    vias: [],
  }
  expect(createPipeline9PhysicalRouteValidator({ physicalSrj: hole, connMap, obstacleMargin: 0.8 })([wire])).toBe(false)
})
