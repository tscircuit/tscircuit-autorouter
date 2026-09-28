import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9LengthMatchingPreloadedInput } from "../fixtures/createPipeline9LengthMatchingPreloadedInput"

test("Pipeline9 early length matching preserves every multipoint bus terminal and requested width", (): void => {
  const input = createPipeline9LengthMatchingPreloadedInput(1)
  input.buses![0]!.traceWidth = 0.3
  input.bounds.maxX = 26
  for (const connection of input.connections) {
    const end = connection.pointsToConnect[1]!
    end.x += 12
    const endPad = input.obstacles.find((obstacle): boolean =>
      obstacle.connectedTo.includes(end.pcb_port_id!),
    )!
    endPad.center.x = end.x
  }
  for (const connection of input.connections) {
    const start = connection.pointsToConnect[0]!
    const end = connection.pointsToConnect[1]!
    const middle = {
      x: (start.x + end.x) / 2,
      y: start.y,
      layer: "top",
      pcb_port_id: `${connection.name}_middle`,
    }
    connection.pointsToConnect.splice(1, 0, middle)
    input.obstacles.push({
      type: "rect",
      center: { x: middle.x, y: middle.y },
      width: 0.2,
      height: 0.2,
      layers: ["top"],
      connectedTo: [middle.pcb_port_id],
      circuitJsonMetadata: {
        pcb_port_id: middle.pcb_port_id,
        pcb_smtpad_id: `pad_${middle.pcb_port_id}`,
      },
    })
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const routes = solver._getOutputHdRoutes()
  const lengths = input.connections.map((connection): number => {
    const memberRoutes = routes.filter(
      (route): boolean =>
        (route.rootConnectionName ?? route.connectionName) === connection.name,
    )
    expect(memberRoutes.length).toBeGreaterThan(0)
    for (const terminal of connection.pointsToConnect) {
      expect(
        memberRoutes.some((route): boolean =>
          route.route.some(
            (point): boolean =>
              Math.hypot(point.x - terminal.x, point.y - terminal.y) < 1e-6,
          ),
        ),
      ).toBe(true)
    }
    return memberRoutes.reduce(
      (length, route): number =>
        length +
        route.route.slice(1).reduce((routeLength, point, index): number => {
          const previous = route.route[index]!
          return (
            routeLength + Math.hypot(point.x - previous.x, point.y - previous.y)
          )
        }, 0),
      0,
    )
  })
  expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(0.1 + 1e-6)
  const wireWidths = new Set(
    solver
      .getOutputSimplifiedPcbTraces()
      .flatMap((trace): number[] =>
        trace.route.flatMap((point): number[] =>
          point.route_type === "wire" ? [point.width] : [],
        ),
      ),
  )
  // The 0.2mm pads require terminal neckdowns below the requested bus width.
  expect(Math.max(...wireWidths)).toBe(0.3)
  expect(Math.min(...wireWidths)).toBeGreaterThan(0)
})
