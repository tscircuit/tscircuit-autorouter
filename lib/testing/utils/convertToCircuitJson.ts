import type { AnyCircuitElement, PcbTrace, PcbVia } from "circuit-json"
import { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { HighDensityRoute } from "lib/types/high-density-types"
import { LayerName, mapZToLayerName } from "lib/utils/mapZToLayerName"
import { pointToBoxDistance } from "@tscircuit/math-utils"

/**
 * Convert a simplified PCB trace from the autorouter to a circuit-json compatible PCB trace
 */
function convertSimplifiedPcbTraceToCircuitJson(
  simplifiedTrace: SimplifiedPcbTrace,
  connectionName: string,
): PcbTrace {
  return {
    type: "pcb_trace",
    pcb_trace_id: simplifiedTrace.pcb_trace_id,
    source_trace_id: connectionName,
    route: simplifiedTrace.route.map((segment) => {
      if (segment.route_type === "wire") {
        return {
          route_type: "wire",
          x: segment.x,
          y: segment.y,
          width: segment.width,
          layer: segment.layer as LayerName,
          start_pcb_port_id: (segment as any).start_pcb_port_id,
          end_pcb_port_id: (segment as any).end_pcb_port_id,
        }
      } else {
        // via
        return {
          route_type: "via",
          x: segment.x,
          y: segment.y,
          from_layer: segment.from_layer,
          to_layer: segment.to_layer,
        }
      }
    }),
  }
}

/**
 * Convert a high density route from the autorouter to a circuit-json compatible PCB trace
 */
function convertHdRouteToCircuitJson(
  hdRoute: HighDensityRoute,
  id: string,
  connectionName: string,
  width = 0.1,
): PcbTrace {
  return {
    type: "pcb_trace",
    pcb_trace_id: id,
    source_trace_id: connectionName,
    route: hdRoute.route.map((point, index) => {
      const isFirstPoint = index === 0
      const isLastPoint = index === hdRoute.route.length - 1

      // For each point in the route, create a wire segment
      return {
        route_type: "wire",
        x: point.x,
        y: point.y,
        width,
        layer: mapZToLayerName(point.z, 2),
        // Add port connection if this is first or last point and has port info
        ...(isFirstPoint && (point as any).pcb_port_id
          ? { start_pcb_port_id: (point as any).pcb_port_id }
          : {}),
        ...(isLastPoint && (point as any).pcb_port_id
          ? { end_pcb_port_id: (point as any).pcb_port_id }
          : {}),
      }
    }),
  }
}

/**
 * Create source_trace elements from the SimpleRouteJson connections
 * These represent the logical connections between points
 */
function createSourceTraces(
  srj: SimpleRouteJson,
  hdRoutes: SimplifiedPcbTrace[] | HighDensityRoute[],
): AnyCircuitElement[] {
  const sourceTraces: AnyCircuitElement[] = []

  // Process each connection to create a source_trace
  srj.connections.forEach((connection) => {
    // Extract port IDs from the connection points
    const connectedPortIds = connection.pointsToConnect
      .filter((point) => point.pcb_port_id)
      .map((point) => point.pcb_port_id!)
      .filter(Boolean)

    // Look for original connection name (might be MST-suffixed by NetToPointPairsSolver)
    const baseName = connection.name.replace(/_mst\d+$/, "")
    const netConnectionName = connection.netConnectionName || baseName

    // Test for obstacles we're inside of
    const obstaclesContainingEndpoints: Obstacle[] = []
    const hdRoute = hdRoutes.find(
      (r) =>
        ((r as any).connection_name ?? (r as any).connectionName) ===
        connection.name,
    )
    if (hdRoute) {
      const endpoints = [
        hdRoute.route[0],
        hdRoute.route[hdRoute.route.length - 1],
      ]

      for (const endpoint of endpoints) {
        for (const obstacle of srj.obstacles) {
          if (pointToBoxDistance(endpoint, obstacle) <= 0) {
            obstaclesContainingEndpoints.push(obstacle)
          }
        }
      }
    }

    // Check if this source_trace already exists
    const existingSourceTrace = sourceTraces.find(
      (st) =>
        st.type === "source_trace" && st.source_trace_id === netConnectionName,
    )

    if (existingSourceTrace) {
      // Add these port IDs to the existing source_trace
      const sourceTrace = existingSourceTrace as any
      sourceTrace.connected_source_port_ids = [
        ...new Set([
          ...sourceTrace.connected_source_port_ids,
          ...connectedPortIds,
        ]),
      ]
    } else {
      // Create a new source_trace for this connection
      sourceTraces.push({
        type: "source_trace",
        source_trace_id: netConnectionName,
        connected_source_port_ids: connectedPortIds.concat(
          obstaclesContainingEndpoints.flatMap((o) => [
            `obstacle_${o.center.x.toFixed(3)}_${o.center.y.toFixed(3)}_${o.layers.join(".")}`,
            ...o.connectedTo,
          ]),
        ),
        connected_source_net_ids: [],
      })
    }
  })

  return sourceTraces
}

/**
 * Create circuit-json pcb_port elements for the connection points
 */
function createPcbPorts(srj: SimpleRouteJson): AnyCircuitElement[] {
  const portMap = new Map<string, any>()

  srj.connections.forEach((connection) => {
    connection.pointsToConnect.forEach((point) => {
      if (point.pcb_port_id) {
        portMap.set(point.pcb_port_id, {
          type: "pcb_port",
          pcb_port_id: point.pcb_port_id,
          source_port_id: point.pcb_port_id, // Assuming same ID for simplicity
          x: point.x,
          y: point.y,
          layers: [point.layer],
        })
      }
    })
  })

  return Array.from(portMap.values())
}

/**
 * Create pcb_smtpad elements from SRJ obstacles that reference pads/ports
 * Only constructs pads when obstacle.connectedTo hints at a real pad/port.
 */
function createPcbSmtPads(srj: SimpleRouteJson): AnyCircuitElement[] {
  const pads: AnyCircuitElement[] = []
  const addedPadIds = new Set<string>()

  for (const obstacle of srj.obstacles as any[]) {
    const connectedTo: string[] = obstacle?.connectedTo || []
    const padId: string | undefined = connectedTo.find((id) =>
      id.startsWith("pcb_smtpad_"),
    )
    const pcbPortId: string | undefined = connectedTo.find((id) =>
      id.startsWith("pcb_port_"),
    )

    // Construct only when we have at least a port or pad hint
    if (!padId && !pcbPortId) continue

    const layer: string | undefined = Array.isArray(obstacle.layers)
      ? obstacle.layers[0]
      : obstacle.layer
    if (!layer) continue

    const id = padId ?? `pcb_smtpad_${pads.length}`
    if (addedPadIds.has(id)) continue
    addedPadIds.add(id)

    // Default to rectangular pads; SRJ obstacles generally provide width/height
    const width = obstacle.width ?? 0
    const height = obstacle.height ?? 0
    const x = obstacle.center?.x ?? obstacle.x
    const y = obstacle.center?.y ?? obstacle.y

    if (typeof x !== "number" || typeof y !== "number") continue

    pads.push({
      type: "pcb_smtpad",
      pcb_smtpad_id: id,
      layer,
      shape: "rect",
      width,
      height,
      x,
      y,
      ...(pcbPortId ? { pcb_port_id: pcbPortId } : {}),
    } as any)
  }

  return pads
}

/**
 * Extract vias from routes and convert them to pcb_via objects
 * @param routes The routes to extract vias from
 * @param minViaDiameter Default diameter for vias
 * @returns An array of PcbVia elements
 */
function extractViasFromRoutes(
  routes: SimplifiedPcbTrace[] | HighDensityRoute[],
  minViaDiameter = 0.6,
): PcbVia[] {
  const vias: PcbVia[] = []
  const viaLocations = new Set<string>() // Track unique via locations

  if (routes.length > 0) {
    if ("type" in routes[0] && routes[0].type === "pcb_trace") {
      // Extract vias from SimplifiedPcbTraces
      ;(routes as SimplifiedPcbTrace[]).forEach((trace) => {
        trace.route.forEach((segment) => {
          if (segment.route_type === "via") {
            const locationKey = `${segment.x},${segment.y},${segment.from_layer},${segment.to_layer}`
            if (!viaLocations.has(locationKey)) {
              vias.push({
                type: "pcb_via",
                pcb_via_id: `via_${vias.length}`,
                pcb_trace_id: trace.pcb_trace_id,
                x: segment.x,
                y: segment.y,
                outer_diameter: minViaDiameter,
                hole_diameter: minViaDiameter * 0.5,
                layers: [segment.from_layer, segment.to_layer] as LayerName[],
              })
              viaLocations.add(locationKey)
            }
          }
        })
      })
    } else {
      // Extract vias from HighDensityRoutes by looking for layer changes
      ;(routes as HighDensityRoute[]).forEach((route, routeIndex) => {
        const traceId = `trace_${routeIndex}`
        for (let i = 1; i < route.route.length; i++) {
          const prevPoint = route.route[i - 1]
          const currPoint = route.route[i]

          // If z-coordinate changes, we have a via
          if (
            prevPoint.z !== currPoint.z &&
            Math.abs(prevPoint.x - currPoint.x) < 0.01 &&
            Math.abs(prevPoint.y - currPoint.y) < 0.01
          ) {
            const fromLayer = mapZToLayerName(prevPoint.z, 2)
            const toLayer = mapZToLayerName(currPoint.z, 2)
            const locationKey = `${currPoint.x},${currPoint.y},${fromLayer},${toLayer}`

            if (!viaLocations.has(locationKey)) {
              vias.push({
                type: "pcb_via",
                pcb_via_id: `via_${vias.length}`,
                pcb_trace_id: traceId,
                x: currPoint.x,
                y: currPoint.y,
                outer_diameter: minViaDiameter,
                hole_diameter: minViaDiameter * 0.5,
                layers: [fromLayer, toLayer] as LayerName[],
              })
              viaLocations.add(locationKey)
            }
          }
        }
      })
    }
  }

  return vias
}

/**
 * Convert the autorouter output to circuit-json format
 * @param srjWithPointPairs The SimpleRouteJson created by the NetToPointPairsSolver
 * @param routes The SimplifiedPcbTraces or HighDensityRoutes to convert
 * @param minTraceWidth Default width for traces if not specified
 * @param minViaDiameter Default diameter for vias if not specified
 */
export function convertToCircuitJson(
  srjWithPointPairs: SimpleRouteJson,
  routes: SimplifiedPcbTrace[] | HighDensityRoute[],
  minTraceWidth = 0.1,
  minViaDiameter = 0.6,
): AnyCircuitElement[] {
  // Start with empty circuit JSON
  const circuitJson: AnyCircuitElement[] = []

  // Add source traces from connection information
  circuitJson.push(...createSourceTraces(srjWithPointPairs, routes))

  // Add PCB ports for connection points
  circuitJson.push(...createPcbPorts(srjWithPointPairs))

  // Add PCB SMT pads
  circuitJson.push(...createPcbSmtPads(srjWithPointPairs))

  // Extract and add vias as independent pcb_via elements
  circuitJson.push(...extractViasFromRoutes(routes, minViaDiameter))

  // Build a map of connection names to simplify lookups
  const connectionMap = new Map<string, string>()
  srjWithPointPairs.connections.forEach((conn) => {
    const baseName = conn.name.replace(/_mst\d+$/, "")
    connectionMap.set(conn.name, conn.netConnectionName || baseName)
  })

  // Process routes based on their type
  if (routes.length > 0) {
    if ("type" in routes[0] && routes[0].type === "pcb_trace") {
      // Handle SimplifiedPcbTraces
      ;(routes as SimplifiedPcbTrace[]).forEach((trace) => {
        const connectionName = trace.connection_name
        circuitJson.push(
          convertSimplifiedPcbTraceToCircuitJson(
            trace,
            connectionMap.get(connectionName) || connectionName,
          ) as AnyCircuitElement,
        )
      })
    } else {
      // Handle HighDensityRoutes
      ;(routes as HighDensityRoute[]).forEach((route, index) => {
        const connectionName = route.connectionName
        circuitJson.push(
          convertHdRouteToCircuitJson(
            route,
            `trace_${index}`,
            connectionMap.get(connectionName) || connectionName,
            minTraceWidth,
          ) as AnyCircuitElement,
        )
      })
    }
  }

  return circuitJson
}
