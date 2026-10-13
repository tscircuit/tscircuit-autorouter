import { expect, test } from "bun:test"
import { rebuildPreloadedTraceFromSections } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimplifiedPcbTrace } from "lib/types"

test("Joint preserves exact unchanged preload identity and marks changed copper", () => {
  const original: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "fixed-copper",
    connection_name: "own-net",
    connectsTo: ["start-port", "end-port"],
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.15, layer: "bottom" },
      { route_type: "wire", x: 1, y: 0.5, width: 0.15, layer: "bottom" },
      { route_type: "wire", x: 2, y: 0, width: 0.15, layer: "bottom" },
    ],
  }
  const before = structuredClone(original)
  const rebuild = (
    source: SimplifiedPcbTrace,
    route: SimplifiedPcbTrace["route"],
  ): SimplifiedPcbTrace =>
    rebuildPreloadedTraceFromSections({
      originalTrace: source,
      repairedSections: [
        { routePositionStart: 0, routePositionEnd: 2, route },
      ],
    })

  const unchanged = rebuild(original, structuredClone(original.route))
  expect(unchanged).toBe(original)
  expect(unchanged).toEqual(before)
  expect(unchanged).not.toHaveProperty("__replaces_pcb_trace_id")

  const previouslyMutated = {
    ...original,
    __replaces_pcb_trace_id: "prior-fixed-owner",
  }
  expect(
    rebuild(previouslyMutated, structuredClone(previouslyMutated.route)),
  ).toBe(previouslyMutated)
  expect(previouslyMutated.__replaces_pcb_trace_id).toBe("prior-fixed-owner")

  const changedRoute = structuredClone(original.route)
  const middle = changedRoute[1]!
  if (middle.route_type !== "wire") throw new Error("Expected middle wire")
  middle.y += 1e-12
  const changed = rebuild(original, changedRoute)
  expect(changed).not.toBe(original)
  expect(changed.__replaces_pcb_trace_id).toBe(original.pcb_trace_id)
  expect(changed.route).toEqual(changedRoute)
  expect(changed.route[0]).toEqual(original.route[0])
  expect(changed.route.at(-1)).toEqual(original.route.at(-1))
  expect(changed.connection_name).toBe(original.connection_name)
  expect(changed.connectsTo).toEqual(original.connectsTo)

  const changedWidth = structuredClone(original.route)
  const widthPoint = changedWidth[1]!
  if (widthPoint.route_type !== "wire") throw new Error("Expected middle wire")
  widthPoint.width = 0.2
  expect(rebuild(original, changedWidth).route).toEqual(changedWidth)
  expect(rebuild(original, changedWidth).__replaces_pcb_trace_id).toBe(
    original.pcb_trace_id,
  )
  expect(original).toEqual(before)
})
