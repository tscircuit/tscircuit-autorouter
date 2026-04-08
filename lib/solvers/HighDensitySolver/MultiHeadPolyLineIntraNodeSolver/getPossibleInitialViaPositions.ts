import type { Bounds, Point } from "@tscircuit/math-utils"
import { getCentroidsFromInnerBoxIntersections } from "./getCentroidsFromInnerBoxIntersections"
import { generateBinaryCombinations } from "./generateBinaryCombinations"
import { MHPoint } from "./types1"

type ViaPositionVariantForLinesViaCountVariant = {
  viaPositions: Point[]
  viaCountVariant: number[]
}

/**
 * Get the all possible via positions if you consider the centroids of shapes
 * created by all the intersections that divide the bounding box of the node
 *
 * We iterate over the via count variants, for each variant we generate each
 * possible via position.
 * Remember: The viaCountVariants specifies the number of vias for each connection,
 * so that's how we know how many points to return
 */
export const getPossibleInitialViaPositions = (params: {
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
  viaCountVariants: Array<number[]>
  reservedViaPositionsByConnectionName?: Record<string, Point[]>
}): Array<ViaPositionVariantForLinesViaCountVariant> => {
  const {
    bounds,
    portPairsEntries,
    viaCountVariants,
    reservedViaPositionsByConnectionName = {},
  } = params

  const { centroids } = getCentroidsFromInnerBoxIntersections(
    bounds,
    portPairsEntries.map(([_, portPair]) => portPair),
  )

  const result: ViaPositionVariantForLinesViaCountVariant[] = []

  for (const viaCountVariant of viaCountVariants) {
    const viaCount = viaCountVariant.reduce((acc, count) => acc + count, 0)
    const reservedViaPositionsByConnection = portPairsEntries.map(
      ([connectionName], index) =>
        (reservedViaPositionsByConnectionName[connectionName] ?? []).slice(
          0,
          viaCountVariant[index],
        ),
    )
    const reservedViaPositionKeys = new Set(
      reservedViaPositionsByConnection
        .flat()
        .map((point) => `${point.x.toFixed(6)},${point.y.toFixed(6)}`),
    )
    const reservedViaCount = reservedViaPositionsByConnection.reduce(
      (count, points) => count + points.length,
      0,
    )
    const additionalViaCountNeeded = Math.max(0, viaCount - reservedViaCount)

    let viaPositionSource: Array<{ x: number; y: number }> = centroids
      .filter(
        (point) =>
          !reservedViaPositionKeys.has(
            `${point.x.toFixed(6)},${point.y.toFixed(6)}`,
          ),
      )

    if (viaPositionSource.length < additionalViaCountNeeded) {
      // There aren't enough centroids (might not be a very hard problem)
      // we can just space the vias evenly within the node
      viaPositionSource = []
      const rows = Math.ceil(Math.sqrt(additionalViaCountNeeded))
      const cols = rows
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const candidate = {
            x:
              bounds.minX +
              ((c + 1) / (cols + 1)) * (bounds.maxX - bounds.minX),
            y:
              bounds.minY +
              ((r + 1) / (rows + 1)) * (bounds.maxY - bounds.minY),
          }
          if (
            reservedViaPositionKeys.has(
              `${candidate.x.toFixed(6)},${candidate.y.toFixed(6)}`,
            )
          ) {
            continue
          }
          viaPositionSource.push(candidate)
        }
      }
    }

    const viaPositionVariants = generateBinaryCombinations(
      additionalViaCountNeeded,
      viaPositionSource.length,
    )

    for (const viaPositionVariant of viaPositionVariants) {
      const selectedAdditionalViaPositions: Point[] = []
      for (let i = 0; i < viaPositionVariant.length; i++) {
        if (viaPositionVariant[i] === 1) {
          selectedAdditionalViaPositions.push(viaPositionSource[i])
        }
      }

      const viaPositions: Point[] = []
      let additionalViaPositionIndex = 0
      for (let i = 0; i < portPairsEntries.length; i++) {
        viaPositions.push(...reservedViaPositionsByConnection[i])
        const remainingViaCountForConnection =
          viaCountVariant[i] - reservedViaPositionsByConnection[i].length
        for (let j = 0; j < remainingViaCountForConnection; j++) {
          viaPositions.push(
            selectedAdditionalViaPositions[additionalViaPositionIndex++],
          )
        }
      }
      result.push({
        viaPositions,
        viaCountVariant,
      })
    }
  }

  return result
}
