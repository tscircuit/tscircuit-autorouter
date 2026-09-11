import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle, SimpleRouteJson } from "lib/types"

type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type Wall = Bounds & { obstacle: Obstacle }

/**
 * Proves enclosure using four rectangular blockers. The square expansion is
 * INSIDE the trace's rounded clearance envelope, so a closed boundary here is
 * also closed to real copper. Inconclusive geometry is left to the router.
 */
export const getEnclosedTerminalError = (
  srj: SimpleRouteJson,
  connMap: ConnectivityMap,
  viaDiameter: number,
): string | undefined => {
  if (srj.traces?.length || srj.allowJumpers || srj.allowViaInPad) return
  const clearance = srj.minTraceToPadEdgeClearance ?? 0
  const expansion = (srj.minTraceWidth / 2 + clearance) / Math.SQRT2 - 1e-6
  if (!(expansion > 0)) return
  const rectangles: Wall[] = srj.obstacles
    .filter(
      (obstacle) =>
        !obstacle.ccwRotationDegrees &&
        !obstacle.isCopperPour &&
        !obstacle.netIsAssignable &&
        obstacle.width > 0 &&
        obstacle.height > 0,
    )
    .map((obstacle) => ({
      obstacle,
      minX: obstacle.center.x - obstacle.width / 2,
      maxX: obstacle.center.x + obstacle.width / 2,
      minY: obstacle.center.y - obstacle.height / 2,
      maxY: obstacle.center.y + obstacle.height / 2,
    }))

  for (const connection of srj.connections) {
    if (connection.isOffBoard) continue
    const net = connMap.getNetConnectedToId(connection.name)
    if (!net) continue
    const sameNetObstacles = srj.obstacles.filter((obstacle) =>
      obstacle.connectedTo.some(
        (id) => connMap.getNetConnectedToId(id) === net,
      ),
    )
    for (const point of connection.pointsToConnect) {
      const layers = "layers" in point ? point.layers : [point.layer]
      if (layers.length !== 1 || !point.pcb_port_id) continue
      const terminal = rectangles.find(
        (rect) =>
          rect.obstacle.layers.length === 1 &&
          rect.obstacle.layers[0] === layers[0] &&
          rect.obstacle.connectedTo.includes(point.pcb_port_id!) &&
          point.x >= rect.minX &&
          point.x <= rect.maxX &&
          point.y >= rect.minY &&
          point.y <= rect.maxY,
      )
      if (!terminal || terminal.obstacle.offBoardConnectsTo?.length) continue
      const walls: Wall[] = rectangles
        .filter(
          (rect) =>
            rect.obstacle.layers.includes(layers[0]!) &&
            !sameNetObstacles.includes(rect.obstacle),
        )
        .map((rect) => ({
          obstacle: rect.obstacle,
          minX: rect.minX - expansion,
          maxX: rect.maxX + expansion,
          minY: rect.minY - expansion,
          maxY: rect.maxY + expansion,
        }))
      const left = walls
        .filter(
          (wall) =>
            wall.maxX < point.x && wall.minY <= point.y && wall.maxY >= point.y,
        )
        .sort((a, b) => b.maxX - a.maxX)[0]
      const right = walls
        .filter(
          (wall) =>
            wall.minX > point.x && wall.minY <= point.y && wall.maxY >= point.y,
        )
        .sort((a, b) => a.minX - b.minX)[0]
      const bottom = walls
        .filter(
          (wall) =>
            wall.maxY < point.y && wall.minX <= point.x && wall.maxX >= point.x,
        )
        .sort((a, b) => b.maxY - a.maxY)[0]
      const top = walls
        .filter(
          (wall) =>
            wall.minY > point.y && wall.minX <= point.x && wall.maxX >= point.x,
        )
        .sort((a, b) => a.minY - b.minY)[0]
      if (!left || !right || !bottom || !top) continue
      const bounds: Bounds = {
        minX: left.maxX,
        maxX: right.minX,
        minY: bottom.maxY,
        maxY: top.minY,
      }
      if (
        left.minY > bounds.minY ||
        left.maxY < bounds.maxY ||
        right.minY > bounds.minY ||
        right.maxY < bounds.maxY ||
        bottom.minX > bounds.minX ||
        bottom.maxX < bounds.maxX ||
        top.minX > bounds.minX ||
        top.maxX < bounds.maxX ||
        terminal.minX <= bounds.minX ||
        terminal.maxX >= bounds.maxX ||
        terminal.minY <= bounds.minY ||
        terminal.maxY >= bounds.maxY
      ) {
        continue
      }
      // Other connected copper could provide an escape, including a plated
      // hole. Only certify the isolated terminal-pad case.
      if (
        sameNetObstacles.some((obstacle) => {
          if (obstacle === terminal.obstacle) return false
          const radius = Math.hypot(obstacle.width, obstacle.height) / 2
          return (
            obstacle.layers.includes(layers[0]!) &&
            obstacle.center.x + radius >= bounds.minX &&
            obstacle.center.x - radius <= bounds.maxX &&
            obstacle.center.y + radius >= bounds.minY &&
            obstacle.center.y - radius <= bounds.maxY
          )
        })
      ) {
        continue
      }
      if (
        !connection.pointsToConnect.some(
          (other) =>
            other.x < bounds.minX ||
            other.x > bounds.maxX ||
            other.y < bounds.minY ||
            other.y > bounds.maxY,
        )
      ) {
        continue
      }
      // Distance to a rectangle is convex: its maximum over the enclosed
      // rectangle occurs at a corner. If even that is below the via radius,
      // every reachable via overlaps the terminal pad (via-in-pad is disabled).
      const maximumViaDistance = Math.hypot(
        Math.max(terminal.minX - bounds.minX, bounds.maxX - terminal.maxX, 0),
        Math.max(terminal.minY - bounds.minY, bounds.maxY - terminal.maxY, 0),
      )
      if (srj.layerCount > 1 && maximumViaDistance >= viaDiameter / 2 - 1e-6) {
        continue
      }
      return `Unroutable terminal ${point.pcb_port_id} on connection "${connection.name}": foreign pads enclose its ${layers[0]} escape at trace width ${srj.minTraceWidth} mm and clearance ${clearance} mm${srj.layerCount > 1 ? `; every reachable ${viaDiameter} mm via overlaps its pad, but allowViaInPad is false` : ""}. Change the pad geometry or routing rules.`
    }
  }
  return undefined
}
