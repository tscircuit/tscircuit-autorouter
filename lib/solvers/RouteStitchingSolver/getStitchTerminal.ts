import type { Point3 } from "@tscircuit/math-utils"
import {
  type ConnectionPoint,
  getConnectionPointLayers,
} from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export type StitchTerminal = Point3 & {
  pcb_port_id?: string
  availableZ?: readonly number[]
}

export const getStitchTerminal = (
  point: ConnectionPoint,
  layerCount: number,
): StitchTerminal => {
  const availableZ = getConnectionPointLayers(point).map(
    (layer: string): number => mapLayerNameToZ(layer, layerCount),
  )
  if (availableZ.length === 0) {
    throw new Error("Route stitching received a terminal with no copper layer")
  }
  return { ...point, z: availableZ[0]!, availableZ }
}
