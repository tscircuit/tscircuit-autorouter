import { clamp, type Bounds, type Point } from "@tscircuit/math-utils"
import { MHPoint } from "./types1"

export interface UnbrokenPourEscapePlan {
  minimumViaCountPerConnection: number[]
  reservedViaPositionsByConnectionName: Record<string, Point[]>
}

/**
 * First-pass heuristic for copper-pour escape planning:
 * when a same-layer connection starts and ends on a layer covered by an
 * unbroken pour, reserve a pair of near-pad vias so the trace can briefly
 * leave the layer instead of routing through the pour.
 */
export const planUnbrokenPourEscapes = (params: {
  portPairsEntries: Array<
    [
      connectionName: string,
      {
        start: Omit<MHPoint, "xMoves" | "yMoves">
        end: Omit<MHPoint, "xMoves" | "yMoves">
      },
    ]
  >
  bounds: Bounds
  availableZ: number[]
  blockedLayers?: number[]
  boundaryPadding?: number
  viaDiameter?: number
  traceWidth?: number
}): UnbrokenPourEscapePlan => {
  const {
    portPairsEntries,
    bounds,
    availableZ,
    blockedLayers = [],
    boundaryPadding = 0,
    viaDiameter = 0.3,
    traceWidth = 0.15,
  } = params

  const blockedLayerSet = new Set(blockedLayers)
  const minimumViaCountPerConnection = Array(portPairsEntries.length).fill(0)
  const reservedViaPositionsByConnectionName: Record<string, Point[]> = {}

  if (availableZ.length < 2 || blockedLayerSet.size === 0) {
    return {
      minimumViaCountPerConnection,
      reservedViaPositionsByConnectionName,
    }
  }

  const minDimension = Math.min(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
  )
  const escapeDistance = Math.max(
    minDimension * 0.18,
    viaDiameter + traceWidth * 2,
  )

  for (let i = 0; i < portPairsEntries.length; i++) {
    const [connectionName, portPair] = portPairsEntries[i]
    const layer = portPair.start.z1
    const isSameLayer = portPair.start.z1 === portPair.end.z1
    if (!isSameLayer || !blockedLayerSet.has(layer)) continue

    minimumViaCountPerConnection[i] = 2
    reservedViaPositionsByConnectionName[connectionName] = [
      createNearPadEscapePoint(portPair.start, portPair.end, bounds, {
        boundaryPadding,
        escapeDistance,
      }),
      createNearPadEscapePoint(portPair.end, portPair.start, bounds, {
        boundaryPadding,
        escapeDistance,
      }),
    ]
  }

  return {
    minimumViaCountPerConnection,
    reservedViaPositionsByConnectionName,
  }
}

const createNearPadEscapePoint = (
  port: Point,
  oppositePort: Point,
  bounds: Bounds,
  opts: { boundaryPadding: number; escapeDistance: number },
): Point => {
  let dx = oppositePort.x - port.x
  let dy = oppositePort.y - port.y
  const length = Math.hypot(dx, dy)

  if (length < 1e-9) {
    dx = (bounds.minX + bounds.maxX) / 2 - port.x
    dy = (bounds.minY + bounds.maxY) / 2 - port.y
  } else {
    dx /= length
    dy /= length
  }

  return {
    x: clamp(
      port.x + dx * opts.escapeDistance,
      bounds.minX + opts.boundaryPadding,
      bounds.maxX - opts.boundaryPadding,
    ),
    y: clamp(
      port.y + dy * opts.escapeDistance,
      bounds.minY + opts.boundaryPadding,
      bounds.maxY - opts.boundaryPadding,
    ),
  }
}
