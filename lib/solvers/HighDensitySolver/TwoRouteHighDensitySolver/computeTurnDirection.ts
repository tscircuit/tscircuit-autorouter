import { Point } from "@tscircuit/math-utils";
import { pointToAngle } from "./calculateSideTraversal";

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

type AngleTriplet = {
  angleA: number;
  angleB: number;
  angleC: number;
};

export function triangleDirection({
  angleA,
  angleB,
  angleC,
}: AngleTriplet): "cw" | "ccw" {
  // Convert angles to Cartesian coordinates on unit circle
  const Ax = Math.cos(angleA);
  const Ay = Math.sin(angleA);
  const Bx = Math.cos(angleB);
  const By = Math.sin(angleB);
  const Cx = Math.cos(angleC);
  const Cy = Math.sin(angleC);

  // Compute the signed area of the triangle (A → B → C)
  const signedArea = (Bx - Ax) * (Cy - Ay) - (By - Ay) * (Cx - Ax);

  return signedArea < 0 ? "ccw" : "cw";
}

/**
 * Determines the turn direction when moving from A to B to C along the boundary.
 */
export function computeTurnDirection(
  A: Point,
  B: Point,
  C: Point,
  bounds: Bounds,
): "cw" | "ccw" {
  const angleA = pointToAngle(A, bounds);
  const angleB = pointToAngle(B, bounds);
  const angleC = pointToAngle(C, bounds);

  return triangleDirection({ angleA, angleB, angleC });
}
