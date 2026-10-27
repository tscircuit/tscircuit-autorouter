import { expect, test } from "bun:test"
import { Pipeline9StraightCellCertifier } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/certifyPipeline9StraightCell"
import { createOrderedPortalFixture } from "./orderedPortalFixture"

test("finite-width witness rejects angled outgoing copper even when portal pitch is large enough", (): void => {
  const node = createOrderedPortalFixture()[0]!
  node.portPointsInPairs = node.portPointsInPairs!.map((pair, index) => pair.map((point) => ({ ...point,
    y: (point.x === 0 ? -0.4 : 0.4) + index * 0.3,
  })) as typeof pair)
  node.portPoints = node.portPointsInPairs.flat()
  const certifier = new Pipeline9StraightCellCertifier({ obstacles: [], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.15 })
  expect(0.3).toBeGreaterThan(0.1 + 0.15)
  expect(0.3 / Math.hypot(1, 0.8)).toBeLessThan(0.1 + 0.15)
  expect(certifier.certify(node, new Map())).toEqual({ certified: false, reason: "copper" })
  for (const [index, pair] of node.portPointsInPairs.entries()) for (const point of pair) point.y = index === 0 ? -0.4 : 0.4
  const certificate = certifier.certify(node, new Map())
  expect(certificate.certified).toBe(true)
  if (!certificate.certified) throw new Error("Expected constructive straight witness")
  expect(certificate.routes).toHaveLength(2)
  for (const route of certificate.routes) {
    expect(route.route).toHaveLength(2)
    expect(route.vias).toHaveLength(0)
    expect(route.traceThickness).toBe(0.1)
  }
})
