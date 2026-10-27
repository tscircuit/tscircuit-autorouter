import type {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"

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
  if (
    original.traces?.length ||
    original.allowBlindAndBuriedVias ||
    original.allowViaInPad === true ||
    original.jumpers?.length ||
    original.allowJumpers ||
    original.differentialPairs?.length ||
    original.buses?.length ||
    original.minTraceToPadEdgeClearance !== undefined ||
    original.minViaEdgeToPadEdgeClearance !== undefined ||
    original.minPlatedHoleDrillEdgeToDrillEdgeClearance !== undefined ||
    original.minPadEdgeToPadEdgeClearance !== undefined ||
    original.connections.some(
      (connection) =>
        connection.isOffBoard ||
        connection.externallyConnectedPointIds?.length ||
        connection.pointsToConnect.some(
          (point) => "terminalVia" in point && point.terminalVia,
        ),
    )
  ) {
    throw new Error(
      "Direct KRT routing does not support preloaded copper, blind/buried vias, via-in-pad, jumpers, paired/bus constraints, typed pad/plated-hole rules, off-board connectivity or terminal via hints",
    )
  }

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
  const branches: KrtBranch[] = []
  const connections: KrtRequestConnection[] = []

  for (const connection of original.connections) {
    if (connection.pointsToConnect.length < 2) continue
    const attached = new Set([0])
    while (attached.size < connection.pointsToConnect.length) {
      let edge = { from: -1, to: -1, distance: Infinity }
      for (const from of attached) {
        for (let to = 0; to < connection.pointsToConnect.length; to++) {
          if (attached.has(to)) continue
          const a = connection.pointsToConnect[from]
          const b = connection.pointsToConnect[to]
          const distance = Math.hypot(a.x - b.x, a.y - b.y)
          if (distance < edge.distance) edge = { from, to, distance }
        }
      }
      if (edge.to < 0) {
        throw new Error(`No finite terminal edge for ${connection.name}`)
      }
      attached.add(edge.to)
      const name = `krt_branch_${branches.length}`
      const points: [ConnectionPoint, ConnectionPoint] = [
        connection.pointsToConnect[edge.from],
        connection.pointsToConnect[edge.to],
      ]
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
      branches.push({ name, connection, points })
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
