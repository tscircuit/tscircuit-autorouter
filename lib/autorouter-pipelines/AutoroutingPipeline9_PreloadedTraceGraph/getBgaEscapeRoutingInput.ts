import type { BgaEscapeRoutingSolverInput } from "lib/solvers/BgaEscapeRoutingSolver/BgaEscapeRoutingSolver"
import { getBgaSignalLayers } from "lib/solvers/BgaEscapeRoutingSolver/getBgaSignalLayers"
import { cellsPerBallPitch } from "lib/solvers/BgaEscapeRoutingSolver/BgaRoutingGrid"
import { BgaGrid } from "lib/solvers/BgaTopologyGeneratorSolver/bga-grid"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { getBgaLikeObstacleSubset } from "lib/solvers/ComponentDetectionSolver/detectors/bga/BgaComponentDetector"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"

export type BgaEscapeBoard = {
  inputSrj: SimpleRouteJson
  pointPairs: SimpleRouteConnection[]
  components: DetectedComponent[]
}

function hasSurfacePadConnections(srj: SimpleRouteJson): boolean {
  return (
    srj.connections.length > 0 &&
    srj.connections.every(
      (connection) =>
        !connection.isOffBoard &&
        !connection.externallyConnectedPointIds?.length &&
        connection.pointsToConnect.length >= 2 &&
        connection.pointsToConnect.every(
          (point) =>
            point.pcb_port_id &&
            (point.layer === "top" || point.layer === "bottom") &&
            !point.terminalVia,
        ),
    )
  )
}

/** This strategy searches rectangular boards for uncoupled signals with fixed copper. */
function supportsBgaEscapeRouting(srj: SimpleRouteJson): boolean {
  const traces = srj.traces
  if (!traces?.length) return false
  return (
    srj.layerCount >= 3 &&
    !srj.outline?.length &&
    !srj.allowBlindAndBuriedVias &&
    !srj.buses?.length &&
    !srj.differentialPairs?.length &&
    !srj.jumpers?.length &&
    traces.every(
      (trace) =>
        trace.isFixed &&
        trace.route.every(
          (point) => point.route_type === "wire" || point.route_type === "via",
        ),
    ) &&
    srj.obstacles.every(
      (obstacle) =>
        !obstacle.isCopperPour &&
        !obstacle.isNonPlatedHole &&
        !obstacle.isFanoutSourceKeepout,
    ) &&
    hasSurfacePadConnections(srj)
  )
}

export function getBgaEscapeRoutingInput({
  inputSrj,
  pointPairs,
  components,
}: BgaEscapeBoard): BgaEscapeRoutingSolverInput | undefined {
  const clearance = inputSrj.minTraceToPadEdgeClearance
  if (clearance === undefined || !supportsBgaEscapeRouting(inputSrj)) return
  const expectedPairs = inputSrj.connections.reduce(
    (total, connection) => total + connection.pointsToConnect.length - 1,
    0,
  )
  if (
    pointPairs.length !== expectedPairs ||
    pointPairs.some(
      (pair) =>
        pair.pointsToConnect.length !== 2 ||
        pair.pointsToConnect.some((point) => !point.pcb_port_id),
    )
  )
    return

  const signalLayers = getBgaSignalLayers(inputSrj)
  if (!signalLayers.some((z) => z > 0 && z < inputSrj.layerCount - 1)) return
  const bgaIds = new Set(
    components
      .filter((component) => component.componentKind === "bga")
      .map((component) => component.componentId),
  )
  const ballsByComponent = Map.groupBy(
    inputSrj.obstacles.filter(
      (pad) =>
        pad.shape === "circle" &&
        pad.componentId &&
        bgaIds.has(pad.componentId),
    ),
    (pad) => pad.componentId,
  )
  const packages = [...ballsByComponent.values()].sort(
    (a, b) => b.length - a.length,
  )
  for (const pads of packages) {
    // Off-grid fiducials belong to the footprint but do not define its ball lattice.
    const balls = getBgaLikeObstacleSubset(pads)
    if (!balls) continue
    const grid = BgaGrid.fromObstacles(balls)
    if (!grid) continue
    const pitch = Math.round(Math.min(grid.pitchX, grid.pitchY) * 1e6) / 1e6
    const freeWidth =
      pitch - Math.max(grid.padWidth, grid.padHeight) - 2 * clearance
    const narrowChannel = inputSrj.connections.some((connection) => {
      const width =
        connection.nominalTraceWidth ??
        connection.width ??
        inputSrj.minTraceWidth
      return freeWidth >= width && freeWidth - width < pitch / cellsPerBallPitch
    })
    if (narrowChannel) {
      return {
        inputSrj,
        pointPairs,
        signalLayers,
        bga: { center: balls[0]!.center, pitch },
      }
    }
  }
}
