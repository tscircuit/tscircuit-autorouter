import { expect, test } from "bun:test"
import { getRelativeViaTraceTargets } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getRelativeViaTraceTargets"

test("zero-length, coincident, overlapping, nonfinite, clear, out-of-span and over-cap witnesses produce no targets", () => {
  const base = { site: { x: 0, y: 0.27, diameter: 0.3, layers: ["top", "inner1"] }, start: { x: -1, y: 0 }, end: { x: 1, y: 0 }, wireWidth: 0.1, wireLayer: "top", minimumClearance: 0.1 }
  const cases = [
    { ...base, end: base.start },
    { ...base, site: { ...base.site, y: 0 } },
    { ...base, site: { ...base.site, y: 0.19 } },
    { ...base, site: { ...base.site, x: NaN } },
    { ...base, wireWidth: Infinity },
    { ...base, start: { x: 1e300, y: 0 } },
    { ...base, site: { ...base.site, y: 0.5 } },
    { ...base, wireLayer: "bottom" },
    { ...base, minimumClearance: 0.5 },
    { ...base, minimumClearance: -1 },
  ]
  for (const value of cases) expect(getRelativeViaTraceTargets(value)).toEqual([])
})
