// Vendored benchmark fixture adapter from tscircuit/length-matching-solver.
// Source: https://github.com/tscircuit/length-matching-solver/blob/85c12eb627cb0ab286cc250c15bc40cd3b07e94a/fixtures/createPostProcessingParamsFromSimpleRouteJson.ts
// The upstream file contains no license header; its implementation is unchanged except the type import.
import type {
  DifferentialPair,
  HighDensityRoute,
  Obstacle,
  PostProcessingGridConfig,
  PostProcessingSolverParams,
  SimplifiedPcbTraces,
} from "@tscircuit/length-matching-solver"

export type PostProcessingSimpleRouteJsonFixture = {
  traces: SimplifiedPcbTraces
  differentialPairs: DifferentialPair[]
  obstacles: Obstacle[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  layerCount: number
}

/** Converts legacy SRJ fixtures at the test edge; production uses native HD routes. */
export const createPostProcessingParamsFromSimpleRouteJson = (
  simpleRouteJson: PostProcessingSimpleRouteJsonFixture,
  routingGrid?: PostProcessingGridConfig,
): PostProcessingSolverParams => {
  const getZ = (layer: string): number => {
    if (layer === "top") return 0
    if (layer === "bottom") return simpleRouteJson.layerCount - 1
    const match = /^inner(\d+)$/.exec(layer)
    if (!match) throw new Error(`Unsupported fixture layer: ${layer}`)
    return Number(match[1])
  }
  const hdRoutes = simpleRouteJson.traces.map((trace): HighDensityRoute => {
    const first = trace.route[0]
    if (!first || first.route_type !== "wire")
      throw new Error(
        `Fixture trace ${trace.connection_name} must start with wire`,
      )
    const route: HighDensityRoute["route"] = [
      {
        x: first.x,
        y: first.y,
        z: getZ(first.layer),
        traceThickness: first.width,
      },
    ]
    const vias: HighDensityRoute["vias"] = []
    let currentLayer = first.layer
    let currentWidth = first.width
    let maximumViaDiameter = currentWidth
    for (const entry of trace.route.slice(1)) {
      if (entry.route_type === "wire") {
        route.push({
          x: entry.x,
          y: entry.y,
          z: getZ(entry.layer),
          traceThickness: entry.width,
        })
        currentLayer = entry.layer
        currentWidth = entry.width
        continue
      }
      if (entry.route_type !== "via")
        throw new Error(
          `Fixture trace ${trace.connection_name} contains unsupported active geometry`,
        )
      const nextLayer =
        currentLayer === entry.from_layer
          ? entry.to_layer
          : currentLayer === entry.to_layer
            ? entry.from_layer
            : null
      if (!nextLayer)
        throw new Error(
          `Fixture trace ${trace.connection_name} has invalid via`,
        )
      const current = route.at(-1)!
      if (Math.hypot(current.x - entry.x, current.y - entry.y) > 1e-8)
        route.push({
          x: entry.x,
          y: entry.y,
          z: getZ(currentLayer),
          traceThickness: currentWidth,
        })
      route.push({
        x: entry.x,
        y: entry.y,
        z: getZ(nextLayer),
        traceThickness: currentWidth,
      })
      const fromZ = getZ(entry.from_layer)
      const toZ = getZ(entry.to_layer)
      vias.push({
        x: entry.x,
        y: entry.y,
        zLayers: Array.from(
          { length: Math.abs(toZ - fromZ) + 1 },
          (_, index) => Math.min(fromZ, toZ) + index,
        ),
      })
      maximumViaDiameter = Math.max(
        maximumViaDiameter,
        entry.via_diameter ?? currentWidth,
      )
      currentLayer = nextLayer
    }
    const wireWithStartPort = trace.route.find(
      (entry) => entry.route_type === "wire" && entry.start_pcb_port_id,
    )
    const startPortId =
      first.start_pcb_port_id ??
      (wireWithStartPort?.route_type === "wire"
        ? wireWithStartPort.start_pcb_port_id
        : undefined)
    const lastWire = trace.route.findLast(
      (entry) => entry.route_type === "wire",
    )
    const endPortId =
      lastWire?.route_type === "wire" ? lastWire.end_pcb_port_id : undefined
    return {
      connectionName: trace.connection_name,
      traceThickness: Math.max(
        ...route.map((point) => point.traceThickness ?? first.width),
      ),
      viaDiameter: maximumViaDiameter,
      route,
      vias,
      ...(startPortId ? { startPcbPortId: startPortId } : {}),
      ...(endPortId ? { endPcbPortId: endPortId } : {}),
    }
  })
  return {
    hdRoutes,
    differentialPairs: structuredClone(simpleRouteJson.differentialPairs),
    obstacles: structuredClone(simpleRouteJson.obstacles).map((obstacle) => ({
      ...obstacle,
      // Legacy fixtures used oval component bodies that routing treated as their bounding rect.
      type: "rect",
    })),
    bounds: structuredClone(simpleRouteJson.bounds),
    layerCount: simpleRouteJson.layerCount,
    ...(routingGrid ? { routingGrid: structuredClone(routingGrid) } : {}),
  }
}
