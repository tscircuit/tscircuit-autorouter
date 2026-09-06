import { expect, test } from "bun:test"
import { isPipeline9HighDensityRouteInsideBounds } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9HighDensityRouteInsideBounds"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { getBoundsFromNodeWithPortPoints } from "lib/utils/getBoundsFromNodeWithPortPoints"

type RoutePoint = HighDensityRoute["route"][number]

test("Pipeline9 preserves only unchanged proven interior points at Repair01's quantized boundary", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "quantized-node",
    center: { x: 0, y: 1.0004 },
    width: 10,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { x: -4, y: 1, z: 0, connectionName: "A" },
      { x: 4, y: 1, z: 0, connectionName: "A" },
    ],
  }
  const bounds = getBoundsFromNodeWithPortPoints(node)
  // Pinned Repair01 materializeRoutes rounds every point after raw clamping,
  // including nonterminal wire points with zero boundary inset.
  const roundedMinY = Math.round(bounds.minY * 1_000) / 1_000
  const original: HighDensityRoute = {
    connectionName: "A",
    rootConnectionName: "A",
    regionId: node.capacityMeshNodeId,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: -4, y: 1, z: 0 },
      { x: -2, y: 1, z: 0 },
      { x: 0, y: roundedMinY, z: 0, traceThickness: 0.1 },
      { x: 2, y: 1, z: 0 },
      { x: 4, y: 1, z: 0 },
    ],
  }
  const originalInputs = structuredClone({ original, node })
  const candidate = structuredClone(original)
  const originalPointByCandidatePoint = new Map<RoutePoint, RoutePoint>(
    candidate.route.map((point, index): [RoutePoint, RoutePoint] => [
      point,
      original.route[index]!,
    ]),
  )
  const provenance = { originalRoute: original, node }
  expect(roundedMinY).toBeLessThan(bounds.minY)
  expect(
    isPipeline9HighDensityRouteInsideBounds(candidate, bounds, 2, provenance),
  ).toBe(false)
  // Another interior point may improve while the rounded boundary point is
  // unchanged. The publication map also remains valid after a detour insert.
  candidate.route[1]!.y = 1.1
  candidate.route.splice(2, 0, { x: -1, y: 0.5, z: 0 })
  expect(
    isPipeline9HighDensityRouteInsideBounds(candidate, bounds, 2, {
      ...provenance,
      originalPointByCandidatePoint,
    }),
  ).toBe(true)
  expect(
    isPipeline9HighDensityRouteInsideBounds(candidate, bounds, 2, {
      ...provenance,
      node: { ...node, capacityMeshNodeId: "synthetic-seam-node" },
      originalPointByCandidatePoint,
    }),
  ).toBe(false)
  // Fresh-error continuation clones this entire graph. Its map values belong
  // to the checkpoint's own original route, not the external incumbent.
  const checkpoint = structuredClone({
    original,
    candidate,
    originalPointByCandidatePoint,
  })
  expect(
    checkpoint.originalPointByCandidatePoint.get(
      checkpoint.candidate.route[3]!,
    ),
  ).toBe(checkpoint.original.route[2])
  expect(checkpoint.original).not.toBe(original)
  expect(
    isPipeline9HighDensityRouteInsideBounds(checkpoint.candidate, bounds, 2, {
      ...provenance,
      originalPointByCandidatePoint: checkpoint.originalPointByCandidatePoint,
    }),
  ).toBe(false)
  expect(
    isPipeline9HighDensityRouteInsideBounds(checkpoint.candidate, bounds, 2, {
      originalRoute: checkpoint.original,
      node,
      originalPointByCandidatePoint: checkpoint.originalPointByCandidatePoint,
    }),
  ).toBe(true)
  const boundaryPoint = candidate.route[3]!
  boundaryPoint.x = 0.001
  expect(
    isPipeline9HighDensityRouteInsideBounds(candidate, bounds, 2, {
      ...provenance,
      originalPointByCandidatePoint,
    }),
  ).toBe(false)
  boundaryPoint.x = 0
  candidate.route[3] = { ...boundaryPoint }
  expect(
    isPipeline9HighDensityRouteInsideBounds(candidate, bounds, 2, {
      ...provenance,
      originalPointByCandidatePoint,
    }),
  ).toBe(false)
  candidate.route[3] = boundaryPoint
  originalPointByCandidatePoint.set(boundaryPoint, {
    ...original.route[2]!,
  })
  expect(
    isPipeline9HighDensityRouteInsideBounds(candidate, bounds, 2, {
      ...provenance,
      originalPointByCandidatePoint,
    }),
  ).toBe(false)

  for (const point of [
    { x: 0, y: -0.01, z: 0 },
    { x: 5.01, y: roundedMinY, z: 0 },
    { x: 0, y: roundedMinY, z: 1 },
    { x: 0, y: roundedMinY, z: 2 },
    { x: 0, y: roundedMinY, z: Number.NaN },
    { x: Number.POSITIVE_INFINITY, y: roundedMinY, z: 0 },
  ]) {
    const invalidOriginal = structuredClone(original)
    invalidOriginal.route[2] = point
    const invalidCandidate = structuredClone(invalidOriginal)
    expect(
      isPipeline9HighDensityRouteInsideBounds(invalidCandidate, bounds, 2, {
        originalRoute: invalidOriginal,
        node,
        originalPointByCandidatePoint: new Map(
          invalidCandidate.route.map(
            (entry, index): [RoutePoint, RoutePoint] => [
              entry,
              invalidOriginal.route[index]!,
            ],
          ),
        ),
      }),
    ).toBe(false)
  }
  // A map never replaces the actual-topology requirement for outer anchors.
  const invalidAnchor = structuredClone(original)
  invalidAnchor.route[0]!.y = roundedMinY
  const anchorCandidate = structuredClone(invalidAnchor)
  expect(
    isPipeline9HighDensityRouteInsideBounds(anchorCandidate, bounds, 2, {
      originalRoute: invalidAnchor,
      node,
      originalPointByCandidatePoint: new Map(
        anchorCandidate.route.map(
          (point, index): [RoutePoint, RoutePoint] => [
            point,
            invalidAnchor.route[index]!,
          ],
        ),
      ),
    }),
  ).toBe(false)
  expect({ original, node }).toEqual(originalInputs)
})
