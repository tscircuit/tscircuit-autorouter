type Point = { x: number; y: number }

/** Remove the part inside a declared shared terminal's contact region. */
export const trimSegmentAtTerminal = (
  segment: [Point, Point],
  terminal: Point,
  radius: number,
): [Point, Point] | null => {
  const [start, end] = segment
  const startInside =
    Math.hypot(start.x - terminal.x, start.y - terminal.y) <= radius
  const endInside = Math.hypot(end.x - terminal.x, end.y - terminal.y) <= radius
  if (startInside && endInside) return null
  if (!startInside && !endInside) return segment
  const inside = startInside ? start : end
  const outside = startInside ? end : start
  const dx = outside.x - inside.x
  const dy = outside.y - inside.y
  const tx = inside.x - terminal.x
  const ty = inside.y - terminal.y
  const a = dx * dx + dy * dy
  const b = 2 * (tx * dx + ty * dy)
  const c = tx * tx + ty * ty - radius * radius
  const amount = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a)
  const boundary = { x: inside.x + dx * amount, y: inside.y + dy * amount }
  return startInside ? [boundary, end] : [start, boundary]
}
