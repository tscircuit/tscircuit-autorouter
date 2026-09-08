import Flatbush from "flatbush"

const flatbushSearch = Flatbush.prototype.search

export function searchObstacleIndex(
  index: Flatbush | null | undefined,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): number[] {
  if (!index) return []
  if (index.search === flatbushSearch) {
    const boxes = index._boxes
    // Use the stored root that search visits, including reconstructed indexes.
    // An unfinished index must still reach Flatbush's validation error.
    if (index._pos === boxes.length) {
      const root = boxes.length - 4
      if (
        maxX < boxes[root] ||
        maxY < boxes[root + 1] ||
        minX > boxes[root + 2] ||
        minY > boxes[root + 3]
      ) {
        return []
      }
    }
  }
  return index.search(minX, minY, maxX, maxY)
}
