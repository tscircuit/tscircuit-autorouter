import { buildMinimumSpanningTree } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import { getInitiallyConnectedStateForConnection } from "lib/solvers/NetToPointPairsSolver/get-initially-connected-state-for-connection"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { planDifferentialPairSections } from "./planDifferentialPairSections"

/** Reserve ordered differential sections before choosing the rest of their net's tree. */
export class Pipeline9NetToPointPairsSolver extends NetToPointPairsSolver2_OffBoardConnection {
  private readonly pairPlan: ReturnType<typeof planDifferentialPairSections>

  constructor(input: {
    srjBeforeEscapeVias: SimpleRouteJson
    srjWithEscapeVias: SimpleRouteJson
    colorMap: Record<string, string>
  }) {
    // The path belongs to the input connection. Point-pair output carries
    // only the endpoints of each routing job.
    const srjWithEscapeVias = input.srjWithEscapeVias.connections.some(
      (connection) => connection.path !== undefined,
    )
      ? {
          ...input.srjWithEscapeVias,
          connections: input.srjWithEscapeVias.connections.map(
            ({ path, ...connection }) => connection,
          ),
        }
      : input.srjWithEscapeVias
    super(
      srjWithEscapeVias,
      input.colorMap,
      getInitiallyConnectedMapFromSimpleRouteJson(srjWithEscapeVias),
    )
    this.pairPlan = planDifferentialPairSections(
      input.srjBeforeEscapeVias,
      srjWithEscapeVias.connections,
      this.unprocessedConnections,
    )
  }

  get differentialPairSectionNamesByMember(): ReadonlyMap<string, string[]> {
    return this.pairPlan.sectionNamesByMember
  }

  override _step(): void {
    const connection = this.unprocessedConnections.at(-1)
    if (!connection) return super._step()
    const sections = this.pairPlan.sectionsByMergedConnection.get(
      connection.name,
    )
    if (!sections) return super._step()
    this.unprocessedConnections.pop()

    const { zeroWeightEdges, arePointsConnected } =
      getInitiallyConnectedStateForConnection(
        connection,
        this.initiallyConnectedMap,
      )
    const sectionEdges = new Set(
      sections.map((section) => {
        const [from, to] = section.pointsToConnect
        if (arePointsConnected(from!, to!)) {
          throw new Error(
            `Differential pair section "${section.name}" already has copper and cannot be routed as a new paired section`,
          )
        }
        return { from: from!, to: to!, weight: 0 }
      }),
    )
    this.newConnections.push(...sections)

    // The reserved edges join the pair's pads when choosing links to its taps.
    const edges = buildMinimumSpanningTree(connection.pointsToConnect, {
      extraEdges: [...sectionEdges, ...zeroWeightEdges],
    })
    let mstIndex = 0
    for (const edge of edges) {
      if (sectionEdges.has(edge) || arePointsConnected(edge.from, edge.to))
        continue
      const optimized = this._findBestConnectionPointsFromDisjointSets(
        edge.from,
        edge.to,
      )
      this.newConnections.push({
        ...connection,
        pointsToConnect: optimized.pointsToConnect,
        name: `${connection.name}_mst${mstIndex++}`,
        __rootConnectionNames: connection.__rootConnectionNames ?? [
          connection.name,
        ],
      })
    }
  }
}
