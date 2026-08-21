interface RoutePoint {
  x: number;
  y: number;
  z: number;
}

interface MergedSegment {
  points: { x: number; y: number }[];
  z: number;
  connectionName: string;
  color: string;
}

/**
 * Merges consecutive route points with the same z-coordinate into segments
 * @param route Array of route points
 * @param connectionName Name of the connection
 * @param color Color for the segment
 * @returns Array of merged segments
 */
export function mergeRouteSegments(
  route: RoutePoint[],
  connectionName: string,
  color: string,
): MergedSegment[] {
  const segments: MergedSegment[] = [];
  let currentSegment: MergedSegment | null = null;

  for (let i = 0; i < route.length; i++) {
    const point = route[i];

    if (!currentSegment) {
      currentSegment = {
        points: [{ x: point.x, y: point.y }],
        z: point.z,
        connectionName,
        color,
      };
    } else if (currentSegment.z === point.z) {
      currentSegment.points.push({ x: point.x, y: point.y });
    } else {
      segments.push(currentSegment);
      currentSegment = {
        points: [{ x: point.x, y: point.y }],
        z: point.z,
        connectionName,
        color,
      };
    }

    // Add final segment if we're at the last point
    if (i === route.length - 1 && currentSegment) {
      segments.push(currentSegment);
    }
  }

  return segments;
}
