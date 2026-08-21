interface Point {
  x: number;
  y: number;
}

/**
 * Calculates the points around a dumbbell segment
 * @param pointA The first end point of the segment
 * @param pointB The second end point of the segment
 * @param radius The radius of the circles at each end
 * @returns Object containing all the calculated points
 *
 * https://claude.ai/artifacts/80208409-688e-40bc-8936-41019224eb90
 */
export function calculateDumbbellPoints(
  pointA: Point,
  pointB: Point,
  radius: number,
): {
  A_Opp: Point;
  A_Right: Point;
  A_Left: Point;
  B_Opp: Point;
  B_Right: Point;
  B_Left: Point;
} {
  // Calculate the vector from A to B
  const dx = pointB.x - pointA.x;
  const dy = pointB.y - pointA.y;

  // Calculate the unit vector in the direction from A to B
  const length = Math.sqrt(dx * dx + dy * dy);
  const ux = dx / length;
  const uy = dy / length;

  // Calculate the unit vector perpendicular to A->B (for left and right points)
  const perpx = -uy; // Perpendicular vector (x component)
  const perpy = ux; // Perpendicular vector (y component)

  // Calculate A_Opp (point opposite to B on circle A)
  const A_Opp = {
    x: pointA.x - ux * radius,
    y: pointA.y - uy * radius,
  };

  // Calculate A_Right (90 degrees clockwise from A_Opp)
  const A_Right = {
    x: pointA.x + perpx * radius,
    y: pointA.y + perpy * radius,
  };

  // Calculate A_Left (90 degrees counter-clockwise from A_Opp)
  const A_Left = {
    x: pointA.x - perpx * radius,
    y: pointA.y - perpy * radius,
  };

  // Calculate B_Opp (point opposite to A on circle B)
  const B_Opp = {
    x: pointB.x + ux * radius,
    y: pointB.y + uy * radius,
  };

  // Calculate B_Right (90 degrees clockwise from B_Opp)
  const B_Right = {
    x: pointB.x + perpx * radius,
    y: pointB.y + perpy * radius,
  };

  // Calculate B_Left (90 degrees counter-clockwise from B_Opp)
  const B_Left = {
    x: pointB.x - perpx * radius,
    y: pointB.y - perpy * radius,
  };

  return {
    A_Opp,
    A_Right,
    A_Left,
    B_Opp,
    B_Right,
    B_Left,
  };
}
