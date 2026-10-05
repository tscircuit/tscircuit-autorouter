interface Point {
  x: number
  y: number
}

export const findCircleLineIntersections = (
  circle: Point & { r: number },
  line: { p1: Point; p2: Point },
) => {
  const cx = circle.x
  const cy = circle.y
  const r = circle.r

  const x1 = line.p1.x
  const y1 = line.p1.y
  const x2 = line.p2.x
  const y2 = line.p2.y

  // Check if line is vertical
  if (Math.abs(x2 - x1) < 0.001) {
    const x = x1

    // Calculate discriminant
    const a = r * r - (x - cx) ** 2

    if (a < 0) return [] // No intersection

    if (Math.abs(a) < 0.001) {
      // One intersection
      const y = cy
      // Check if this point is within the line segment
      if (y >= Math.min(y1, y2) && y <= Math.max(y1, y2)) {
        return [{ x, y }]
      }
      return []
    }

    // Two intersections
    const y_1 = cy + Math.sqrt(a)
    const y_2 = cy - Math.sqrt(a)

    const points: Point[] = []
    if (y_1 >= Math.min(y1, y2) && y_1 <= Math.max(y1, y2)) {
      points.push({ x, y: y_1 })
    }
    if (y_2 >= Math.min(y1, y2) && y_2 <= Math.max(y1, y2)) {
      points.push({ x, y: y_2 })
    }

    return points
  }

  // Line is not vertical
  const m = (y2 - y1) / (x2 - x1)
  const b = y1 - m * x1

  // Substitute line equation into circle equation
  const A = 1 + m * m
  const B = 2 * (m * b - m * cy - cx)
  const C = cx * cx + (b - cy) * (b - cy) - r * r

  // Calculate discriminant
  const discriminant = B * B - 4 * A * C

  if (discriminant < 0) return [] // No intersection

  if (Math.abs(discriminant) < 0.001) {
    // One intersection
    const x = -B / (2 * A)
    const y = m * x + b

    // Check if this point is within the line segment
    if (
      x >= Math.min(x1, x2) &&
      x <= Math.max(x1, x2) &&
      y >= Math.min(y1, y2) &&
      y <= Math.max(y1, y2)
    ) {
      return [{ x, y }]
    }
    return []
  }

  // Two intersections
  const x_1 = (-B + Math.sqrt(discriminant)) / (2 * A)
  const x_2 = (-B - Math.sqrt(discriminant)) / (2 * A)
  const y_1 = m * x_1 + b
  const y_2 = m * x_2 + b

  const points: Point[] = []
  if (
    x_1 >= Math.min(x1, x2) &&
    x_1 <= Math.max(x1, x2) &&
    y_1 >= Math.min(y1, y2) &&
    y_1 <= Math.max(y1, y2)
  ) {
    points.push({ x: x_1, y: y_1 })
  }
  if (
    x_2 >= Math.min(x1, x2) &&
    x_2 <= Math.max(x1, x2) &&
    y_2 >= Math.min(y1, y2) &&
    y_2 <= Math.max(y1, y2)
  ) {
    points.push({ x: x_2, y: y_2 })
  }

  return points
}
