import {
  getAvailableZFromMask,
  getObstacleLayerMask,
  getOffsetPolygonPoints,
  type PolyHyperGraphConnection,
  type PolyHyperGraphObstacleRegion,
  type Polygon,
  type Rect,
} from "pcb-poly-hyper-graph"
import type {
  ConnectionPoint,
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"

type AnyObstacle = Omit<Obstacle, "type"> & {
  type: string
  __zLayers?: number[]
  isCopperPour?: boolean
}

const getRotationRadians = (obstacle: { ccwRotationDegrees?: number }) =>
  ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180

export const getRectPoints = (
  obstacle: {
    center: { x: number; y: number }
    width: number
    height: number
    ccwRotationDegrees?: number
  },
  clearance = 0,
) => {
  const halfWidth = obstacle.width / 2 + clearance
  const halfHeight = obstacle.height / 2 + clearance
  const rotation = getRotationRadians(obstacle)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  return [
    { localX: -halfWidth, localY: -halfHeight },
    { localX: halfWidth, localY: -halfHeight },
    { localX: halfWidth, localY: halfHeight },
    { localX: -halfWidth, localY: halfHeight },
  ].map(({ localX, localY }) => ({
    x: obstacle.center.x + localX * cos - localY * sin,
    y: obstacle.center.y + localX * sin + localY * cos,
  }))
}

const getOvalPoints = (
  obstacle: {
    center: { x: number; y: number }
    width: number
    height: number
    ccwRotationDegrees?: number
  },
  segmentCount = 8,
) => {
  const rx = obstacle.width / 2
  const ry = obstacle.height / 2
  const rotation = getRotationRadians(obstacle)
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  return Array.from({ length: segmentCount }, (_, index) => {
    const angle = (2 * Math.PI * index) / segmentCount
    const localX = rx * Math.cos(angle)
    const localY = ry * Math.sin(angle)
    return {
      x: obstacle.center.x + localX * cos - localY * sin,
      y: obstacle.center.y + localX * sin + localY * cos,
    }
  })
}

export const getPolyGraphRectsFromSrj = (srj: SimpleRouteJson): Rect[] =>
  (srj.obstacles ?? [])
    .filter((obstacle) => obstacle.type === "rect")
    .map((obstacle) => ({
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
      ccwRotation: getRotationRadians(obstacle),
      layers: obstacle.layers,
      zLayers: obstacle.__zLayers,
      isCopperPour: obstacle.isCopperPour,
    }))

export const getPolyGraphPolygonsFromSrj = (srj: SimpleRouteJson): Polygon[] =>
  (srj.obstacles ?? [])
    .filter((obstacle) => (obstacle as AnyObstacle).type === "oval")
    .map((obstacle) => ({
      points: getOvalPoints(obstacle),
      layers: obstacle.layers,
      zLayers: obstacle.__zLayers,
      isCopperPour: obstacle.isCopperPour,
    }))

export const getConnectedObstacleRegionsFromSrj = (
  srj: SimpleRouteJson,
  clearance: number,
): PolyHyperGraphObstacleRegion[] =>
  (srj.obstacles ?? []).flatMap((obstacle, obstacleIndex) => {
    if (
      !Array.isArray(obstacle.connectedTo) ||
      obstacle.connectedTo.length === 0
    ) {
      return []
    }

    const availableZ = getAvailableZFromMask(
      getObstacleLayerMask(obstacle as any, srj.layerCount),
      srj.layerCount,
    )
    if (availableZ.length === 0) return []

    let polygon: Array<{ x: number; y: number }>
    const obstacleType = (obstacle as AnyObstacle).type
    if (obstacleType === "rect") {
      polygon = getRectPoints(obstacle, clearance)
    } else if (obstacleType === "oval") {
      polygon = getOffsetPolygonPoints({
        polygon: {
          points: getOvalPoints(obstacle),
          layers: obstacle.layers,
          zLayers: obstacle.__zLayers,
          isCopperPour: obstacle.isCopperPour,
        },
        clearance,
        verticesOnly: true,
      })
    } else {
      return []
    }

    return [
      {
        regionId: `connected-obstacle-${obstacleIndex}`,
        polygon,
        availableZ,
        connectedTo: obstacle.connectedTo,
        d: {
          obstacleIndex,
          obstacleType,
          connectedTo: obstacle.connectedTo,
        },
      },
    ]
  })

const getPairConnection = (
  connection: SimpleRouteConnection,
  start: ConnectionPoint,
  end: ConnectionPoint,
  index: number,
) => {
  const name =
    connection.pointsToConnect.length === 2
      ? connection.name
      : `${connection.name}::${index}`
  return {
    ...connection,
    name,
    __rootConnectionNames: connection.__rootConnectionNames ?? [
      connection.name,
    ],
    pointsToConnect: [start, end],
  } satisfies SimpleRouteConnection
}

export const getPolyGraphConnectionsFromSrj = (
  srj: SimpleRouteJson,
): PolyHyperGraphConnection[] =>
  srj.connections.flatMap((connection) => {
    const points = connection.pointsToConnect ?? []
    if (points.length < 2) return []

    const start = points[0]!
    return points.slice(1).map((end, index) => {
      const pairConnection = getPairConnection(connection, start, end, index)
      return {
        connectionId: pairConnection.name,
        mutuallyConnectedNetworkId:
          pairConnection.__rootConnectionNames?.[0] ?? pairConnection.name,
        start,
        end,
        simpleRouteConnection: pairConnection,
      }
    })
  })
