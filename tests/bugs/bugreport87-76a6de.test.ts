import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph as AutoroutingPipelineSolver } from "lib"
import bugReport from "../../fixtures/bug-reports/bugreport87-76a6de/bugreport87-76a6de.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { distance, segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { isPointInRect } from "lib/utils/isPointInRect"
import { getTerminalLayerIndicesByPcbPortId } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getTerminalLayerIndicesByPcbPortId"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { combinePreloadedAndRoutedTraces } from "lib/testing/evaluate-relaxed-drc"

const GEOMETRY_TOLERANCE = 1e-4

const srj = bugReport.simple_route_json as SimpleRouteJson

test(
  "bugreport87-76a6de.json",
  () => {
    const solver = new AutoroutingPipelineSolver(srj)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    const routedTraces = solver.getOutputSimplifiedPcbTraces()
    expect(routedTraces).toHaveLength(52)
    if (!srj.traces) throw new Error("Expected the existing board copper")
    expect(srj.traces).toHaveLength(96)
    const traces = combinePreloadedAndRoutedTraces(srj.traces, routedTraces)
    const terminalLayersByPortId = getTerminalLayerIndicesByPcbPortId(
      srj.connections,
      srj.obstacles,
      srj.layerCount,
    )
    for (const connection of srj.connections) {
      if (connection.pointsToConnect.length < 2) continue
      const connectedTraces = traces.filter((trace) =>
        solver.connMap.areIdsConnected(connection.name, trace.connection_name),
      )
      expect(connectedTraces.length).toBeGreaterThan(0)
      for (const point of connection.pointsToConnect) {
        if (!point.pcb_port_id) throw new Error("Expected a PCB port terminal")
        const terminalLayers = terminalLayersByPortId.get(point.pcb_port_id)
        if (!terminalLayers)
          throw new Error("Expected the terminal copper layers")
        const terminalPads = srj.obstacles.filter(
          (pad) => !pad.isCopperPour && isPointInRect(point, pad),
        )
        expect(
          connectedTraces.some((trace) =>
            trace.route.some((segment, index) => {
              if (segment.route_type !== "wire") return false
              if (
                !terminalLayers.has(
                  mapLayerNameToZ(segment.layer, srj.layerCount),
                )
              )
                return false
              if (distance(segment, point) < GEOMETRY_TOLERANCE) return true
              const previous = trace.route[index - 1]
              if (
                !previous ||
                previous.route_type !== "wire" ||
                previous.layer !== segment.layer
              )
                return false
              return terminalPads.some(
                (pad) =>
                  pad.layers.includes(segment.layer) &&
                  segmentToBoxMinDistance(previous, segment, pad) <=
                    Math.min(previous.width, segment.width) / 2 +
                      GEOMETRY_TOLERANCE,
              )
            }),
          ),
        ).toBe(true)
      }
    }
  },
  { timeout: 300_000 },
)
