/**
 * Calculates the midpoint between two points.
 */
export function getMidpoint(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  }
}
