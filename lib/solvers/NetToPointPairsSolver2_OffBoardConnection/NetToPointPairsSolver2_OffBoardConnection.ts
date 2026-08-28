import {
  SimpleRouteConnection,
  SimpleRouteJson,
  ConnectionPoint,
} from "lib/types"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { DSU } from "lib/utils/dsu"
import { NetToPointPairsSolver } from "../NetToPointPairsSolver/NetToPointPairsSolver"
import { getDifferentialPairAwareMst } from "../NetToPointPairsSolver/get-differential-pair-aware-mst"
import { getInitiallyConnectedStateForConnection } from "../NetToPointPairsSolver/get-initially-connected-state-for-connection"

/**
 * Extends the base NetToPointPairsSolver with an optimization that utilizes
 * off-board connections to find shorter routing paths.
 *
 * This solver preprocesses all connections to identify points that are
 * electrically connected off-board (via the `isOffBoard` flag). It builds
 * "equivalence groups" of these points using a Disjoint Set Union (DSU)
 * data structure.
 *
 * When the solver processes an on-board connection or a segment from a
 * Minimum Spanning Tree (MST), it checks if either of the connection's
 * endpoints has an off-board equivalent. If so, it calculates the distance
 * to all possible substitutes and chooses the pair that results in the
 * shortest path, potentially rerouting the connection to a more optimal
 * equivalent point.
 */
export class NetToPointPairsSolver2_OffBoardConnection extends NetToPointPairsSolver {
  override getSolverName(): string {
    return "NetToPointPairsSolver2_OffBoardConnection"
  }

  connectionPointDsu: DSU
  connectionPointMap: Map<string, ConnectionPoint>

  constructor(
    public ogSrj: SimpleRouteJson,
    public colorMap: Record<string, string> = {},
    initiallyConnectedMap: ConnectivityMap,
  ) {
    const allConnectionPoints = ogSrj.connections.flatMap(
      (connection) => connection.pointsToConnect,
    )
    const connectionPointMap = new Map<string, ConnectionPoint>()
    for (const connectionPoint of allConnectionPoints) {
      if (connectionPoint.pointId) {
        connectionPointMap.set(connectionPoint.pointId, connectionPoint)
      }
    }

    const allConnectionPointIds = allConnectionPoints
      .map((connectionPoint) => connectionPoint.pointId)
      .filter((id): id is string => !!id)
    const connectionPointDsu = new DSU(allConnectionPointIds)

    const onBoardConnections: SimpleRouteConnection[] = []
    for (const currentConnection of ogSrj.connections) {
      if (currentConnection.isOffBoard) {
        if (
          currentConnection.pointsToConnect.length >= 2 &&
          currentConnection.pointsToConnect[0].pointId &&
          currentConnection.pointsToConnect[1].pointId
        ) {
          connectionPointDsu.union(
            currentConnection.pointsToConnect[0].pointId,
            currentConnection.pointsToConnect[1].pointId,
          )
        }
      } else {
        onBoardConnections.push(currentConnection)
      }
    }

    // Call super with a modified SRJ that only contains on-board connections
    super(
      { ...ogSrj, connections: onBoardConnections },
      colorMap,
      initiallyConnectedMap,
    )

    this.connectionPointDsu = connectionPointDsu
    this.connectionPointMap = connectionPointMap
    this.ogSrj = ogSrj // Ensure the original SRJ is stored for the final output
  }

  _findBestConnectionPointsFromDisjointSets(
    sourcePoint: ConnectionPoint,
    targetPoint: ConnectionPoint,
  ): {
    pointsToConnect: [ConnectionPoint, ConnectionPoint]
  } {
    if (!sourcePoint.pointId || !targetPoint.pointId)
      return { pointsToConnect: [sourcePoint, targetPoint] }

    const sourcePointEquivalenceGroup = this.connectionPointDsu
      .getGroup(sourcePoint.pointId)
      .map((id) => this.connectionPointMap.get(id)!)
    const targetPointEquivalenceGroup = this.connectionPointDsu
      .getGroup(targetPoint.pointId)
      .map((id) => this.connectionPointMap.get(id)!)

    let bestSourcePoint = sourcePoint
    let bestTargetPoint = targetPoint
    let minimumDistance = Infinity

    for (const currentSourceCandidate of sourcePointEquivalenceGroup) {
      for (const currentTargetCandidate of targetPointEquivalenceGroup) {
        const distance = Math.sqrt(
          Math.pow(currentSourceCandidate.x - currentTargetCandidate.x, 2) +
            Math.pow(currentSourceCandidate.y - currentTargetCandidate.y, 2),
        )
        if (distance < minimumDistance) {
          minimumDistance = distance
          bestSourcePoint = currentSourceCandidate
          bestTargetPoint = currentTargetCandidate
        }
      }
    }
    return { pointsToConnect: [bestSourcePoint, bestTargetPoint] }
  }

  _step() {
    if (this.unprocessedConnections.length === 0) {
      this.solved = true
      return
    }
    const currentConnection = this.unprocessedConnections.pop()!

    // This logic is copied from the parent class
    const { zeroWeightEdges, arePointsConnected } =
      getInitiallyConnectedStateForConnection(
        currentConnection,
        this.initiallyConnectedMap,
      )

    if (currentConnection.pointsToConnect.length === 2) {
      const [startPoint, endPoint] = currentConnection.pointsToConnect
      if (startPoint && endPoint && arePointsConnected(startPoint, endPoint)) {
        return
      }
      const optimizedConnection =
        this._findBestConnectionPointsFromDisjointSets(
          currentConnection.pointsToConnect[0],
          currentConnection.pointsToConnect[1],
        )
      this.newConnections.push({
        ...currentConnection,
        pointsToConnect: optimizedConnection.pointsToConnect,
        __rootConnectionNames: currentConnection.__rootConnectionNames ?? [
          currentConnection.name,
        ],
      })
      return
    }

    const {
      edges: minimumSpanningTreeEdges,
      remainingRootConnectionNames,
    } = getDifferentialPairAwareMst(currentConnection, {
      originalConnections: this.connectionsBeforeMerging,
      differentialPairs: this.ogSrj.differentialPairs ?? [],
      extraEdges: zeroWeightEdges,
    })

    let mstEdgeIndex = 0
    for (const mstEdge of minimumSpanningTreeEdges) {
      if (arePointsConnected(mstEdge.from, mstEdge.to)) {
        continue
      }

      const requiredConnection = mstEdge.requiredConnection
      if (requiredConnection) {
        this.newConnections.push({
          ...requiredConnection,
          __rootConnectionNames: requiredConnection.__rootConnectionNames ?? [
            requiredConnection.name,
          ],
        })
        continue
      }

      const optimizedMstEdge = this._findBestConnectionPointsFromDisjointSets(
        mstEdge.from,
        mstEdge.to,
      )

      this.newConnections.push({
        ...currentConnection,
        pointsToConnect: optimizedMstEdge.pointsToConnect,
        name: `${currentConnection.name}_mst${mstEdgeIndex++}`,
        __rootConnectionNames: remainingRootConnectionNames,
        __netConnectionName: currentConnection.__netConnectionName,
      })
    }
  }
}
