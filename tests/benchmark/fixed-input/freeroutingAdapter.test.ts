import { expect, test } from "bun:test"
import { createFreeroutingDsn, parseFreeroutingSession } from "../../../scripts/benchmark/fixed-input/freeroutingAdapter"
import { scoreRouting } from "../../../scripts/benchmark/fixed-input/scoreRouting"
import { routingFixture } from "./routingFixture"

test("DSN pads, SES units, paths and layer-spanning vias preserve physical geometry", () => {
  const srj = routingFixture()
  const dsn = createFreeroutingDsn(srj)
  expect(dsn).toContain('(component "pad_1" (place "pad_1" 3000 0 front 0))')
  expect(dsn).toContain('(rect B.Cu -400 -300 400 300)')
  expect(dsn).toContain('(net "signal" (pins pad_0-1 pad_1-1))')
  const session = `(session "fixed_input"
    (routes (resolution um 1000)
      (library_out (padstack benchmark_via
        (shape (circle F.Cu 600000 0 0)) (shape (circle B.Cu 600000 0 0)) (attach off)))
      (network_out (net signal
        (wire (path F.Cu 150000 -3000000 0 0 -2000000))
        (wire (path B.Cu 150000 0 -2000000 3000000 0))
        (via benchmark_via 0 -2000000)))))`
  const traces = parseFreeroutingSession(session, srj)
  const score = scoreRouting(srj, traces)
  expect(traces[0].route[0]).toMatchObject({ x: -3, y: 0, width: 0.15, layer: "top" })
  expect(traces[2].route[0]).toMatchObject({ route_type: "via", x: 0, y: -2, from_layer: "top", to_layer: "bottom", via_diameter: 0.6, via_hole_diameter: 0.3 })
  expect(score.valid).toBe(true)
  expect(score.viaCount).toBe(1)
  expect(score.traceLengthMm).toBeCloseTo(2 * Math.sqrt(13), 6)
  expect(() => parseFreeroutingSession(session.slice(0, -1), srj)).toThrow("Incomplete")
  expect(() => parseFreeroutingSession(session.replace("600000", "700000"), srj)).toThrow("via geometry")
  expect(() => parseFreeroutingSession(session.replace("(net signal", "(net unknown"), srj)).toThrow("Unknown")
  expect(() => createFreeroutingDsn({ ...srj, differentialPairs: [{ connectionNames: ["a", "b"], lengthTolerance: 1 }] })).toThrow("advanced routing")
  const unmapped = structuredClone(srj)
  unmapped.obstacles[0].center.x += 0.1
  expect(() => createFreeroutingDsn(unmapped)).toThrow("exactly one physical pad")
})
