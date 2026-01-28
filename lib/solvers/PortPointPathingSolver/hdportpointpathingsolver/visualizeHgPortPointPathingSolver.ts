import type { Candidate } from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import type {
  HgPort,
  HgRegion,
} from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/buildHyperGraphFromInputNodes"
import type { HgPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/HgPortPointPathingSolver"
import { getStringColor } from "lib/solvers/colors"
import { visualizeHgPortPointPathingSolverGraph } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/visualizeHgPortPointPathingSolverGraph"

export const visualizeHgPortPointPathingSolver = (
  solver: HgPortPointPathingSolver,
): GraphicsObject => {
  const graphics = visualizeHgPortPointPathingSolverGraph({
    solver,
  }) as Required<GraphicsObject>

  if (solver.currentConnection && !solver.solved) {
    const connectionColor = getStringColor(
      solver.currentConnection.connectionId,
      0.8,
    )
    const startRegion = solver.currentConnection.startRegion as HgRegion
    const endRegion = solver.currentConnection.endRegion as HgRegion

    const startCenter = startRegion.d.center
    const endCenter = endRegion.d.center

    graphics.lines.push({
      points: [startCenter, endCenter],
      strokeColor: connectionColor,
      strokeDash: "10 5",
    })

    graphics.points.push({
      x: startCenter.x - 0.1,
      y: startCenter.y + 0.1,
      color: connectionColor,
      label: [solver.currentConnection.connectionId, "start"].join("\n"),
    })

    graphics.points.push({
      x: endCenter.x - 0.1,
      y: endCenter.y + 0.1,
      color: connectionColor,
      label: [solver.currentConnection.connectionId, "end"].join("\n"),
    })
  }

  for (const solvedRoute of solver.solvedRoutes) {
    const connectionColor = getStringColor(
      solvedRoute.connection.connectionId,
      0.8,
    )
    const pathPoints: { x: number; y: number }[] = []

    for (const candidate of solvedRoute.path) {
      const port = candidate.port as HgPort
      pathPoints.push({ x: port.d.x, y: port.d.y })
    }

    const startCenter = solvedRoute.connection.startRegion.d.center
    const endCenter = solvedRoute.connection.endRegion.d.center
    pathPoints.unshift(startCenter)
    pathPoints.push(endCenter)

    if (pathPoints.length > 0) {
      graphics.lines.push({
        points: pathPoints,
        strokeColor: connectionColor,
      })
    }
  }

  const candidates = solver.candidateQueue.peekMany(10)
  for (
    let candidateIndex = 0;
    candidateIndex < candidates.length;
    candidateIndex++
  ) {
    const candidate = candidates[candidateIndex] as Candidate<HgRegion, HgPort>
    const port = candidate.port as HgPort
    const isNext = candidateIndex === 0

    graphics.points.push({
      x: port.d.x,
      y: port.d.y,
      color: isNext ? "green" : "rgba(128, 128, 128, 0.55)",
      label: [
        candidate.port.portId,
        `g: ${candidate.g.toFixed(2)}`,
        `h: ${candidate.h.toFixed(2)}`,
        `f: ${candidate.f.toFixed(2)}`,
      ].join("\n"),
    })
  }

  const nextCandidate = candidates[0] as Candidate<HgRegion, HgPort> | undefined
  if (!solver.solved && nextCandidate && solver.currentConnection) {
    const connectionColor = getStringColor(
      solver.currentConnection.connectionId,
      0.8,
    )
    const activePath: { x: number; y: number }[] = []
    let cursor: Candidate<HgRegion, HgPort> | undefined = nextCandidate

    while (cursor) {
      const port = cursor.port as HgPort
      activePath.unshift({ x: port.d.x, y: port.d.y })
      cursor = cursor.parent
    }

    const startCenter = solver.currentConnection.startRegion.d.center
    activePath.unshift(startCenter)

    if (activePath.length > 1) {
      graphics.lines.push({
        points: activePath,
        strokeColor: connectionColor,
      })
    }
  }

  return graphics
}
