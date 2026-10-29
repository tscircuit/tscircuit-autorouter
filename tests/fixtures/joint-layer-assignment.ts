import { checkViasOffBoard } from "@tscircuit/checks"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { convertToCircuitJson, createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

export const createJointLayerFixture = (): {
  routes: HighDensityRoute[]; srj: SimpleRouteJson; connMap: ConnectivityMap
} => {
  const routes: HighDensityRoute[] = [
    { connectionName: "horizontal", traceThickness: 0.15, viaDiameter: 0.4,
      route: [{ x: -3, y: 0, z: 1 }, { x: -2, y: 0, z: 1 },
        { x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 },
        { x: 2, y: 0, z: 1 }, { x: 3, y: 0, z: 1 }],
      vias: [{ x: -2, y: 0 }, { x: 2, y: 0 }] },
    { connectionName: "vertical", traceThickness: 0.15, viaDiameter: 0.4,
      route: [{ x: 0, y: -3, z: 0 }, { x: 0, y: -2, z: 0 },
        { x: 0, y: -2, z: 1 }, { x: 0, y: 2, z: 1 },
        { x: 0, y: 2, z: 0 }, { x: 0, y: 3, z: 0 }],
      vias: [{ x: 0, y: -2 }, { x: 0, y: 2 }] },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.15, minViaDiameter: 0.4,
    minViaHoleDiameter: 0.2, minTraceToPadEdgeClearance: 0.1,
    minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    obstacles: [
      { x: 0.3, y: 0.375000001 }, { x: 0.3, y: -0.375000001 },
      { x: 0.375000001, y: 0.3 }, { x: -0.375000001, y: 0.3 },
    ].map((center, index) => ({
      type: "rect", obstacleId: `via_window_${index}`, center,
      width: 0.05, height: 0.05, layers: ["top", "bottom"], connectedTo: ["foreign"],
      circuitJsonMetadata: { source_component_name: "blockers", source_port_name: `pad_${index}` },
    })),
    connections: routes.map((route) => ({ name: route.connectionName,
      pointsToConnect: [route.route[0], route.route.at(-1)!].map((point, index) => ({
        x: point.x, y: point.y, layer: point.z === 0 ? "top" : "bottom",
        pcb_port_id: `${route.connectionName}_${index}`,
      })),
    })),
  }
  for (const route of routes) {
    for (const [index, point] of [route.route[0], route.route.at(-1)!].entries()) {
      point.pcb_port_id = `${route.connectionName}_${index}`
      srj.obstacles.push({ type: "rect", obstacleId: point.pcb_port_id,
        center: { x: point.x, y: point.y }, width: 0.4, height: 0.4,
        layers: [point.z === 0 ? "top" : "bottom"], connectedTo: [route.connectionName, point.pcb_port_id] })
    }
  }
  return { routes, srj, connMap: new ConnectivityMap({ h: ["horizontal"], v: ["vertical"] }) }
}

export const evaluateJointLayerFixture = (
  srj: SimpleRouteJson, routes: HighDensityRoute[],
): { valid: boolean; manufacturedSites: number } => {
  const circuit = convertToCircuitJson(srj, routes, { originalSrj: srj })
  circuit.push(createPcbBoardElement({ ...srj, minBoardEdgeClearance: 0 }))
  const errors = getDrcErrors(circuit, { traceClearance: 0.1, viaClearance: 0.1, viaToPadClearance: 0.1 })
  const sites = new Set(circuit.flatMap((element) => element.type === "pcb_via"
    ? [JSON.stringify([element.x, element.y, element.outer_diameter, element.hole_diameter,
      [...element.layers].sort()])] : []))
  return { valid: errors.errors.length === 0 && checkViasOffBoard(circuit).length === 0,
    manufacturedSites: sites.size }
}

export const createCyclicJointLayerFixture = (): {
  routes: HighDensityRoute[]; srj: SimpleRouteJson; connMap: ConnectivityMap
} => {
  const vectors = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
  const routes: HighDensityRoute[] = vectors.map((v, index) => {
    const name = `net_${index}`, middle = (index + 1) % 3
    return { connectionName: name, traceThickness: 0.15, viaDiameter: 0.4,
      route: [{ x: -3 * v.x, y: -3 * v.y, z: index, pcb_port_id: `${name}_start` },
        { x: -2 * v.x, y: -2 * v.y, z: index },
        { x: -2 * v.x, y: -2 * v.y, z: middle },
        { x: 2 * v.x, y: 2 * v.y, z: middle },
        { x: 2 * v.x, y: 2 * v.y, z: index },
        { x: 3 * v.x, y: 3 * v.y, z: index, pcb_port_id: `${name}_end` }],
      vias: [{ x: -2 * v.x, y: -2 * v.y }, { x: 2 * v.x, y: 2 * v.y }] }
  })
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15, minViaDiameter: 0.4,
    minViaHoleDiameter: 0.2, minTraceToPadEdgeClearance: 0.1, minViaEdgeToPadEdgeClearance: 0.1,
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    connections: routes.map((route) => ({ name: route.connectionName,
      pointsToConnect: [route.route[0], route.route.at(-1)!].map((point) => ({
        x: point.x, y: point.y, layer: mapZToLayerName(point.z, 4), pcb_port_id: point.pcb_port_id })) })),
    obstacles: routes.flatMap((route) => [route.route[0], route.route.at(-1)!].map((point) => ({
      type: "rect", obstacleId: point.pcb_port_id, center: { x: point.x, y: point.y },
      width: 0.4, height: 0.4, layers: [mapZToLayerName(point.z, 4)],
      connectedTo: [route.connectionName, point.pcb_port_id!],
    }))),
  }
  return { routes, srj, connMap: new ConnectivityMap(Object.fromEntries(routes.map((route) =>
    [route.connectionName, [route.connectionName]]))) }
}
