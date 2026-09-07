import type { Obstacle } from "lib/types"

type RectangularPadUnion = {
  x: number
  y: number
  width: number
  height: number
}

/** Only merges rectangles whose complete union is one rectangle. */
const getExactRectangularPadUnion = (
  pieces: readonly Obstacle[],
): RectangularPadUnion | null => {
  const first = pieces[0]
  const padId = first?.circuitJsonMetadata?.pcb_smtpad_id
  const portId = first?.circuitJsonMetadata?.pcb_port_id
  if (pieces.length < 2 || !first || !padId || !portId) return null
  if (
    pieces.some(
      (piece): boolean =>
        piece.type !== "rect" ||
        (piece.ccwRotationDegrees !== undefined &&
          piece.ccwRotationDegrees !== 0) ||
        piece.layers.length !== 1 ||
        piece.layers[0] !== first.layers[0] ||
        piece.circuitJsonMetadata?.pcb_smtpad_id !== padId ||
        piece.circuitJsonMetadata?.pcb_port_id !== portId ||
        Boolean(piece.circuitJsonMetadata?.pcb_plated_hole_id) ||
        Boolean(piece.circuitJsonMetadata?.pcb_via_id) ||
        ![
          piece.center.x,
          piece.center.y,
          piece.width,
          piece.height,
        ].every(Number.isFinite) ||
        piece.width <= 0 ||
        piece.height <= 0,
    )
  ) {
    return null
  }

  const vertical = pieces.every(
    (piece): boolean =>
      piece.center.x === first.center.x && piece.width === first.width,
  )
  const horizontal = pieces.every(
    (piece): boolean =>
      piece.center.y === first.center.y && piece.height === first.height,
  )
  if (!vertical && !horizontal) return null
  const intervals = pieces
    .map((piece): [number, number] => {
      const center = vertical ? piece.center.y : piece.center.x
      const size = vertical ? piece.height : piece.width
      return [center - size / 2, center + size / 2]
    })
    .sort((a, b): number => a[0] - b[0])
  const start = intervals[0]![0]
  let end = intervals[0]![1]
  for (const [lo, hi] of intervals) {
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > end) return null
    end = Math.max(end, hi)
  }
  if (!Number.isFinite(end - start)) return null
  return vertical
    ? {
        x: first.center.x,
        y: start + (end - start) / 2,
        width: first.width,
        height: end - start,
      }
    : {
        x: start + (end - start) / 2,
        y: first.center.y,
        width: end - start,
        height: first.height,
      }
}

/** Preserve complete copper coverage when a pad is stored as aligned strips. */
export const mergeRectangularSmtPadObstacles = (
  obstacles: Obstacle[],
): Obstacle[] => {
  const groups = new Map<string, number[]>()
  for (const [index, obstacle] of obstacles.entries()) {
    const id = obstacle.circuitJsonMetadata?.pcb_smtpad_id
    if (!id) continue
    const group = groups.get(id)
    if (group) group.push(index)
    else groups.set(id, [index])
  }
  const replacements = new Map<number, Obstacle>()
  const absorbed = new Set<number>()
  for (const indices of groups.values()) {
    const pieces = indices.map((index): Obstacle => obstacles[index]!)
    const union = getExactRectangularPadUnion(pieces)
    if (!union) continue
    replacements.set(indices[0]!, {
      ...pieces[0]!,
      center: { x: union.x, y: union.y },
      width: union.width,
      height: union.height,
      connectedTo: [
        ...new Set(pieces.flatMap((piece): string[] => piece.connectedTo)),
      ],
    })
    for (const index of indices.slice(1)) absorbed.add(index)
  }
  if (replacements.size === 0) return obstacles
  return obstacles.flatMap((obstacle, index): Obstacle[] =>
    absorbed.has(index) ? [] : [replacements.get(index) ?? obstacle],
  )
}
