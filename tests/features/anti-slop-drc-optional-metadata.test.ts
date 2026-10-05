import { expect, test } from "bun:test"
import {
  addAutoroutingViaTraceIds,
  remapDrcTraceIds,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"

test("explicit DRC metadata preserves cloning, identity, optional keys and property order", () => {
  const metadata = { diagnostic: "retain" }
  const unchanged = { pcb_trace_id: "fixed", metadata }
  expect(remapDrcTraceIds([unchanged], new Map())[0]).toBe(unchanged)
  const [noVia] = addAutoroutingViaTraceIds({
    errors: [unchanged],
    circuitJson: [],
    evaluatedTraceIds: new Set(),
  })
  expect(noVia).not.toBe(unchanged)
  expect(Object.keys(noVia!)).toEqual(["pcb_trace_id", "metadata"])
  expect(noVia!.metadata).toBe(metadata)

  const input = {
    pcb_trace_ids: ["eval-a", "eval-b"],
    metadata,
    pcb_trace_id: "eval-a",
    pcb_trace_error_id: "overlap_eval-a_eval-b",
  }
  const [collapsed] = remapDrcTraceIds(
    [input],
    new Map([
      ["eval-a", "solver"],
      ["eval-b", "solver"],
    ]),
  )
  expect(Object.keys(collapsed!)).toEqual([
    "pcb_trace_ids",
    "metadata",
    "pcb_trace_id",
    "pcb_trace_error_id",
    "__collapsed_trace_participants",
  ])
  expect(collapsed!.metadata).toBe(metadata)
  expect(collapsed!.pcb_trace_ids).toEqual(["solver", "solver"])
  expect(collapsed!.__collapsed_trace_participants).toEqual([
    { solverTraceId: "solver", evaluationTraceIds: ["eval-a", "eval-b"] },
  ])
  expect(input.pcb_trace_ids).toEqual(["eval-a", "eval-b"])
  expect(Object.hasOwn(input, "__collapsed_trace_participants")).toBe(false)

  const [enriched] = addAutoroutingViaTraceIds({
    errors: [
      { pcb_via_ids: ["via_1", "via_1"], metadata, pcb_trace_id: "solver" },
    ],
    circuitJson: [],
    evaluatedTraceIds: new Set(),
  })
  expect(Object.keys(enriched!)).toEqual([
    "pcb_via_ids",
    "metadata",
    "pcb_trace_id",
    "pcb_via_id",
    "pcb_trace_ids",
  ])
  expect(enriched!.metadata).toBe(metadata)
  expect(enriched!.pcb_via_ids).toEqual(["via_1"])
  expect(enriched!.pcb_trace_ids).toEqual(["solver"])
})
