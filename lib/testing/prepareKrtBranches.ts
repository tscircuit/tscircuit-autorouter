import type {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getKrtUnsupportedFeatureReason } from "./getKrtUnsupportedFeatureReason"
import { getKrtBranches } from "./getKrtBranches"

interface KrtRequestConnection extends SimpleRouteConnection {
  sourceTraceId: string
}

export interface KrtBranch {
  name: string
  connection: SimpleRouteConnection
  points: [ConnectionPoint, ConnectionPoint]
}

export interface PreparedKrtBranches {
  srj: Omit<SimpleRouteJson, "connections"> & {
    connections: KrtRequestConnection[]
  }
  branches: KrtBranch[]
}

/** Independent queries make Rust commit each branch before routing the next. */
export const prepareKrtBranches = (
  original: SimpleRouteJson,
): PreparedKrtBranches => {
  const unsupportedReason = getKrtUnsupportedFeatureReason(original)
  if (unsupportedReason) throw new Error(unsupportedReason)

  // The approximator may alter obstacle objects. Never lend it original input.
  const srj = addApproximatingRectsToSrj(structuredClone(original))
  const connectivity = getConnectivityMapFromSimpleRouteJson(original)
  for (const obstacle of srj.obstacles) {
    obstacle.connectedTo = [
      ...new Set(
        obstacle.connectedTo.flatMap((id) => {
          const net = connectivity.getNetConnectedToId(id)
          return net ? [id, net] : [id]
        }),
      ),
    ]
  }
  const branches = getKrtBranches(original)
  const connections: KrtRequestConnection[] = []
  for (const branch of branches) {
    const { name, connection, points } = branch
    const aliases = points.map((point, index): ConnectionPoint => {
      const alias = `${name}_terminal_${index}`
      const layers = getConnectionPointLayers(point)
      for (const obstacle of srj.obstacles) {
        if (
          obstacle.connectedTo.some((id) =>
            connectivity.areIdsConnected(connection.name, id),
          ) &&
          Math.abs(point.x - obstacle.center.x) <=
            obstacle.width / 2 + 1e-9 &&
          Math.abs(point.y - obstacle.center.y) <=
            obstacle.height / 2 + 1e-9 &&
          layers.some((layer) => obstacle.layers.includes(layer))
        ) {
          obstacle.connectedTo.push(alias)
        }
      }
      // Rust does not deserialize layers[]. A point alias preserves pad-layer
      // inference; the accepted output must still obey the original layers.
      return "layer" in point && point.layer
        ? { x: point.x, y: point.y, layer: point.layer, pointId: alias }
        : { x: point.x, y: point.y, layers, pointId: alias }
    })
    connections.push({
      name,
      // This is the Rust serde wire key, rather than SRJ source_trace_id.
      // A shared net identity allows copper sharing at real tree junctions.
      sourceTraceId:
        connectivity.getNetConnectedToId(connection.name) ?? connection.name,
      nominalTraceWidth: Math.max(
        original.minTraceWidth,
        connection.nominalTraceWidth ??
          connection.width ??
          original.nominalTraceWidth ??
          original.minTraceWidth,
      ),
      pointsToConnect: aliases,
    })
  }

  return {
    branches,
    srj: {
      ...srj,
      connections,
      minViaPadDiameter: getViaDimensions(original).padDiameter,
      obstacles: srj.obstacles.map((obstacle) => ({
        ...obstacle,
        type: "rect",
      })),
    },
  }
}
