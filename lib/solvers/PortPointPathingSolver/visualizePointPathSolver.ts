import type { GraphicsObject } from "graphics-debug"
import type { PortPointPathingSolver } from "./PortPointPathingSolver"
import { getIntraNodeCrossings } from "../../utils/getIntraNodeCrossings"
import { safeTransparentize } from "../colors"
import type { PortPointCandidate } from "./PortPointPathingSolver"
import type { PortPoint } from "../../types/high-density-types"
import { calculateNodeProbabilityOfFailure } from "../UnravelSolver/calculateCrossingProbabilityOfFailure"
import type { MultiSectionPortPointOptimizer } from "../MultiSectionPortPointOptimizer"

function isPortPointPathingSolver(
  solver: PortPointPathingSolver | MultiSectionPortPointOptimizer,
): solver is PortPointPathingSolver {
  return "computeNodePf" in solver && typeof solver.computeNodePf === "function"
}

export function visualizePointPathSolver(
  solver: PortPointPathingSolver | MultiSectionPortPointOptimizer,
): GraphicsObject {
  const graphics: GraphicsObject = {
    lines: [],
    points: [],
    rects: [],
    circles: [],
  }

  // Draw nodes with pf coloring
  for (const node of solver.inputNodes) {
    let pf = 0
    let memPf = 0
    let crossings = {
      numSameLayerCrossings: 0,
      numEntryExitLayerChanges: 0,
      numTransitionPairCrossings: 0,
    }

    if (isPortPointPathingSolver(solver)) {
      pf = solver.computeNodePf(node)
      memPf = solver.nodeMemoryPfMap.get(node.capacityMeshNodeId) ?? 0
      const nodeWithPortPoints = solver.buildNodeWithPortPointsForCrossing(node)
      crossings = getIntraNodeCrossings(nodeWithPortPoints)
    } else {
      // For MultiSectionPortPointOptimizer, use nodePfMap
      pf = solver.nodePfMap.get(node.capacityMeshNodeId) ?? 0
      const portPoints =
        solver.nodeAssignedPortPoints.get(node.capacityMeshNodeId) ?? []
      const nodeWithPortPoints = {
        capacityMeshNodeId: node.capacityMeshNodeId,
        center: node.center,
        width: node.width,
        height: node.height,
        portPoints,
        availableZ: node.availableZ,
      }
      crossings = getIntraNodeCrossings(nodeWithPortPoints)
    }

    const red = Math.min(255, Math.floor(pf * 512))
    const greenAndBlue = Math.max(0, 255 - Math.floor(pf * 512))
    let color = `rgba(${red}, ${greenAndBlue}, ${greenAndBlue}, 0.3)`

    if (node._containsObstacle) {
      color = "rgba(255, 0, 0, 0.3)"
    }

    if (node._offBoardConnectedCapacityMeshNodeIds?.length) {
      color = "rgba(255, 165, 0, 0.3)"
    }

    graphics.rects!.push({
      center: node.center,
      width: node.width * 0.9,
      height: node.height * 0.9,
      layer: `z${node.availableZ.join(",")}`,
      fill: color,
      label: `${node.capacityMeshNodeId}\npf: ${pf.toFixed(3)}, memPf: ${memPf.toFixed(3)}\nxSame: ${crossings.numSameLayerCrossings}, xLC: ${crossings.numEntryExitLayerChanges}, xTransition: ${crossings.numTransitionPairCrossings}\nobCmid: ${node._offBoardConnectedCapacityMeshNodeIds?.join(",")}\nobs: ${node._containsObstacle ? "yes" : "no"}`,
    })
  }

  // Draw all input port points (only for PortPointPathingSolver which has portPointMap)
  if (isPortPointPathingSolver(solver)) {
    for (const [portPointId, portPoint] of solver.portPointMap) {
      const assignment = solver.assignedPortPoints.get(portPointId)
      const color = assignment
        ? (solver.colorMap[assignment.connectionName] ?? "blue")
        : "rgba(150, 150, 150, 0.5)"

      graphics.circles!.push({
        center: { x: portPoint.x, y: portPoint.y },
        radius: 0.05,
        fill: color,
        layer: `z${portPoint.z}`,
        label: [
          portPointId,
          `conn: ${assignment?.connectionName}`,
          `cd: ${portPoint.distToCentermostPortOnZ}`,
          `connects: ${portPoint.connectionNodeIds.join(",")}`,
          `rootConn: ${assignment?.rootConnectionName}`,
        ]
          .filter(Boolean)
          .join("\n"),
      })
    }
  }

  // Draw solved paths
  const connectionResults = isPortPointPathingSolver(solver)
    ? solver.connectionsWithResults
    : solver.connectionResults
  for (const result of connectionResults) {
    if (!result.path) continue

    const connection = result.connection
    const color = solver.colorMap[connection.name] ?? "blue"

    // Build segment points from path
    const segmentPoints: Array<{ x: number; y: number; z: number }> = []
    for (const candidate of result.path) {
      segmentPoints.push({
        x: candidate.point.x,
        y: candidate.point.y,
        z: candidate.z,
      })
    }

    // Draw segments between consecutive points
    // strokeDash convention:
    // - top layer (z=0): solid (undefined)
    // - bottom layer (z=1): long dash "10 5"
    // - transition between layers: mixed dash "3 3 10"
    for (let i = 0; i < segmentPoints.length - 1; i++) {
      const pointA = segmentPoints[i]
      const pointB = segmentPoints[i + 1]

      const sameLayer = pointA.z === pointB.z
      const commonLayer = pointA.z

      let strokeDash: string | undefined
      if (sameLayer) {
        strokeDash = commonLayer === 0 ? undefined : "10 5"
      } else {
        strokeDash = "3 3 10"
      }

      graphics.lines!.push({
        points: [
          { x: pointA.x, y: pointA.y },
          { x: pointB.x, y: pointB.y },
        ],
        strokeColor: color,
        strokeDash,
      })
    }
  }

  // While actively solving, draw the top 10 most promising candidates
  // This only applies to PortPointPathingSolver which has candidates
  if (
    isPortPointPathingSolver(solver) &&
    !solver.solved &&
    solver.candidates &&
    solver.candidates.length > 0
  ) {
    const currentConnection =
      solver.connectionsWithResults[solver.currentConnectionIndex]
    const connectionColor = currentConnection
      ? (solver.colorMap[currentConnection.connection.name] ?? "blue")
      : "blue"

    // Draw dashed line from start to end goal
    if (currentConnection) {
      const [startNodeId, endNodeId] = currentConnection.nodeIds
      const startNode = solver.nodeMap.get(startNodeId)
      const endNode = solver.nodeMap.get(endNodeId)
      const startPoint = currentConnection.connection.pointsToConnect[0]
      const endPoint =
        currentConnection.connection.pointsToConnect[
          currentConnection.connection.pointsToConnect.length - 1
        ]

      if (startNode && endNode) {
        const start = startPoint
          ? { x: startPoint.x, y: startPoint.y }
          : startNode.center
        const end = endPoint ? { x: endPoint.x, y: endPoint.y } : endNode.center

        graphics.lines!.push({
          points: [start, end],
          strokeColor: safeTransparentize(connectionColor, 0.5),
          strokeDash: "5 5",
        })

        graphics.points!.push({
          x: start.x,
          y: start.y,
          color: connectionColor,
          label: [
            `Start: ${currentConnection.connection.name}`,
            `${currentConnection.connection.rootConnectionName}`,
          ].join("\n"),
        })

        graphics.points!.push({
          x: end.x,
          y: end.y,
          color: connectionColor,
          label: [
            `End: ${currentConnection.connection.name}`,
            `${currentConnection.connection.rootConnectionName}`,
          ].join("\n"),
        })

        // Draw goal marker
        graphics.circles!.push({
          center: end,
          radius: 0.08,
          stroke: connectionColor,
          label: `Goal: ${currentConnection.connection.name}`,
        })
      }
    }

    const sortedCandidates = [...solver.candidates]
      .sort((a, b) => a.f - b.f)
      .slice(0, 30)

    for (const candidate of sortedCandidates) {
      const candidatePath: Array<{
        x: number
        y: number
        z: number
        lastMoveWasOffBoard?: boolean
      }> = []
      let current: PortPointCandidate | null = candidate
      while (current) {
        candidatePath.unshift({
          x: current.point.x,
          y: current.point.y,
          z: current.z,
          lastMoveWasOffBoard: current.lastMoveWasOffBoard,
        })
        current = current.prevCandidate
      }

      // Draw each segment with strokeDash convention based on z
      for (let i = 0; i < candidatePath.length - 1; i++) {
        const pointA = candidatePath[i]
        const pointB = candidatePath[i + 1]

        const sameLayer = pointA.z === pointB.z
        const commonLayer = pointA.z

        let strokeDash: string | undefined
        if (pointB.lastMoveWasOffBoard) {
          strokeDash = "2 2"
        } else if (sameLayer) {
          strokeDash = commonLayer === 0 ? undefined : "10 5"
        } else {
          strokeDash = "3 3 10"
        }

        graphics.lines!.push({
          points: [
            { x: pointA.x + pointA.z * 0.02, y: pointA.y + pointA.z * 0.02 },
            { x: pointB.x + pointB.z * 0.02, y: pointB.y + pointB.z * 0.02 },
          ],
          strokeColor: safeTransparentize(connectionColor, 0.25),
          strokeDash,
        })
      }

      if (candidatePath.length >= 1) {
        const head = candidatePath[candidatePath.length - 1]

        // Compute the candidate's cost breakdown (what would happen if accepted)
        let costPf = 0
        let pf = 0
        let xSame = 0
        let xTransition = 0
        let xLC = 0
        let nodeDeltaCost = 0

        const targetNode = solver.nodeMap.get(
          candidate.prevCandidate?.currentNodeId!,
        )
        if (targetNode && candidate.prevCandidate && candidate.portPoint) {
          const connectionName = currentConnection.connection.name

          // Create hypothetical port points for crossing calculation
          const entryPortPoint: PortPoint = {
            x: candidate.prevCandidate.point.x,
            y: candidate.prevCandidate.point.y,
            z: candidate.prevCandidate.z,
            connectionName,
          }
          const exitPortPoint: PortPoint = {
            x: candidate.portPoint.x,
            y: candidate.portPoint.y,
            z: candidate.portPoint.z,
            connectionName,
          }

          const nodeWithPortPoints = solver.buildNodeWithPortPointsForCrossing(
            targetNode,
            [entryPortPoint, exitPortPoint],
          )
          const crossings = getIntraNodeCrossings(nodeWithPortPoints)

          xSame = crossings.numSameLayerCrossings
          xTransition = crossings.numTransitionPairCrossings
          xLC = crossings.numEntryExitLayerChanges

          const capacityMeshNode = solver.capacityMeshNodeMap.get(
            targetNode.capacityMeshNodeId,
          )
          if (capacityMeshNode) {
            pf = calculateNodeProbabilityOfFailure(
              capacityMeshNode,
              xSame,
              xLC,
              xTransition,
            )
            costPf = pf ** 2 * solver.NODE_PF_FACTOR
          }

          // Compute nodeDeltaCost (the g increment from prev to current)
          nodeDeltaCost =
            candidate.prevCandidate.g > 0
              ? candidate.g - candidate.prevCandidate.g
              : candidate.g
        }

        // Compute heuristic components
        const [_startNodeId, endNodeId] = currentConnection.nodeIds
        const endNode = solver.nodeMap.get(endNodeId)
        const distanceToGoal = endNode
          ? Math.sqrt(
              (head.x - endNode.center.x) ** 2 +
                (head.y - endNode.center.y) ** 2,
            )
          : 0
        const estHops =
          solver.avgNodePitch > 0 ? distanceToGoal / solver.avgNodePitch : 0
        const estStepCost = estHops * solver.BASE_CANDIDATE_COST

        const memPfHere =
          solver.nodeMemoryPfMap.get(candidate.currentNodeId) ?? 0
        const memRiskCost = -Math.log(1 - memPfHere) * solver.MEMORY_PF_FACTOR

        graphics.circles!.push({
          center: head,
          radius: 0.03,
          fill: safeTransparentize(connectionColor, 0.25),
          layer: `z${candidate.z}`,
          label: [
            `f: ${candidate.f.toFixed(2)}`,
            `g: ${candidate.g.toFixed(2)} (nodeDelta: ${nodeDeltaCost.toFixed(2)})`,
            `h: ${candidate.h.toFixed(2)}`,
            `  dist: ${distanceToGoal.toFixed(2)}`,
            `  estHops: ${estHops.toFixed(1)}`,
            `  estStepCost: ${estStepCost.toFixed(2)}`,
            `  memRiskCost: ${memRiskCost.toFixed(2)}`,
            `z: ${candidate.z}`,
            `node: ${candidate.currentNodeId}`,
            `Cost(Pf): ${costPf.toFixed(3)}`,
            `Pf: ${pf.toFixed(3)}`,
            `xSame: ${xSame}, xTrans: ${xTransition}, xLC: ${xLC}`,
            `routeOffBoard=${solver.currentConnectionShouldRouteOffBoard}`,
            `offBoardTouched=${candidate.hasTouchedOffBoardNode ?? false}`,
            `lastMoveWasOffBoard=${candidate.lastMoveWasOffBoard ?? false}`,
          ].join("\n"),
        })
      }
    }
  }

  return graphics
}
