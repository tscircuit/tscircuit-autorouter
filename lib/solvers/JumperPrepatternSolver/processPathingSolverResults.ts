import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HyperPortPointPathingSolver } from "../PortPointPathingSolver/HyperPortPointPathingSolver"
import type { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import type { PrepatternJumper } from "./patterns/alternatingGrid"
import type { SimpleRouteJson } from "../../types"
import { updateConnMapWithOffboardObstacleConnections } from "../../autorouter-pipelines/AssignableAutoroutingPipeline2/updateConnMapWithOffboardObstacleConnections"

export interface ProcessPathingSolverResultsParams {
  pathingSolver: HyperPortPointPathingSolver
  connMap: ConnectivityMap
  prepatternJumpers: PrepatternJumper[]
  srjWithPointPairs: SimpleRouteJson
}

export interface ProcessPathingSolverResultsOutput {
  offBoardConnMap: ConnectivityMap | null
  usedJumperOffBoardObstacleIds: Set<string>
  allUsedJumperOffBoardIds: Set<string>
}

/**
 * Helper to check if two line segments intersect
 */
function segmentsIntersect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  const ccw = (
    A: { x: number; y: number },
    B: { x: number; y: number },
    C: { x: number; y: number },
  ) => {
    return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x)
  }
  return (
    ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)
  )
}

/**
 * Helper to check if a route intersects the jumper line
 */
function routeIntersectsJumper(
  route: Array<{ x: number; y: number }>,
  jumperStart: { x: number; y: number },
  jumperEnd: { x: number; y: number },
): boolean {
  for (let i = 0; i < route.length - 1; i++) {
    if (segmentsIntersect(route[i], route[i + 1], jumperStart, jumperEnd)) {
      return true
    }
  }
  return false
}

/**
 * Process the results from the port point pathing solver.
 *
 * This function:
 * 1. Updates the connectivity map with off-board obstacle connections
 * 2. Builds off-board connectivity map for checking used jumpers
 * 3. Tracks which jumpers are used by connections
 * 4. Determines which jumpers are NECESSARY (used AND another connection crosses them)
 * 5. Updates artificial port points for necessary jumpers to use pad centers
 */
export function processPathingSolverResults(
  params: ProcessPathingSolverResultsParams,
): ProcessPathingSolverResultsOutput {
  const { pathingSolver, connMap, prepatternJumpers, srjWithPointPairs } =
    params

  // Update connectivity map with off-board obstacle connections
  updateConnMapWithOffboardObstacleConnections({
    connMap,
    connectionsWithResults: pathingSolver.connectionsWithResults,
    inputNodes: pathingSolver.inputNodes,
    obstacles: srjWithPointPairs.obstacles,
  })

  // Build off-board connectivity map for checking used jumpers
  let offBoardConnMap: ConnectivityMap | null = null
  const offBoardObstacles = srjWithPointPairs.obstacles.filter(
    (o) => o.offBoardConnectsTo?.length,
  )
  if (offBoardObstacles.length > 0) {
    offBoardConnMap = new ConnectivityMap({})
    offBoardConnMap.addConnections(
      offBoardObstacles.map((o, i) => [
        o.obstacleId ?? `__obs${i}`,
        ...(o.offBoardConnectsTo ?? []),
      ]),
    )
  }

  // Track which jumpers are NECESSARY (not just used)
  // A jumper is necessary when:
  // 1. One connection uses the jumper (goes through both pads via off-board)
  // 2. AND another connection passes through the "area underneath" the jumper
  //
  // The "area underneath" is a separate capacity mesh node that overlaps spatially
  // with the jumper body but doesn't have _offBoardConnectionId set.

  // IMPORTANT: Use pathingSolver.inputNodes, not solver.inputNodes
  // pathingSolver.inputNodes has _offBoardConnectionId populated
  const nodeMap = new Map(
    pathingSolver.inputNodes.map((node) => [node.capacityMeshNodeId, node]),
  )

  // Build a map from connectivity net ID -> jumper geometry
  // The jumper.offBoardConnectionId is like "jumper_conn_0"
  // But node._offBoardConnectionId is the connectivity net ID like "connectivity_net0"
  // We need to map from the net ID to the jumper geometry
  const jumperGeometry = new Map<
    string,
    { start: { x: number; y: number }; end: { x: number; y: number } }
  >()
  for (const jumper of prepatternJumpers) {
    // Get the connectivity net ID for this jumper
    const netId = offBoardConnMap?.getNetConnectedToId(
      jumper.offBoardConnectionId,
    )
    if (netId) {
      jumperGeometry.set(netId, {
        start: jumper.start,
        end: jumper.end,
      })
    }
  }

  // Track: offBoardConnectionId -> Set of connection names that USE the jumper (go through both pads)
  const jumperUsedByConnections = new Map<string, Set<string>>()
  // Track: connectionName -> array of route points {x, y}
  const connectionRoutes = new Map<string, Array<{ x: number; y: number }>>()

  for (const connectionResult of pathingSolver.connectionsWithResults) {
    if (!connectionResult.path) continue
    const connectionName = connectionResult.connection.name

    // Store the route points for this connection
    const routePoints: Array<{ x: number; y: number }> = []
    for (const candidate of connectionResult.path) {
      routePoints.push({ x: candidate.point.x, y: candidate.point.y })

      // Track when a path goes through a jumper node (via off-board connection)
      if (candidate.lastMoveWasOffBoard && candidate.throughNodeId) {
        const throughNode = nodeMap.get(candidate.throughNodeId)
        if (throughNode?._offBoardConnectionId) {
          if (!jumperUsedByConnections.has(throughNode._offBoardConnectionId)) {
            jumperUsedByConnections.set(
              throughNode._offBoardConnectionId,
              new Set(),
            )
          }
          jumperUsedByConnections
            .get(throughNode._offBoardConnectionId)!
            .add(connectionName)
        }
      }

      // ALSO track when a path passes through a jumper node WITHOUT using off-board
      // This can happen when a route uses a jumper pad as a regular waypoint
      // If we don't track this, the jumper will be removed and the route becomes disjoint
      const currentNode = nodeMap.get(candidate.currentNodeId)
      if (currentNode?._offBoardConnectionId) {
        if (!jumperUsedByConnections.has(currentNode._offBoardConnectionId)) {
          jumperUsedByConnections.set(
            currentNode._offBoardConnectionId,
            new Set(),
          )
        }
        jumperUsedByConnections
          .get(currentNode._offBoardConnectionId)!
          .add(connectionName)
      }
    }
    connectionRoutes.set(connectionName, routePoints)
  }

  // A jumper is NECESSARY if:
  // 1. It's used by at least one connection (goes through both pads via off-board)
  // 2. AND another (different) connection's route actually INTERSECTS the jumper line
  //
  // We track two sets:
  // - usedJumperOffBoardObstacleIds: jumpers that are NECESSARY (will be visualized AND kept)
  // - All jumpers in jumperUsedByConnections are USED but may not be necessary
  //
  // For the RemoveUnnecessaryJumpersSolver:
  // - We only remove jumpers that are NOT USED at all
  // - Jumpers that are USED but NOT NECESSARY keep their off-board connections
  //   (routes still go through them) but are not visualized
  // - Jumpers that are NECESSARY are kept AND visualized
  const usedJumperOffBoardObstacleIds = new Set<string>()

  for (const [offBoardId, usingConnections] of jumperUsedByConnections) {
    const geometry = jumperGeometry.get(offBoardId)
    if (!geometry) continue

    // Check if any OTHER connection's route intersects the jumper line
    for (const [connName, route] of connectionRoutes) {
      // Skip connections that use this jumper
      if (usingConnections.has(connName)) continue

      // Check if this connection's route intersects the jumper line
      if (routeIntersectsJumper(route, geometry.start, geometry.end)) {
        // Different connection crosses the jumper - jumper is necessary
        usedJumperOffBoardObstacleIds.add(offBoardId)
        break
      }
    }
  }

  // Build a set of ALL used jumper IDs (regardless of necessity)
  // These should NOT be removed by RemoveUnnecessaryJumpersSolver
  const allUsedJumperOffBoardIds = new Set<string>()
  for (const [offBoardId] of jumperUsedByConnections) {
    // Mark all used jumpers so they won't be removed
    // (only truly unused jumpers should be removed)
    allUsedJumperOffBoardIds.add(offBoardId)
  }

  // Handle artificial port points for jumpers based on whether they're NECESSARY or not:
  //
  // 1. NECESSARY jumpers (another trace crosses them):
  //    - Port points should be at each pad's own center
  //    - No trace is drawn BETWEEN the two pad centers (the physical jumper bridges them)
  //
  // 2. USED but NOT NECESSARY jumpers (trace goes through but nothing crosses):
  //    - Port points should be at a SHARED MIDPOINT between the two pads
  //    - This allows the stitch solver to connect them as one continuous trace
  //
  // We identify artificial port points as those without a portPointId.

  // First, build a map from offBoardConnectionId -> pair of nodes (the two pads)
  const offBoardIdToNodes = new Map<string, InputNodeWithPortPoints[]>()
  for (const inputNode of pathingSolver.inputNodes) {
    if (!inputNode._offBoardConnectionId) continue
    const existing = offBoardIdToNodes.get(inputNode._offBoardConnectionId)
    if (existing) {
      existing.push(inputNode)
    } else {
      offBoardIdToNodes.set(inputNode._offBoardConnectionId, [inputNode])
    }
  }

  for (const inputNode of pathingSolver.inputNodes) {
    if (!inputNode._offBoardConnectionId) continue

    const isUsed = allUsedJumperOffBoardIds.has(inputNode._offBoardConnectionId)
    const isNecessary = usedJumperOffBoardObstacleIds.has(
      inputNode._offBoardConnectionId,
    )

    // Get the port points for this node
    const nodePortPoints = pathingSolver.nodeAssignedPortPoints.get(
      inputNode.capacityMeshNodeId,
    )
    if (!nodePortPoints) continue

    if (isNecessary) {
      // NECESSARY jumper: use each pad's own center
      for (const pp of nodePortPoints) {
        if ((pp as any).portPointId === undefined) {
          pp.x = inputNode.center.x
          pp.y = inputNode.center.y
        }
      }
    } else if (isUsed) {
      // USED but NOT NECESSARY: use shared midpoint between the two pads
      const pairNodes = offBoardIdToNodes.get(inputNode._offBoardConnectionId)
      if (pairNodes && pairNodes.length === 2) {
        const [node1, node2] = pairNodes
        const midpoint = {
          x: (node1.center.x + node2.center.x) / 2,
          y: (node1.center.y + node2.center.y) / 2,
        }
        for (const pp of nodePortPoints) {
          if ((pp as any).portPointId === undefined) {
            pp.x = midpoint.x
            pp.y = midpoint.y
          }
        }
      }
    }
  }

  return {
    offBoardConnMap,
    usedJumperOffBoardObstacleIds,
    allUsedJumperOffBoardIds,
  }
}
