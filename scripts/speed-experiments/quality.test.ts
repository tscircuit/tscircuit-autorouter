import { expect, test } from "bun:test"
import { evaluateNodeQuality, type NodeQualityInput } from "./quality"

test("node diagnostics distinguish complete geometry from width, endpoint, crossing, and via defects", (): void => {
  const a = { x: -1, y: 0, z: 0, connectionName: "a" }
  const b = { x: 1, y: 0, z: 0, connectionName: "a" }
  const input: NodeQualityInput = {
    node: { center: { x: 0, y: 0 }, width: 4, height: 4, portPointsInPairs: [[a, b]] },
    routes: [{ connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3,
      route: [a, b], vias: [] }],
    traceWidth: 0.1, viaDiameter: 0.3, layerCount: 2, solved: true, failed: false,
  }
  const complete = evaluateNodeQuality(input)
  expect(complete.structuralChecksPassed).toBe(true)
  expect(complete.matchedPairCount).toBe(1)
  expect(complete.traceLengthMm).toBe(2)
  const reverse = structuredClone(input)
  reverse.routes[0].route.reverse()
  expect(evaluateNodeQuality(reverse).structuralChecksPassed).toBe(true)
  const narrow = structuredClone(input)
  narrow.routes[0].traceThickness = 0.025
  expect(evaluateNodeQuality(narrow).traceWidthsPreserved).toBe(false)
  expect(evaluateNodeQuality(narrow).geometryFingerprint).not.toBe(complete.geometryFingerprint)
  const missing = structuredClone(input)
  missing.routes[0].route[1] = { ...missing.routes[0].route[1], x: 0.8 }
  expect(evaluateNodeQuality(missing).matchedPairCount).toBe(0)
  const crossing = structuredClone(input)
  const c = { x: 0, y: -1, z: 0, connectionName: "b" }
  const d = { x: 0, y: 1, z: 0, connectionName: "b" }
  crossing.node.portPointsInPairs!.push([c, d])
  crossing.routes.push({ connectionName: "b", traceThickness: 0.1, viaDiameter: 0.3,
    route: [c, d], vias: [] })
  expect(evaluateNodeQuality(crossing).structuralChecksPassed).toBe(true)
  expect(evaluateNodeQuality(crossing).localCopperDiagnostics.tracePairCopperOverlaps).toBe(1)
  expect(evaluateNodeQuality(crossing).localCopperDiagnostics.minTraceEdgeGapMm).toBe(-0.1)
  const noVia = structuredClone(input)
  noVia.routes[0].route.splice(1, 0, { x: -1, y: 0, z: 1 }, { x: 1, y: 0, z: 1 })
  expect(evaluateNodeQuality(noVia).missingViaTransitionCount).toBe(2)
  noVia.routes[0].vias.push({ x: -1, y: 0 }, { x: 1, y: 0 })
  expect(evaluateNodeQuality(noVia).structuralChecksPassed).toBe(true)
})
