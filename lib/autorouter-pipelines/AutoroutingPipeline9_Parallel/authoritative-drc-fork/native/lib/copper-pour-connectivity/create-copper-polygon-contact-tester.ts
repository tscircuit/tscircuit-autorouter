// Pinned from @tscircuit/checks 0.0.233 bundled source; see the authoritative-drc-fork LICENSE and PROVENANCE.md.
import {
  Box,
  type Arc,
  type Point,
  type Polygon,
  type PolygonEdge,
  type Segment,
} from "@flatten-js/core"

interface PolygonGeometry {
  box: Box
  facePoints: Point[]
  edges: (Segment | Arc)[]
  edgeIndex: Polygon["edges"]
}

/** Cache only for one connectivity pass: the input polygons must remain unchanged. */
export function createCopperPolygonContactTester(tolerance: number) {
  const cache = new WeakMap<Polygon, PolygonGeometry>()
  const getGeometry = (polygon: Polygon): PolygonGeometry => {
    let geometry = cache.get(polygon)
    if (!geometry) {
      geometry = {
        box: polygon.box,
        facePoints: [...polygon.faces].map((face) => face.first.start),
        edges: [...polygon.edges].map((edge) => edge.shape),
        edgeIndex: polygon.edges,
      }
      cache.set(polygon, geometry)
    }
    return geometry
  }
  return (a: Polygon, b: Polygon): boolean => {
    if (a.isEmpty() || b.isEmpty()) return false
    const ga = getGeometry(a)
    const gb = getGeometry(b)
    if (
      ga.box.xmin > gb.box.xmax + tolerance ||
      ga.box.xmax < gb.box.xmin - tolerance ||
      ga.box.ymin > gb.box.ymax + tolerance ||
      ga.box.ymax < gb.box.ymin - tolerance
    )
      return false

    // With disjoint boundaries, one point per face determines containment.
    // If boundaries cross elsewhere, the edge tests below detect the contact.
    // Polygon.contains retains the polygon's holes and separate faces.
    if (
      ga.facePoints.some(
        (point) => gb.box.contains(point) && b.contains(point),
      ) ||
      gb.facePoints.some((point) => ga.box.contains(point) && a.contains(point))
    )
      return true

    // Search the larger boundary using the smaller one's edges. Expanded
    // boxes include near contacts; the exact arc/segment distance decides.
    const [small, large] =
      ga.edges.length <= gb.edges.length ? [ga, gb] : [gb, ga]
    for (const edge of small.edges) {
      const box = edge.box
      const queryBox = new Box(
        box.xmin - tolerance,
        box.ymin - tolerance,
        box.xmax + tolerance,
        box.ymax + tolerance,
      )
      // Polygon.edges is already an indexed PlanarSet of PolygonEdge objects.
      // Flatten's generic search declaration returns AnyShape[], so narrow it
      // to the actual element type of this polygon-owned collection.
      const candidates = large.edgeIndex.search(
        queryBox,
      ) as unknown as PolygonEdge[]
      for (const candidate of candidates) {
        if (edge.distanceTo(candidate.shape)[0] <= tolerance) return true
      }
    }
    return false
  }
}
