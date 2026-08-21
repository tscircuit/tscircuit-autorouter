type Point = { x: number; y: number };
type Segment = [Point, Point];

/**
 * Computes the number of closed (finite) polygonal faces formed by a set of line segments.
 *
 * This function takes an array of segments—each defined by two endpoints—and:
 * 1. Finds all intersection points between every pair of segments.
 * 2. Builds a unified list of unique vertices (original endpoints + intersection points).
 * 3. Splits each segment at its intersection points, creating a complete edge graph.
 * 4. Sorts adjacency lists around each vertex in counter-clockwise order.
 * 5. Traverses every half-edge exactly once to extract all simple polygonal loops (faces).
 * 6. Discards the exterior (infinite) face by identifying the loop with the largest absolute signed area.
 *
 * @param segments - An array of line segments, where each segment is a tuple [Point, Point].
 *                   A Point is an object with numeric `x` and `y` properties.
 * @returns The count of finite, closed faces (polygons) formed by the arrangement of all segments.
 *
 * @example
 * ```ts
 * const segments: Array<[Point, Point]> = [
 *   [{ x: 0, y: 0 }, { x: 100, y: 0 }],
 *   [{ x: 100, y: 0 }, { x: 100, y: 100 }],
 *   [{ x: 100, y: 100 }, { x: 0, y: 100 }],
 *   [{ x: 0, y: 100 }, { x: 0, y: 0 }],
 *   // diagonal splits square into two triangles
 *   [{ x: 0, y: 0 }, { x: 100, y: 100 }],
 * ];
 *
 * // There are 2 triangular faces inside the square.
 * console.log(getNumberOfClosedFaces(segments)); // → 2
 * ```
 *
 * @see https://en.wikipedia.org/wiki/Planar_graph#Faces
 */
export function getNumberOfClosedFaces(segments: Segment[]): number {
  const epsilon = 1e-10;

  // 1. Find all intersection points between segments
  const intersections: Point[] = [];
  function findIntersection(
    p1: Point,
    p2: Point,
    p3: Point,
    p4: Point,
  ): Point | null {
    const a1 = p2.y - p1.y;
    const b1 = p1.x - p2.x;
    const c1 = p2.x * p1.y - p1.x * p2.y;
    const a2 = p4.y - p3.y;
    const b2 = p3.x - p4.x;
    const c2 = p4.x * p3.y - p3.x * p4.y;
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < epsilon) return null;
    const x = (b1 * c2 - b2 * c1) / det;
    const y = (a2 * c1 - a1 * c2) / det;
    if (isOnSeg(p1, p2, { x, y }) && isOnSeg(p3, p4, { x, y })) return { x, y };
    return null;
  }

  function isOnSeg(a: Point, b: Point, p: Point): boolean {
    const minX = Math.min(a.x, b.x) - epsilon;
    const maxX = Math.max(a.x, b.x) + epsilon;
    const minY = Math.min(a.y, b.y) - epsilon;
    const maxY = Math.max(a.y, b.y) + epsilon;
    if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) return false;
    const cross = Math.abs(
      (p.y - a.y) * (b.x - a.x) - (b.y - a.y) * (p.x - a.x),
    );
    return cross < epsilon;
  }

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const p = findIntersection(
        segments[i][0],
        segments[i][1],
        segments[j][0],
        segments[j][1],
      );
      if (p) intersections.push(p);
    }
  }

  // 2. Build unique vertex list (endpoints + intersections)
  const vertices: Point[] = [];
  function addPoint(pt: Point) {
    if (!vertices.some((v) => Math.hypot(v.x - pt.x, v.y - pt.y) < epsilon)) {
      vertices.push({ x: pt.x, y: pt.y });
    }
  }
  for (const seg of segments) {
    addPoint(seg[0]);
    addPoint(seg[1]);
  }
  intersections.forEach(addPoint);

  // 3. Build edge list by splitting each segment at its intersections
  const edges: [number, number][] = [];
  function findIdx(pt: Point): number {
    return vertices.findIndex(
      (v) => Math.hypot(v.x - pt.x, v.y - pt.y) < epsilon,
    );
  }
  function addEdge(u: number, v: number) {
    if (u === v) return;
    if (
      !edges.some(
        (e) => (e[0] === u && e[1] === v) || (e[0] === v && e[1] === u),
      )
    ) {
      edges.push([u, v]);
    }
  }

  for (const [A, B] of segments) {
    const u0 = findIdx(A);
    const u1 = findIdx(B);
    // collect all intersection indices on this segment
    const onSeg = intersections
      .map((p, i) => ({
        p,
        idx: findIdx(p),
        d: Math.hypot(p.x - A.x, p.y - A.y),
      }))
      .filter((o) => isOnSeg(A, B, o.p))
      .sort((a, b) => a.d - b.d);
    let prev = u0;
    for (const { idx } of onSeg) {
      addEdge(prev, idx);
      prev = idx;
    }
    addEdge(prev, u1);
  }

  // 4. Build adjacency and sort neighbors CCW
  const adj: number[][] = Array(vertices.length)
    .fill(0)
    .map(() => []);
  edges.forEach(([u, v]) => {
    adj[u].push(v);
    adj[v].push(u);
  });
  const angleAt = (center: Point, p: Point) =>
    Math.atan2(p.y - center.y, p.x - center.x);
  adj.forEach((nbrs, v) => {
    const C = vertices[v];
    nbrs.sort((a, b) => angleAt(C, vertices[a]) - angleAt(C, vertices[b]));
  });

  // 5. Walk every half-edge to extract faces
  const visited = Array(vertices.length)
    .fill(0)
    .map(() => Array(vertices.length).fill(false));
  const faces: number[][] = [];

  for (let u = 0; u < vertices.length; u++) {
    for (const v of adj[u]) {
      if (visited[u][v]) continue;
      const face: number[] = [];
      let currU = u;
      let currV = v;

      // walk until we return to (u->v)
      do {
        visited[currU][currV] = true;
        face.push(currU);
        // at currV, find neighbor just before currU in CCW list
        const nbrs = adj[currV];
        const idx = nbrs.indexOf(currU);
        const next = nbrs[(idx - 1 + nbrs.length) % nbrs.length];
        [currU, currV] = [currV, next];
      } while (!(currU === u && currV === v));

      faces.push(face);
    }
  }

  if (faces.length === 0) return 0;

  // 6. Discard the outer face (the one with largest absolute signed area)
  function polygonArea(ids: number[]): number {
    let area = 0;
    for (let i = 0; i < ids.length; i++) {
      const a = vertices[ids[i]];
      const b = vertices[ids[(i + 1) % ids.length]];
      area += a.x * b.y - b.x * a.y;
    }
    return area / 2;
  }
  const areas = faces.map(polygonArea);
  const outerIdx = areas
    .map((a) => Math.abs(a))
    .indexOf(Math.max(...areas.map((a) => Math.abs(a))));

  return faces.length - 1; // subtract the outer face
}
