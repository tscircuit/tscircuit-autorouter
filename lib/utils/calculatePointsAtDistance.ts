/**
 * Calculate points C and D given points A, B, and distance K
 *
 * @param pointA - Coordinates of point A
 * @param pointB - Coordinates of point B
 * @param k - Distance between points C and D (also the radius of circle B)
 * @returns Object containing coordinates of points C and D
 */
interface Point {
  x: number;
  y: number;
}

export function calculatePerpendicularPointsAtDistance(
  externalPoint: Point,
  centerPoint: Point,
  k: number,
): { A: Point; B: Point } {
  // Calculate the magnitude of vector AB
  const abMagnitude = Math.sqrt(
    (centerPoint.x - externalPoint.x) ** 2 +
      (centerPoint.y - externalPoint.y) ** 2,
  );

  // Calculate the unit vector components in the perpendicular direction
  const perpUnitX = -(centerPoint.y - externalPoint.y) / abMagnitude;
  const perpUnitY = (centerPoint.x - externalPoint.x) / abMagnitude;

  // Calculate the half-distance to use for point calculations
  const halfK = k / 2;

  // Calculate point C coordinates
  const pointC: Point = {
    x: centerPoint.x + perpUnitX * halfK,
    y: centerPoint.y + perpUnitY * halfK,
  };

  // Calculate point D coordinates
  const pointD: Point = {
    x: centerPoint.x - perpUnitX * halfK,
    y: centerPoint.y - perpUnitY * halfK,
  };

  return { A: pointC, B: pointD };
}
