interface Point {
  x: number;
  y: number;
}

export const calculate45DegreePaths = (
  pointA: Point,
  pointB: Point,
): Array<Array<Point>> => {
  const result: Array<Array<Point>> = [];
  const dx = Math.abs(pointB.x - pointA.x);
  const dy = Math.abs(pointB.y - pointA.y);
  const signX = pointB.x > pointA.x ? 1 : -1;
  const signY = pointB.y > pointA.y ? 1 : -1;

  // Path 1: Horizontal then 45 degrees
  const midPoint1: Point = {
    x: pointB.x - signX * Math.abs(pointB.y - pointA.y),
    y: pointA.y,
  };
  // Check if midpoint is within bounds
  if (
    (midPoint1.x - pointA.x) * signX >= 0 &&
    (midPoint1.x - pointB.x) * signX <= 0
  ) {
    result.push([pointA, midPoint1, pointB]);
  }

  // Path 2: Vertical then 45 degrees
  const midPoint2: Point = {
    x: pointA.x,
    y: pointB.y - signY * Math.abs(pointB.x - pointA.x),
  };
  // Check if midpoint is within bounds
  if (
    (midPoint2.y - pointA.y) * signY >= 0 &&
    (midPoint2.y - pointB.y) * signY <= 0
  ) {
    result.push([pointA, midPoint2, pointB]);
  }

  // // Calculate 45-degree points
  const minDist = Math.min(dx, dy);

  // // Path 3: 45 degrees then horizontal
  const midPoint3: Point = {
    x: pointA.x + signX * minDist,
    y: pointA.y + signY * minDist,
  };
  // Check if midpoint is within bounds
  if (
    (midPoint3.x - pointA.x) * signX >= 0 &&
    (midPoint3.x - pointB.x) * signX <= 0 &&
    (midPoint3.y - pointA.y) * signY >= 0 &&
    (midPoint3.y - pointB.y) * signY <= 0
  ) {
    result.push([pointA, midPoint3, pointB]);
  }

  return result;
};
