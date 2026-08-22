import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"
import { isMultiLayerConnectionPoint } from "lib/types/srj-types"

function resolveRoutingLayer(layer: string, layerCount: number): number {
  if (layer === "top") return 0
  if (layer === "bottom") return layerCount - 1

  const innerLayerMatch = /^inner([1-9][0-9]*)$/.exec(layer)
  const z = innerLayerMatch ? Number(innerLayerMatch[1]) : Number.NaN
  if (!Number.isInteger(z) || z <= 0 || z >= layerCount - 1) {
    throw new Error(
      `Invalid routing layer "${layer}" for a ${layerCount}-layer board`,
    )
  }
  return z
}

export function getRoutingZLayers(srj: SimpleRouteJson): number[] {
  if (srj.routingLayers === undefined) {
    return Array.from({ length: srj.layerCount }, (_, z) => z)
  }
  if (srj.routingLayers.length === 0) {
    throw new Error("routingLayers must contain at least one board layer")
  }

  const routingZLayers = srj.routingLayers.map((layer) =>
    resolveRoutingLayer(layer, srj.layerCount),
  )
  if (new Set(routingZLayers).size !== routingZLayers.length) {
    throw new Error("routingLayers must not contain duplicate board layers")
  }
  return [...routingZLayers].sort((a, b) => a - b)
}

export function normalizeSrjRoutingLayers(
  srj: SimpleRouteJson,
): SimpleRouteJson {
  if (srj.routingLayers === undefined) return srj

  const routingZLayers = new Set(getRoutingZLayers(srj))
  const connections = srj.connections.map((connection) => ({
    ...connection,
    pointsToConnect: connection.pointsToConnect.map((point, pointIndex) => {
      if (isMultiLayerConnectionPoint(point)) {
        const layers = point.layers.filter((layer) =>
          routingZLayers.has(resolveRoutingLayer(layer, srj.layerCount)),
        )
        if (layers.length === 0) {
          throw new Error(
            `Connection "${connection.name}" point ${pointIndex} has no layer allowed by routingLayers`,
          )
        }
        return { ...point, layers }
      }

      const z = resolveRoutingLayer(point.layer, srj.layerCount)
      if (!routingZLayers.has(z)) {
        throw new Error(
          `Connection "${connection.name}" point ${pointIndex} is on excluded routing layer "${point.layer}"`,
        )
      }
      if (point.terminalVia) {
        const terminalViaZ = resolveRoutingLayer(
          point.terminalVia.toLayer,
          srj.layerCount,
        )
        if (!routingZLayers.has(terminalViaZ)) {
          throw new Error(
            `Connection "${connection.name}" point ${pointIndex} terminal via ends on excluded routing layer "${point.terminalVia.toLayer}"`,
          )
        }
      }
      return point
    }),
  }))

  const buses = srj.buses?.map((bus) => {
    if (bus.allowedLayers === undefined) return bus
    const allowedLayers = bus.allowedLayers.filter((layer) =>
      routingZLayers.has(resolveRoutingLayer(layer, srj.layerCount)),
    )
    if (allowedLayers.length === 0) {
      throw new Error(
        `Bus "${bus.busId}" has no layer allowed by routingLayers`,
      )
    }
    return { ...bus, allowedLayers }
  })

  return { ...srj, connections, buses }
}

export function restrictCapacityNodesToRoutingLayers(
  capacityNodes: CapacityMeshNode[],
  srj: SimpleRouteJson,
): CapacityMeshNode[] {
  if (srj.routingLayers === undefined) return capacityNodes

  const routingZLayers = new Set(getRoutingZLayers(srj))
  return capacityNodes
    .map((node) => ({
      ...node,
      availableZ: node.availableZ.filter((z) => routingZLayers.has(z)),
    }))
    .filter((node) => node.availableZ.length > 0)
}

export function restrictZLayersToRoutingLayers(
  zLayers: readonly number[],
  srj: SimpleRouteJson,
): number[] {
  if (srj.routingLayers === undefined) return [...zLayers]
  const routingZLayers = new Set(getRoutingZLayers(srj))
  return zLayers.filter((z) => routingZLayers.has(z))
}

/**
 * The current high-density-repair03 layer-move APIs enumerate every z from
 * zero through layerCount - 1 and do not accept an allowlist. Keep those
 * optional moves off for a proper subset until that API can enforce allowed
 * targets itself. Other repair phases remain enabled.
 */
export function canUseUnrestrictedLayerMoves(srj: SimpleRouteJson): boolean {
  return getRoutingZLayers(srj).length === srj.layerCount
}
