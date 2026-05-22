import type { GraphicsObject, Line } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { getStringColor } from "lib/solvers/colors"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

/**
 * Capacity region and port-point pairs that belong to one route island.
 */
export type RouteIslandRegionWithPortPointPairs = {
  region: NodeWithPortPoints
  portPointPairs: [PortPoint, PortPoint][]
}

/**
 * A route island is a connected capacity regions whose pathing
 * output shares port points.
 */
export type RouteIsland = {
  connectionName: string
  rootConnectionName?: string
  regionsAndPortPointPairs: RouteIslandRegionWithPortPointPairs[]
}

/**
 * Internal island region with root connection metadata preserved while grouping.
 */
type RouteIslandRegion = RouteIslandRegionWithPortPointPairs & {
  rootConnectionName?: string
}

/** Index into the per-connection region array. */
type RegionIndex = number

/**
 * Creates Island of conected regions that share port points for a single connection.
 *
 * @param inputNodeWithPortPoints Capacity regions after port distribution.
 * @returns Route islands via {@link getOutput} after the solver completes.
 */
export class RouteIslandSolver extends BaseSolver {
  private readonly regionsByConnectionName = new Map<
    string,
    RouteIslandRegion[]
  >()
  private readonly initialConnectionCount: number
  private connectionQueue: string[]
  private output: RouteIsland[] = []
  private currentConnectionName: string | null = null
  private branchRegionCount = 0

  /**
   * Creates a route island solver.
   *
   * @param inputNodeWithPortPoints Capacity regions containing `portPointsInPairs`.
   */
  constructor(private inputNodeWithPortPoints: NodeWithPortPoints[]) {
    super()
    this.MAX_ITERATIONS = 1e6
    this.collectConnectionRegions()
    this.connectionQueue = Array.from(this.regionsByConnectionName.keys())
    this.initialConnectionCount = this.connectionQueue.length
    this.updateStats()
  }

  /**
   * Groups each region's port-point pairs by connection name.
   *
   * @returns Nothing; mutates `regionsByConnectionName`.
   */
  private collectConnectionRegions() {
    for (
      let regionOrder = 0;
      regionOrder < this.inputNodeWithPortPoints.length;
      regionOrder++
    ) {
      const region = this.inputNodeWithPortPoints[regionOrder]!

      for (const portPointPair of region.portPointsInPairs ?? []) {
        const connectionName =
          portPointPair[0].connectionName || portPointPair[1].connectionName
        if (!connectionName) continue

        const connectionRegions =
          this.regionsByConnectionName.get(connectionName) ?? []
        let connectionRegion = connectionRegions.find(
          (candidateRegion) =>
            candidateRegion.region.capacityMeshNodeId ===
            region.capacityMeshNodeId,
        )

        if (!connectionRegion) {
          connectionRegion = {
            region,
            portPointPairs: [],
            rootConnectionName:
              portPointPair[0].rootConnectionName ??
              portPointPair[1].rootConnectionName,
          }
          connectionRegions.push(connectionRegion)
          this.regionsByConnectionName.set(connectionName, connectionRegions)
        }

        connectionRegion.portPointPairs.push(portPointPair)
      }
    }
  }

  /**
   * Builds the identity key used to detect region adjacency through shared ports.
   *
   * @param portPoint Port point from a pathing pair.
   * @returns Stable key based on `portPointId` when present, otherwise coordinates.
   *
   * CAUTION: Coordinate fallback intentionally treats coincident points on the same
   * connection/root/layer as shared even when no explicit port id exists.
   */
  private getSharedPortKey(portPoint: PortPoint): string {
    if (portPoint.portPointId) {
      return `id:${portPoint.portPointId}`
    }
    return [
      "coord",
      portPoint.connectionName,
      portPoint.rootConnectionName ?? "",
      portPoint.x,
      portPoint.y,
      portPoint.z,
    ].join(":")
  }

  /**
   * Checks whether a region includes the synthetic tiny-hypergraph start terminal.
   *
   * @param region Candidate region for the island start.
   * @returns True when any pair contains a start terminal port id.
   */
  private regionHasStartTerminal(region: RouteIslandRegion) {
    return region.portPointPairs.some((portPointPair) =>
      portPointPair.some(
        (portPoint) =>
          portPoint.portPointId?.includes("tiny-terminal:start-port:") ?? false,
      ),
    )
  }

  /**
   * Builds a reverse index from shared port key to all regions containing it.
   *
   * @param regions Regions for one connection.
   * @returns Map of shared port keys to region indexes.
   */
  private buildSharedPortToRegionIndexes(regions: RouteIslandRegion[]) {
    const sharedPortToRegionIndexes = new Map<string, Set<RegionIndex>>()

    for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
      const region = regions[regionIndex]!
      for (const portPointPair of region.portPointPairs) {
        for (const portPoint of portPointPair) {
          const sharedPortKey = this.getSharedPortKey(portPoint)
          const regionIndexes =
            sharedPortToRegionIndexes.get(sharedPortKey) ??
            new Set<RegionIndex>()
          regionIndexes.add(regionIndex)
          sharedPortToRegionIndexes.set(sharedPortKey, regionIndexes)
        }
      }
    }

    return sharedPortToRegionIndexes
  }

  /**
   * Converts shared-port membership into an undirected region adjacency graph.
   *
   * @param regions Regions for one connection.
   * @param sharedPortToRegionIndexes Reverse index from port key to region indexes.
   * @returns Neighbor indexes for each region index.
   */
  private buildRegionNeighbors(
    regions: RouteIslandRegion[],
    sharedPortToRegionIndexes: Map<string, Set<RegionIndex>>,
  ) {
    const neighbors = new Map<RegionIndex, Set<RegionIndex>>()

    for (let regionIndex = 0; regionIndex < regions.length; regionIndex++) {
      neighbors.set(regionIndex, new Set())
    }

    for (const sharedRegionIndexes of sharedPortToRegionIndexes.values()) {
      const regionIndexes = Array.from(sharedRegionIndexes)
      for (const regionIndex of regionIndexes) {
        const regionNeighbors = neighbors.get(regionIndex)!
        for (const neighborIndex of regionIndexes) {
          if (neighborIndex !== regionIndex) {
            regionNeighbors.add(neighborIndex)
          }
        }
      }
    }

    return neighbors
  }

  /**
   * Finds connected components in the region adjacency graph.
   *
   * @param regions Regions for one connection.
   * @param neighbors Region adjacency map.
   * @returns Components as sorted region-index arrays, ordered by first index.
   */
  private getConnectedRegionComponents(
    regions: RouteIslandRegion[],
    neighbors: Map<RegionIndex, Set<RegionIndex>>,
  ) {
    const unseenRegionIndexes = new Set(regions.map((_, index) => index))
    const components: RegionIndex[][] = []

    while (unseenRegionIndexes.size > 0) {
      const startIndex = Math.min(...unseenRegionIndexes)
      const queue = [startIndex]
      const component: RegionIndex[] = []
      unseenRegionIndexes.delete(startIndex)

      while (queue.length > 0) {
        const regionIndex = queue.shift()!
        component.push(regionIndex)

        for (const neighborIndex of neighbors.get(regionIndex) ?? []) {
          if (!unseenRegionIndexes.has(neighborIndex)) continue
          unseenRegionIndexes.delete(neighborIndex)
          queue.push(neighborIndex)
        }
      }

      component.sort((a, b) => a - b)
      components.push(component)
    }

    return components.sort((a, b) => a[0]! - b[0]!)
  }

  /**
   * Chooses where to start ordering a connected component.
   *
   * @param component Region indexes in one connected component.
   * @param regions Regions for one connection.
   * @param neighbors Region adjacency map.
   * @returns Start terminal region when available, otherwise a leaf-like region.
   */
  private chooseStartRegionIndex(
    component: RegionIndex[],
    regions: RouteIslandRegion[],
    neighbors: Map<RegionIndex, Set<RegionIndex>>,
  ) {
    const startTerminalRegionIndex = component.find((regionIndex) =>
      this.regionHasStartTerminal(regions[regionIndex]!),
    )
    if (startTerminalRegionIndex !== undefined) {
      return startTerminalRegionIndex
    }

    return (
      component.find(
        (regionIndex) => (neighbors.get(regionIndex)?.size ?? 0) <= 1,
      ) ?? component[0]!
    )
  }

  /**
   * Orders regions in a component for downstream route stitching.
   *
   * @param component Region indexes in one connected component.
   * @param regions Regions for one connection.
   * @param neighbors Region adjacency map.
   * @returns Region indexes in traversal order.
   *
   * NOTE: Branched components are flattened deterministically by choosing the
   * lowest available next index when multiple neighbors remain.
   */
  private orderComponentRegions(
    component: RegionIndex[],
    regions: RouteIslandRegion[],
    neighbors: Map<RegionIndex, Set<RegionIndex>>,
  ) {
    this.branchRegionCount += component.filter(
      (regionIndex) => (neighbors.get(regionIndex)?.size ?? 0) > 2,
    ).length

    const remainingRegionIndexes = new Set(component)
    let currentRegionIndex = this.chooseStartRegionIndex(
      component,
      regions,
      neighbors,
    )
    let previousRegionIndex: RegionIndex | null = null
    const orderedRegionIndexes: RegionIndex[] = []

    while (remainingRegionIndexes.size > 0) {
      orderedRegionIndexes.push(currentRegionIndex)
      remainingRegionIndexes.delete(currentRegionIndex)

      const nextRegionIndex = Array.from(
        neighbors.get(currentRegionIndex) ?? [],
      )
        .filter(
          (neighborIndex) =>
            neighborIndex !== previousRegionIndex &&
            remainingRegionIndexes.has(neighborIndex),
        )
        .sort((a, b) => a - b)[0]

      previousRegionIndex = currentRegionIndex
      if (nextRegionIndex === undefined) {
        if (remainingRegionIndexes.size === 0) break
        currentRegionIndex = Math.min(...remainingRegionIndexes)
      } else {
        currentRegionIndex = nextRegionIndex
      }
    }

    return orderedRegionIndexes
  }

  /**
   * Creates a route island object from a connected region component.
   *
   * @param connectionName Connection name shared by the component.
   * @param component Region indexes in the component.
   * @param regions Regions for one connection.
   * @param neighbors Region adjacency map.
   * @returns Route island with ordered regions and their port-point pairs.
   */
  private buildIslandFromComponent(
    connectionName: string,
    component: RegionIndex[],
    regions: RouteIslandRegion[],
    neighbors: Map<RegionIndex, Set<RegionIndex>>,
  ): RouteIsland {
    const orderedRegionIndexes = this.orderComponentRegions(
      component,
      regions,
      neighbors,
    )
    const firstRegion = regions[orderedRegionIndexes[0]!]!

    return {
      connectionName,
      rootConnectionName: firstRegion.rootConnectionName,
      regionsAndPortPointPairs: orderedRegionIndexes.map((regionIndex) => {
        const routeIslandRegion = regions[regionIndex]!
        return {
          region: routeIslandRegion.region,
          portPointPairs: routeIslandRegion.portPointPairs,
        }
      }),
    }
  }

  /**
   * Builds all route islands for a single connection.
   *
   * @param connectionName Connection name being processed.
   * @param regions Regions that contain port-point pairs for the connection.
   * @returns Route islands for every connected component.
   */
  private buildIslandsForConnection(
    connectionName: string,
    regions: RouteIslandRegion[],
  ) {
    const sharedPortToRegionIndexes =
      this.buildSharedPortToRegionIndexes(regions)
    const neighbors = this.buildRegionNeighbors(
      regions,
      sharedPortToRegionIndexes,
    )
    const components = this.getConnectedRegionComponents(regions, neighbors)

    return components.map((component) =>
      this.buildIslandFromComponent(
        connectionName,
        component,
        regions,
        neighbors,
      ),
    )
  }

  /**
   * Refreshes BaseSolver stats for visualization and debugging.
   *
   * @returns Nothing; mutates `stats`.
   */
  private updateStats() {
    this.stats = {
      connectionCount: this.initialConnectionCount,
      processedConnectionCount:
        this.initialConnectionCount - this.connectionQueue.length,
      pendingConnectionCount: this.connectionQueue.length,
      islandCount: this.output.length,
      regionCount: Array.from(this.regionsByConnectionName.values()).reduce(
        (sum, regions) => sum + regions.length,
        0,
      ),
      portPointPairCount: Array.from(
        this.regionsByConnectionName.values(),
      ).reduce(
        (sum, regions) =>
          sum +
          regions.reduce(
            (regionSum, region) => regionSum + region.portPointPairs.length,
            0,
          ),
        0,
      ),
      branchRegionCount: this.branchRegionCount,
      currentConnectionName: this.currentConnectionName,
    }
  }

  /**
   * Processes the next queued connection into one or more route islands.
   *
   * @returns Nothing; updates solver progress and marks solved at completion.
   */
  _step(): void {
    if (this.connectionQueue.length === 0) {
      this.currentConnectionName = null
      this.solved = true
      this.updateStats()
      return
    }

    const connectionName = this.connectionQueue.shift()!
    this.currentConnectionName = connectionName
    const regions = this.regionsByConnectionName.get(connectionName) ?? []
    this.output.push(...this.buildIslandsForConnection(connectionName, regions))
    this.progress =
      this.initialConnectionCount === 0
        ? 1
        : 1 - this.connectionQueue.length / this.initialConnectionCount

    if (this.connectionQueue.length === 0) {
      this.currentConnectionName = null
      this.solved = true
    }
    this.updateStats()
  }

  /**
   * Gets the route islands produced so far.
   *
   * @returns Route islands, complete after the solver is solved.
   */
  getOutput(): RouteIsland[] {
    return this.output
  }

  /**
   * Returns constructor parameters for solver replay/debug tooling.
   *
   * @returns Tuple containing the original input node list.
   */
  getConstructorParams() {
    return [this.inputNodeWithPortPoints] as const
  }

  /**
   * Builds a debug visualization of generated route islands.
   *
   * @returns Graphics object with island segment lines and start/end markers.
   */
  visualize(): GraphicsObject {
    const lines: Line[] = []
    const points: NonNullable<GraphicsObject["points"]> = []

    this.output.forEach((island, islandIndex) => {
      const color = getStringColor(
        `${island.connectionName}:${islandIndex}`,
        this.currentConnectionName === island.connectionName ? 1 : 0.75,
      )
      island.regionsAndPortPointPairs.forEach(
        ({ region, portPointPairs }, regionIndex) => {
          for (
            let pairIndex = 0;
            pairIndex < portPointPairs.length;
            pairIndex++
          ) {
            const portPointPair = portPointPairs[pairIndex]!
            lines.push({
              points: [
                { x: portPointPair[0].x, y: portPointPair[0].y },
                { x: portPointPair[1].x, y: portPointPair[1].y },
              ],
              strokeColor: color,
              strokeWidth: 0.035,
              label: [
                `route_island ${islandIndex}`,
                `connection: ${island.connectionName}`,
                `region: ${region.capacityMeshNodeId}`,
                `region_index: ${regionIndex}`,
                `pair: ${pairIndex}`,
              ].join("\n"),
            })
          }
        },
      )

      const firstPair = island.regionsAndPortPointPairs[0]?.portPointPairs[0]
      const lastPair =
        island.regionsAndPortPointPairs[
          island.regionsAndPortPointPairs.length - 1
        ]?.portPointPairs.at(-1)
      if (firstPair) {
        points.push({
          x: firstPair[0].x,
          y: firstPair[0].y,
          color,
          label: `route_island ${islandIndex}\nstart\n${island.connectionName}`,
        })
      }
      if (lastPair) {
        points.push({
          x: lastPair[1].x,
          y: lastPair[1].y,
          color,
          label: `route_island ${islandIndex}\nend\n${island.connectionName}`,
        })
      }
    })

    return {
      title: "Route Island Solver",
      lines,
      points,
    }
  }
}
