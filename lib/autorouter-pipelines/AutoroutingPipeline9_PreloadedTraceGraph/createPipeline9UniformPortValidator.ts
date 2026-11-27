import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import Flatbush from "flatbush"
import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import type { Obstacle, SimplifiedPcbTrace } from "lib/types"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { PreloadedCopperInput } from "./createPreloadedCopperLookup"
import { createPreloadedPortValidator } from "./createPreloadedPortValidator"

type PortValidator = (
  point: PortPoint,
  options?: { includeClearance?: boolean },
) => boolean

export type Pipeline9UniformPortValidatorInput = PreloadedCopperInput & {
  nodesWithPortPoints?: readonly NodeWithPortPoints[]
  obstacleMargin?: number
}

type IndexedBoardObstacle = {
  obstacle: Obstacle
  zLayers: ReadonlySet<number>
}

const OBSTACLE_CLEARANCE_EPSILON = 1e-6

function getPointToBoardObstacleDistance(
  point: Pick<PortPoint, "x" | "y">,
  obstacle: Obstacle,
): number {
  if (obstacle.shape === "circle") {
    return Math.max(
      0,
      Math.hypot(point.x - obstacle.center.x, point.y - obstacle.center.y) -
        obstacle.width / 2,
    )
  }
  const rotationRadians = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const offsetX = point.x - obstacle.center.x
  const offsetY = point.y - obstacle.center.y
  const localX =
    offsetX * Math.cos(rotationRadians) - offsetY * Math.sin(rotationRadians)
  const localY =
    offsetX * Math.sin(rotationRadians) + offsetY * Math.cos(rotationRadians)
  const outsideX = Math.max(Math.abs(localX) - obstacle.width / 2, 0)
  const outsideY = Math.max(Math.abs(localY) - obstacle.height / 2, 0)
  return Math.hypot(outsideX, outsideY)
}

function createBoardObstacleIndex(
  input: Pick<PreloadedCopperInput, "srj">,
): FlatbushIndex<IndexedBoardObstacle> | undefined {
  const nonPourObstacles = input.srj.obstacles.filter(
    (obstacle) => !obstacle.isCopperPour,
  )
  if (nonPourObstacles.length === 0) return undefined

  const index = new FlatbushIndex<IndexedBoardObstacle>(nonPourObstacles.length)
  for (const obstacle of nonPourObstacles) {
    const zLayers = new Set(
      obstacle.zLayers ??
        obstacle.layers.map((layer) =>
          mapLayerNameToZ(layer, input.srj.layerCount),
        ),
    )
    const rotationRadians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const cos = Math.abs(Math.cos(rotationRadians))
    const sin = Math.abs(Math.sin(rotationRadians))
    const halfWidth = (obstacle.width / 2) * cos + (obstacle.height / 2) * sin
    const halfHeight = (obstacle.width / 2) * sin + (obstacle.height / 2) * cos
    index.insert(
      { obstacle, zLayers },
      obstacle.center.x - halfWidth,
      obstacle.center.y - halfHeight,
      obstacle.center.x + halfWidth,
      obstacle.center.y + halfHeight,
    )
  }
  index.finish()
  return index
}

function createFixedTraceBboxIndex(
  fixedTraces: readonly SimplifiedPcbTrace[],
  defaultTraceWidth: number,
  defaultViaDiameter: number,
): Flatbush | undefined {
  const boxes: Array<[number, number, number, number]> = []
  for (const trace of fixedTraces) {
    let prevWire: { x: number; y: number; width: number } | undefined
    for (const point of trace.route) {
      if (point.route_type === "via") {
        const radius = (point.via_diameter ?? defaultViaDiameter) / 2
        boxes.push([
          point.x - radius,
          point.y - radius,
          point.x + radius,
          point.y + radius,
        ])
        prevWire = undefined
        continue
      }
      if (point.route_type === "wire") {
        const width = point.width ?? defaultTraceWidth
        const radius = width / 2
        if (prevWire) {
          boxes.push([
            Math.min(prevWire.x, point.x) - radius,
            Math.min(prevWire.y, point.y) - radius,
            Math.max(prevWire.x, point.x) + radius,
            Math.max(prevWire.y, point.y) + radius,
          ])
        } else {
          boxes.push([
            point.x - radius,
            point.y - radius,
            point.x + radius,
            point.y + radius,
          ])
        }
        prevWire = { x: point.x, y: point.y, width }
      }
    }
  }
  if (boxes.length === 0) return undefined
  const index = new Flatbush(boxes.length)
  for (const [minX, minY, maxX, maxY] of boxes) {
    index.add(minX, minY, maxX, maxY)
  }
  index.finish()
  return index
}

function getFixedCopperNodePortPointIds({
  nodesWithPortPoints,
  fixedTraces,
  traceWidth,
  viaDiameter,
  obstacleMargin,
}: {
  nodesWithPortPoints: readonly NodeWithPortPoints[]
  fixedTraces: readonly SimplifiedPcbTrace[]
  traceWidth: number
  viaDiameter: number
  obstacleMargin: number
}): ReadonlySet<string> {
  const portPointIds = new Set<string>()
  const fixedIndex = createFixedTraceBboxIndex(
    fixedTraces,
    traceWidth,
    viaDiameter,
  )
  if (!fixedIndex) return portPointIds

  const pad = obstacleMargin + Math.max(traceWidth, viaDiameter) / 2
  for (const node of nodesWithPortPoints) {
    const minX = node.center.x - node.width / 2 - pad
    const maxX = node.center.x + node.width / 2 + pad
    const minY = node.center.y - node.height / 2 - pad
    const maxY = node.center.y + node.height / 2 + pad
    if (fixedIndex.search(minX, minY, maxX, maxY).length === 0) continue
    for (const point of node.portPoints) {
      if (point.portPointId) portPointIds.add(point.portPointId)
    }
  }
  return portPointIds
}

function isPortConnectedToBoardObstacle({
  point,
  obstacle,
  connMap,
}: {
  point: PortPoint
  obstacle: Obstacle
  connMap: ConnectivityMap
}): boolean {
  const pointNetId =
    connMap.getNetConnectedToId(point.connectionName) ??
    (point.rootConnectionName
      ? connMap.getNetConnectedToId(point.rootConnectionName)
      : undefined) ??
    point.rootConnectionName ??
    point.connectionName

  return obstacle.connectedTo.some((connectedId) => {
    const obstacleNetId =
      connMap.getNetConnectedToId(connectedId) ?? connectedId
    return obstacleNetId === pointNetId
  })
}

/**
 * Validates uniform port redistribution in Pipeline 9.
 *
 * Always enforces preloaded wire/via clearance via `createPreloadedPortValidator`.
 * On regions overlapping fixed preloaded copper (which Pipeline9HighDensitySolver
 * routes through HighDensitySolverB01 with hard board-obstacle margins), also
 * prevents redistribution from moving a shared-edge port into a foreign board
 * obstacle's clearance envelope.
 */
export function createPipeline9UniformPortValidator(
  input: Pipeline9UniformPortValidatorInput,
): PortValidator {
  const isClearOfPreloadedCopper = createPreloadedPortValidator(input)
  const fixedTraces = (input.srj.traces ?? []).filter(
    (trace) => trace.isFixed === true,
  )
  if (fixedTraces.length === 0) return isClearOfPreloadedCopper

  const obstacleIndex = createBoardObstacleIndex(input)
  if (!obstacleIndex) return isClearOfPreloadedCopper

  const clearance =
    input.srj.minTraceToPadEdgeClearance ??
    input.obstacleMargin ??
    input.srj.defaultObstacleMargin ??
    RELAXED_DRC_OPTIONS.traceClearance

  const scopedPortPointIds = input.nodesWithPortPoints
    ? getFixedCopperNodePortPointIds({
        nodesWithPortPoints: input.nodesWithPortPoints,
        fixedTraces,
        traceWidth: input.traceWidth,
        viaDiameter: input.viaDiameter,
        obstacleMargin: clearance,
      })
    : undefined
  if (scopedPortPointIds && scopedPortPointIds.size === 0) {
    return isClearOfPreloadedCopper
  }

  return (point, options): boolean => {
    if (!isClearOfPreloadedCopper(point, options)) return false
    if (
      scopedPortPointIds &&
      (!point.portPointId || !scopedPortPointIds.has(point.portPointId))
    ) {
      return true
    }

    const radius =
      input.traceWidth / 2 +
      (options?.includeClearance === false ? 0 : clearance)
    const nearbyObstacles = obstacleIndex.search(
      point.x - radius,
      point.y - radius,
      point.x + radius,
      point.y + radius,
    )
    for (const { obstacle, zLayers } of nearbyObstacles) {
      if (!zLayers.has(point.z)) continue
      if (
        getPointToBoardObstacleDistance(point, obstacle) <
        radius - OBSTACLE_CLEARANCE_EPSILON
      ) {
        if (
          !isPortConnectedToBoardObstacle({
            point,
            obstacle,
            connMap: input.connMap,
          })
        ) {
          return false
        }
      }
    }
    return true
  }
}
