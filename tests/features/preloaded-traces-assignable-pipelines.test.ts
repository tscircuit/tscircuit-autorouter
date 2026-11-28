import { expect, test } from "bun:test"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import { AssignableAutoroutingPipeline3 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline3/AssignableAutoroutingPipeline3"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

const baseBlockedPreloadedTraceSrj: SimpleRouteJson = {
  layerCount: 1,
  minTraceWidth: 0.15,
  bounds: {
    minX: -6,
    maxX: 6,
    minY: -5,
    maxY: 5,
  },
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: { x: -4, y: 0 },
      width: 0.8,
      height: 0.8,
      connectedTo: ["pcb_port_a1", "net_a"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 4, y: 0 },
      width: 0.8,
      height: 0.8,
      connectedTo: ["pcb_port_a2", "net_a"],
    },
  ],
  connections: [
    {
      name: "net_a",
      pointsToConnect: [
        { x: -4, y: 0, layer: "top", pcb_port_id: "pcb_port_a1" },
        { x: 4, y: 0, layer: "top", pcb_port_id: "pcb_port_a2" },
      ],
    },
  ],
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "preloaded_blocker",
      connection_name: "net_blocker",
      connectsTo: ["net_blocker"],
      route: [
        { route_type: "wire", x: -0.6, y: -2.2, width: 0.25, layer: "top" },
        { route_type: "wire", x: 0, y: -1.6, width: 0.25, layer: "top" },
        { route_type: "wire", x: 0, y: 2, width: 0.25, layer: "top" },
      ],
    },
  ],
}

const getMinSameLayerClearance = (
  routedTrace: SimplifiedPcbTrace,
  blockerTrace: SimplifiedPcbTrace,
): number => {
  let minEdgeGap = Number.POSITIVE_INFINITY
  for (let i = 0; i < routedTrace.route.length - 1; i++) {
    const startA = routedTrace.route[i]!
    const endA = routedTrace.route[i + 1]!
    if (startA.route_type !== "wire" || endA.route_type !== "wire") continue
    if (startA.layer !== endA.layer) continue

    for (let j = 0; j < blockerTrace.route.length - 1; j++) {
      const startB = blockerTrace.route[j]!
      const endB = blockerTrace.route[j + 1]!
      if (startB.route_type !== "wire" || endB.route_type !== "wire") continue
      if (startB.layer !== endB.layer || startA.layer !== startB.layer) continue

      const centerDist = segmentToSegmentMinDistance(startA, endA, startB, endB)
      const edgeGap = centerDist - (startA.width + startB.width) / 2
      if (edgeGap < minEdgeGap) minEdgeGap = edgeGap
    }
  }
  return minEdgeGap
}

test(
  "assignable pipelines convert preloaded SRJ traces to obstacles without mutating input",
  () => {
    const pipelines = [
      AssignableAutoroutingPipeline1Solver,
      AssignableAutoroutingPipeline2,
      AssignableAutoroutingPipeline3,
    ] as const

    let pipeline2Svg = ""

    for (const PipelineClass of pipelines) {
      const srj = structuredClone(baseBlockedPreloadedTraceSrj)
      const snapshotInput = structuredClone(srj)

      const solver = new PipelineClass(srj)
      solver.solve()

      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      expect(srj).toEqual(snapshotInput)
      expect(solver.getConstructorParams()[0]).toBe(srj)

      const outputSrj = solver.getOutputSimpleRouteJson()
      expect(outputSrj.obstacles).toEqual(snapshotInput.obstacles)
      expect(outputSrj.traces).toHaveLength(1)
      expect(
        getMinSameLayerClearance(
          outputSrj.traces![0]!,
          snapshotInput.traces![0]!,
        ),
      ).toBeGreaterThan(0)

      if (solver instanceof AssignableAutoroutingPipeline2) {
        pipeline2Svg = getLastStepSvg(solver.visualize())
      }
    }

    expect(pipeline2Svg).toMatchSvgSnapshot(import.meta.path)
  },
  { timeout: 30_000 },
)
