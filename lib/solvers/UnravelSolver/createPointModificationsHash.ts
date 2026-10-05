import { SegmentPointId } from "./types"

export const createPointModificationsHash = (
  pointModifications: Map<
    SegmentPointId,
    { x?: number; y?: number; z?: number }
  >,
) => {
  return Array.from(pointModifications.entries())
    .map(
      ([id, { x, y, z }]) =>
        `${id}(${x?.toFixed(3) ?? ""},${y?.toFixed(3) ?? ""},${z ?? ""})`,
    )
    .sort()
    .join("&")
}

export const createFullPointModificationsHash = (
  originalPoints: Map<SegmentPointId, { x: number; y: number; z: number }>,
  pointModifications: Map<
    SegmentPointId,
    { x?: number; y?: number; z?: number }
  >,
) => {
  return Array.from(originalPoints.entries())
    .map(([id, originalPoint]) => {
      const mods = pointModifications.get(id)
      const finalPoint = {
        x: mods?.x !== undefined ? mods.x : originalPoint.x,
        y: mods?.y !== undefined ? mods.y : originalPoint.y,
        z: mods?.z !== undefined ? mods.z : originalPoint.z,
      }
      return `${id}(${finalPoint.x.toFixed(3)},${finalPoint.y.toFixed(3)},${finalPoint.z})`
    })
    .sort()
    .join("&")
}
