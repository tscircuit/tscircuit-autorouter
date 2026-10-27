import { expect, test } from "bun:test"
import { createMandatoryPortPointIndex, queryMandatoryPortPointIndex } from "../../lib/solvers/HighDensitySolver/mandatoryPortPointIndex"
import { findSingleTransitionVia, type SingleTransitionBoardContext } from "../../lib/solvers/HighDensitySolver/findSingleTransitionVia"
import type { NodeWithPortPoints, PortPoint } from "../../lib/types/high-density-types"

type Point = { x: number; y: number }
const pointSegmentDistance = (point: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const squared = dx * dx + dy * dy
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared))
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

test("the cohort endpoint index preserves world geometry and rejects copper encountered anywhere on a proposed leg", () => {
  const points: PortPoint[] = [
    { x: -1.25, y: -0.25, z: 0, connectionName: "negative", portPointId: "negative" },
    { x: -1, y: 0, z: 4, connectionName: "edge", portPointId: "edge" },
    { x: 0, y: 0, z: 7, connectionName: "origin", portPointId: "origin" },
    { x: 1, y: 1, z: 2, connectionName: "positive", portPointId: "positive" },
  ]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "cohort", center: { x: 0, y: 0 },
    width: 4, height: 4, portPoints: points }
  const before = JSON.stringify(node)
  const index = createMandatoryPortPointIndex([node, { ...node, capacityMeshNodeId: "duplicate" }])
  expect([...index.buckets.values()].flat()).toHaveLength(4)
  expect(JSON.stringify(node)).toBe(before)
  const cloned = structuredClone(index)
  expect(cloned.buckets instanceof Map).toBe(true)
  for (const x of [-2, -1.25, -1, 0, 1]) {
    for (const y of [-1, -0.25, 0, 1]) {
      const bounds = { minX: x, maxX: x + 1, minY: y, maxY: y + 1 }
      const oracle = points.filter((point) => point.x >= bounds.minX - 1e-9 && point.x <= bounds.maxX + 1e-9 &&
        point.y >= bounds.minY - 1e-9 && point.y <= bounds.maxY + 1e-9).map((point) => point.portPointId).sort()
      expect(queryMandatoryPortPointIndex(index, bounds).map((point) => point.portPointId).sort()).toEqual(oracle)
      expect(queryMandatoryPortPointIndex(cloned, bounds).map((point) => point.portPointId).sort()).toEqual(oracle)
    }
  }
  points[0]!.x = 100
  expect(queryMandatoryPortPointIndex(index, { minX: -1.25, maxX: -1.25, minY: -0.25, maxY: -0.25 })[0]!.x).toBe(-1.25)
  expect(() => createMandatoryPortPointIndex([{ ...node, portPoints: [{ ...points[0]!, x: Number.NaN }] }])).toThrow("Invalid mandatory port geometry")

  const start: PortPoint = { x: -2, y: 0, z: 0, connectionName: "moving" }
  const end: PortPoint = { x: 2, y: 0, z: 1, connectionName: "moving" }
  const legPoint: PortPoint = { x: -1, y: 0, z: 0, connectionName: "fixedForeign" }
  const legIndex = createMandatoryPortPointIndex([{ ...node, portPoints: [legPoint] }])
  const context: SingleTransitionBoardContext = { obstacles: [], layerCount: 8,
    allowBlindAndBuriedVias: false, viaToPadClearance: 0.1, traceToPadClearance: 0.1,
    traceToHoleClearance: 0.2, coordinateScale: 1,
    boardGeometry: { bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 } } }
  const input = { start, end, nominal: { x: 0, y: 0 }, connectionName: "moving",
    center: { x: 0, y: 0 }, traceThickness: 0.1, viaDiameter: 0.3, context }
  expect(findSingleTransitionVia(input)).toEqual(input.nominal)
  const via = findSingleTransitionVia({ ...input, context: { ...context, mandatoryPortPointIndex: legIndex } })
  // The blocker is 1mm from the nominal via, yet lies directly on its start leg.
  expect(via === undefined || pointSegmentDistance(legPoint, start, via) >= 0.2 - 1e-9).toBe(true)
  expect(via === undefined || Math.hypot(via.x - legPoint.x, via.y - legPoint.y) >= 0.3 - 1e-9).toBe(true)
  expect(via).not.toEqual(input.nominal)

  const center = { x: 10, y: 20 }
  const worldPoint = { ...legPoint, x: 9, y: 20 }
  const worldIndex = createMandatoryPortPointIndex([{ ...node, portPoints: [worldPoint] }])
  for (const scale of [0.5, 2]) {
    const scaled = findSingleTransitionVia({ ...input, center,
      start: { ...start, x: center.x - 2 * scale, y: center.y },
      end: { ...end, x: center.x + 2 * scale, y: center.y }, nominal: center,
      context: { ...context, coordinateScale: scale, mandatoryPortPointIndex: structuredClone(worldIndex),
        boardGeometry: { bounds: { minX: 5, maxX: 15, minY: 15, maxY: 25 } } } })
    const worldVia = scaled && { x: center.x + (scaled.x - center.x) / scale, y: center.y + (scaled.y - center.y) / scale }
    expect(worldVia === undefined || pointSegmentDistance(worldPoint, { x: 8, y: 20 }, worldVia) >= 0.2 - 1e-9).toBe(true)
    expect(worldVia === undefined || Math.hypot(worldVia.x - worldPoint.x, worldVia.y - worldPoint.y) >= 0.3 - 1e-9).toBe(true)
  }
  const projected = createMandatoryPortPointIndex([{ ...node,
    portPoints: [{ x: 0, y: 0, z: 7, connectionName: "foreignOtherPlane" }] }])
  const full = findSingleTransitionVia({ ...input, context: { ...context, mandatoryPortPointIndex: projected } })
  expect(full === undefined || Math.hypot(full.x, full.y) >= 0.3 - 1e-9).toBe(true)
  expect(findSingleTransitionVia({ ...input, context: { ...context,
    allowBlindAndBuriedVias: true, mandatoryPortPointIndex: projected } })).toEqual(input.nominal)
  const ownIndex = createMandatoryPortPointIndex([{ ...node,
    portPoints: [{ ...legPoint, connectionName: "moving" }] }])
  expect(findSingleTransitionVia({ ...input, context: { ...context, mandatoryPortPointIndex: ownIndex } })).toEqual(input.nominal)
})
