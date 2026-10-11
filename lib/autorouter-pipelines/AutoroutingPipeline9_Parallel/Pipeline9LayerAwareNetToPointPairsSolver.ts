import { NetToPointPairsSolver } from "../../solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { buildMinimumSpanningTree } from "../../solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import { getInitiallyConnectedStateForConnection } from "../../solvers/NetToPointPairsSolver/get-initially-connected-state-for-connection"
import { buildLayerAwareMinimumSpanningTree, hasCoLocatedLayerTerminals } from "./buildLayerAwareMinimumSpanningTree"

/** Alternative routing policies retain co-located terminals on opposite layers. */
export class Pipeline9LayerAwareNetToPointPairsSolver extends NetToPointPairsSolver {
  override _step(): void {
    if (this.unprocessedConnections.length === 0) {
      this.solved = true
      return
    }
    const connection = this.unprocessedConnections.pop()!
    const { zeroWeightEdges, arePointsConnected } = getInitiallyConnectedStateForConnection(
      connection, this.initiallyConnectedMap,
    )
    if (connection.pointsToConnect.length === 2) {
      const [first, second] = connection.pointsToConnect
      if (first && second && arePointsConnected(first, second)) return
      this.newConnections.push({ ...connection,
        __rootConnectionNames: connection.__rootConnectionNames ?? [connection.name],
      })
      return
    }
    const edges = hasCoLocatedLayerTerminals(connection.pointsToConnect)
      ? buildLayerAwareMinimumSpanningTree(connection.pointsToConnect, zeroWeightEdges)
      : buildMinimumSpanningTree(connection.pointsToConnect, { extraEdges: zeroWeightEdges })
    let treeIndex = 0
    for (const edge of edges) {
      if (arePointsConnected(edge.from, edge.to)) continue
      this.newConnections.push({ ...connection, pointsToConnect: [edge.from, edge.to],
        name: `${connection.name}_mst${treeIndex++}`,
        __rootConnectionNames: connection.__rootConnectionNames ?? [connection.name],
        __netConnectionName: connection.__netConnectionName,
      })
    }
  }
}
