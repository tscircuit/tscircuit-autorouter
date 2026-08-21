import { Point2D } from "./JumperPrepatternSolver2_HyperGraph";

/**
 * Compute a perpendicular offset point for the midpoint of the outer segment.
 * This gives the force-directed graph a hint to route the outer segment around.
 */

export function computeOffsetMidpoint(
  outerStart: Point2D,
  outerEnd: Point2D,
  offsetDistance: number,
  preferredDirection?: "left" | "right",
): Point2D {
  const midX = (outerStart.x + outerEnd.x) / 2;
  const midY = (outerStart.y + outerEnd.y) / 2;

  // Get perpendicular direction
  const dx = outerEnd.x - outerStart.x;
  const dy = outerEnd.y - outerStart.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len < 1e-9) {
    return { x: midX, y: midY };
  }

  // Perpendicular unit vector (rotate 90 degrees)
  // "left" is counterclockwise, "right" is clockwise
  const perpX = -dy / len;
  const perpY = dx / len;

  const sign = preferredDirection === "right" ? -1 : 1;

  return {
    x: midX + sign * perpX * offsetDistance,
    y: midY + sign * perpY * offsetDistance,
  };
}
