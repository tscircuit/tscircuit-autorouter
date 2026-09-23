import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 length matching preserves preloaded copper or reports no solution", (): void => {
  for (const preloadedY of [0.3, 1]) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: -2, maxX: 14, minY: -4, maxY: 5 },
      obstacles: [],
      connections: [
        {
          name: "a",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 10, y: 0, layer: "top" },
          ],
        },
        {
          name: "b",
          pointsToConnect: [
            { x: 0, y: 3, layer: "top" },
            { x: 12, y: 3, layer: "top" },
          ],
        },
      ],
      traces: [{
        type: "pcb_trace",
        pcb_trace_id: "fixed",
        connection_name: "fixednet",
        connectsTo: ["fixed_start", "fixed_end"],
        route: [
          { route_type: "wire", x: 1, y: preloadedY, width: 0.15, layer: "top" },
          { route_type: "wire", x: 9, y: preloadedY, width: 0.15, layer: "top" },
        ],
      }],
      buses: [{ busId: "bus", connectionNames: ["a", "b"], maxLengthSkew: 0.1 }],
    }
    for (const connection of srj.connections) {
      for (const [index, point] of connection.pointsToConnect.entries()) {
        point.pcb_port_id = `${connection.name}_${index}`
        srj.obstacles.push({
          type: "rect",
          center: { x: point.x, y: point.y },
          width: 0.2,
          height: 0.2,
          layers: ["top"],
          connectedTo: [point.pcb_port_id],
          circuitJsonMetadata: {
            pcb_port_id: point.pcb_port_id,
            pcb_smtpad_id: `pad_${point.pcb_port_id}`,
          },
        })
      }
    }
    for (const [index, x] of [1, 9].entries()) {
      const pcbPortId = index === 0 ? "fixed_start" : "fixed_end"
      srj.obstacles.push({
        type: "rect",
        center: { x, y: preloadedY },
        width: 0.2,
        height: 0.2,
        layers: ["top"],
        connectedTo: [pcbPortId, "fixednet"],
        circuitJsonMetadata: {
          pcb_port_id: pcbPortId,
          pcb_smtpad_id: `pad_${pcbPortId}`,
        },
      })
    }
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      cacheProvider: null,
    })
    solver.solveUntilPhase("lengthMatchingPostProcessingSolver")
    const before = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getNewTracesBeforePowerExpansion(),
    })
    expect(before.errors).toHaveLength(0)
    if (preloadedY === 0.3) {
      expect(() => solver.solve()).toThrow("exhausted all segment/tooth combinations")
      expect(solver.failed).toBe(true)
      expect(solver.solved).toBe(false)
      expect(() => solver.getOutputSimplifiedPcbTraces()).toThrow("Cannot get output")
      continue
    }
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const after = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    })
    expect(after.errors).toHaveLength(0)
    expect(solver.getOutputSimpleRouteJson().traces?.find(
      (trace): boolean => trace.pcb_trace_id === "fixed",
    )).toEqual(srj.traces![0])
    const lengths: number[] = solver._getOutputHdRoutes().map((route): number =>
      route.route.slice(1).reduce((length, point, index): number => {
        const previous = route.route[index]!
        return length + Math.hypot(point.x - previous.x, point.y - previous.y)
      }, 0),
    )
    expect(lengths).toHaveLength(2)
    expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(0.1 + 1e-6)
  }
})
