import { expect, test } from "bun:test"
import { pinPipeline9PreloadedSectionEndpoints } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pinPipeline9PreloadedSectionEndpoints"
import { createPreloadedSeamFixture } from "../fixtures/pipeline9-preloaded-seam-fixture"

test("an off-cell seam clips only the same original wire and retains its exact owned span", (): void => {
  const fixture = createPreloadedSeamFixture(true)
  const pinned = pinPipeline9PreloadedSectionEndpoints(fixture)
  expect(pinned.ownedConnectors).toHaveLength(1)
  const connector = pinned.ownedConnectors[0]!
  expect(connector.route[0]).toEqual({ ...fixture.witnesses[0]!.point, traceThickness: 0.1 })
  expect(connector.route[1]).toEqual({ x: 0, y: 0, z: 0, traceThickness: 0.1 })
  expect(connector.traceThickness).toBe(0.1)
  expect(connector.connectionName).toBe(fixture.sections[0]!.connectionName)
  expect(connector.rootConnectionName).toBe(fixture.witnesses[0]!.rootConnectionName)
  expect(connector.vias).toEqual([])
  expect(connector).toMatchObject({ originalPreloadedSpan: {
    traceId: "physical", wireRouteIndex: 0, startFraction: 0.505, endFraction: 0.5, width: 0.1,
  } })
  // Equal width and a subinterval of the very same centerline prove swept
  // capsule containment; merely touching its centerline would not.
  for (const point of connector.route) {
    expect(point.x).toBe(point.y)
    expect(point.x).toBeGreaterThanOrEqual(-2)
    expect(point.x).toBeLessThanOrEqual(2)
  }
  expect(pinned.nodes[0]!.portPoints[0]).toMatchObject({ x: 0, y: 0, z: 0 })
  expect(pinned.nodes[0]!.portPointsInPairs![0]![0]).toMatchObject({ x: 0, y: 0, z: 0 })
  const invalid = createPreloadedSeamFixture(true)
  invalid.nodes[0]!.center.y = 10
  invalid.witnesses[0]!.sourcePortPoint.y = 10
  invalid.witnesses[1]!.sourcePortPoint.y = 10
  expect(() => pinPipeline9PreloadedSectionEndpoints(invalid)).toThrow("original span misses incident domain")
})
