import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"

test("ordinary three-member bus tuned retains all members within measured skew", () => {
  const input: SimpleRouteJson = {
    bounds: { minX: -8, maxX: 8, minY: -8, maxY: 8 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [3, 4, 5].map((length, index) => ({
      name: `D${index}`,
      pointsToConnect: [
        { x: -3, y: index * 2, layer: "top" },
        { x: -3 + length, y: index * 2, layer: "top" },
      ],
    })),
    buses: [
      {
        busId: "DATA",
        connectionNames: ["D0", "D1", "D2"],
        maxLengthSkew: 0.1,
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.getResult().status).toBe("solved")
  const traces = solver.getOutputSimplifiedPcbTraces()
  const lengths = input.connections.map((connection) => {
    const members = traces.filter(
      (trace) => trace.connection_name === connection.name,
    )
    expect(members).toHaveLength(1)
    return members.reduce(
      (length, trace) =>
        length +
        trace.route.slice(1).reduce((total, point, index) => {
          const previous = trace.route[index]!
          if (
            point.route_type !== "wire" ||
            previous.route_type !== "wire" ||
            point.layer !== previous.layer
          )
            return total
          return total + Math.hypot(point.x - previous.x, point.y - previous.y)
        }, 0),
      0,
    )
  })
  expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(
    0.1 + 1e-9,
  )
  expect(lengths[0]!).toBeGreaterThan(3)
  expect(lengths[1]!).toBeGreaterThan(4)
})
