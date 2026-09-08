import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Pipeline9FixedPadClearance } from "../AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadClearance"
import { createPipeline9FixedPadRectanglePredicate } from "../AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FixedPadRectanglePredicate"
import type { Pipeline9NetworkedFixedPadClearance } from "./pipeline9NetworkedTypes"

export const serializePipeline9FixedPadClearanceForNode = (params: {
  node: NodeWithPortPoints
  fixedPadClearance: Pipeline9FixedPadClearance
  traceWidth: number
  viaDiameter: number
}): Pipeline9NetworkedFixedPadClearance => ({
  rectangles: params.fixedPadClearance.rectangles
    .filter(createPipeline9FixedPadRectanglePredicate(params))
    .map(
      (rectangle): Pipeline9NetworkedFixedPadClearance["rectangles"][number] => ({
        ...rectangle,
        center: { ...rectangle.center },
        zLayers: [...rectangle.zLayers],
        ownerNetIds: [...rectangle.ownerNetIds].sort(),
      }),
    ),
  layerCount: params.fixedPadClearance.layerCount,
  traceToPadClearance: params.fixedPadClearance.traceToPadClearance,
  viaToPadClearance: params.fixedPadClearance.viaToPadClearance,
})

/** Owner strings are already canonical; a projected map must not rename them. */
export const deserializePipeline9FixedPadClearance = (
  serialized: Pipeline9NetworkedFixedPadClearance,
): Pipeline9FixedPadClearance => {
  const rectangles = serialized.rectangles.map(
    (rectangle, rectangleIndex): FixedCopperRectangle => {
      if (
        !Array.isArray(rectangle.ownerNetIds) ||
        rectangle.ownerNetIds.some(
          (owner): boolean => typeof owner !== "string" || owner.length === 0,
        ) ||
        new Set(rectangle.ownerNetIds).size > 1
      ) {
        throw new Error(
          `Pipeline9 networked fixed pad ${rectangleIndex} has invalid canonical ownership`,
        )
      }
      return {
        ...rectangle,
        center: { ...rectangle.center },
        zLayers: [...rectangle.zLayers],
        ownerNetIds: new Set(rectangle.ownerNetIds),
      }
    },
  )
  return {
    rectangles,
    layerCount: serialized.layerCount,
    traceToPadClearance: serialized.traceToPadClearance,
    viaToPadClearance: serialized.viaToPadClearance,
    traceClearanceIndex: new FixedCopperClearanceIndex({
      rectangles,
      layerCount: serialized.layerCount,
      minClearance: serialized.traceToPadClearance,
    }),
    viaClearanceIndex: new FixedCopperClearanceIndex({
      rectangles,
      layerCount: serialized.layerCount,
      minClearance: serialized.viaToPadClearance,
    }),
  }
}
