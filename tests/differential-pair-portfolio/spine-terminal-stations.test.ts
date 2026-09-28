import { expect, test } from "bun:test"
import { prepareSpineTerminals } from "../../scripts/differential-pair-portfolio/prepareSpineTerminals"
import { parseSimplifiedPcbTrace } from "../../node_modules/@tscircuit/length-matching-solver/lib/post-processing/model/parseSimplifiedPcbTrace"

test("resolves non-midpoint escape stations within the terminal budget", (): void => {
  const traces = [0, 1].map((i) =>
    parseSimplifiedPcbTrace(
      {
        type: "pcb_trace",
        pcb_trace_id: `t${i}`,
        connection_name: `net${i}`,
        route: [
          { route_type: "wire", x: 0, y: i, width: 0.1, layer: "top" },
          { route_type: "wire", x: 10, y: i, width: 0.1, layer: "top" },
        ],
      },
      2,
    ),
  )
  const input = {
    first: traces[0]!,
    second: traces[1]!,
    reverseSecond: false,
    context: {
      immutableTraces: [],
      obstacles: [],
      bounds: { minX: -1, maxX: 11, minY: -1, maxY: 2 },
      layerCount: 2,
    },
    centerlineSpacing: 0.3,
    maxUncoupledLength: 1,
  }
  const result = prepareSpineTerminals(input)
  expect(result.status).toBe("ready")
  if (result.status !== "ready") throw new Error(result.reason)
  expect(result.start.x).toBeGreaterThan(0)
  expect(result.end.x).toBeLessThan(10)
  expect(result.side).toBe(-1)
  expect(Math.hypot(result.start.x, result.start.y - 0.15)).toBeLessThanOrEqual(
    1,
  )
  expect(
    prepareSpineTerminals({ ...input, maxUncoupledLength: 0.1 }).status,
  ).toBe("rejected")
})
