import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { isPipeline9JointDrcOutputNoWorse } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9JointDrcOutputNoWorse"

test("Pipeline9 matches residual vias by physical site", () => {
  const makeCircuit = (
    firstId: string,
    secondId: string,
    firstX = 0,
    firstOwner = "ordinary",
  ): AnyCircuitElement[] =>
    [
      { type: "pcb_trace", pcb_trace_id: "ordinary" },
      { type: "pcb_trace", pcb_trace_id: "other" },
      {
        type: "pcb_via",
        pcb_via_id: firstId,
        pcb_trace_id: firstOwner,
        x: firstX,
        y: 0,
        layers: ["top", "bottom"],
      },
      {
        type: "pcb_via",
        pcb_via_id: secondId,
        pcb_trace_id: "other",
        x: 0.25,
        y: 0,
        layers: ["bottom", "top"],
      },
    ] as AnyCircuitElement[]
  const currentError = {
    type: "pcb_via_clearance_error",
    pcb_error_id: "different_net_vias_close_via_0_via_1",
    pcb_via_ids: ["via_0", "via_1"],
    minimum_clearance: 0.1,
    actual_clearance: 0.03,
  }
  const reindexedError = {
    ...currentError,
    pcb_error_id: "different_net_vias_close_via_12_via_7",
    pcb_via_ids: ["via_7", "via_12"],
  }
  const current = {
    errors: [currentError],
    circuitJson: makeCircuit("via_0", "via_1"),
  }
  const reindexedCircuit = makeCircuit("via_12", "via_7").reverse()
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current,
      candidate: { errors: [reindexedError], circuitJson: reindexedCircuit },
    }),
  ).toBe(true)
  for (const circuitJson of [
    makeCircuit("via_12", "via_7", 0.02),
    makeCircuit("via_12", "via_7", 0, "other"),
  ]) {
    expect(
      isPipeline9JointDrcOutputNoWorse({
        current,
        candidate: {
          errors: [{ ...reindexedError, actual_clearance: 0.08 }],
          circuitJson,
        },
      }),
    ).toBe(false)
  }
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current,
      candidate: {
        errors: [],
        circuitJson: makeCircuit("via_12", "via_7", -1),
      },
    }),
  ).toBe(true)
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current,
      candidate: {
        errors: [{ ...reindexedError, actual_clearance: 0.02 }],
        circuitJson: reindexedCircuit,
      },
    }),
  ).toBe(false)
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current,
      candidate: {
        errors: [{ ...reindexedError, minimum_clearance: 0.2 }],
        circuitJson: reindexedCircuit,
      },
    }),
  ).toBe(false)
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current,
      candidate: {
        errors: [{ ...reindexedError, pcb_error_id: "opaque-diagnostic" }],
        circuitJson: reindexedCircuit,
      },
    }),
  ).toBe(true)

  const traceViaContact = {
    type: "pcb_trace_error",
    pcb_trace_id: "other",
    pcb_trace_error_id: "overlap_other_via_0",
    message:
      'PCB trace other overlaps with pcb_via "via_0" (accidental contact)',
  }
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current: { ...current, errors: [traceViaContact] },
      candidate: {
        errors: [
          {
            type: "pcb_via_trace_clearance_error",
            pcb_via_trace_clearance_error_id:
              "via_trace_clearance_via_12_other",
            pcb_via_id: "via_12",
            pcb_trace_id: "other",
            actual_clearance: 0.04,
            minimum_clearance: 0.1,
          },
        ],
        circuitJson: reindexedCircuit,
      },
    }),
  ).toBe(false)
  expect(
    isPipeline9JointDrcOutputNoWorse({
      current: { ...current, errors: [traceViaContact] },
      candidate: {
        errors: [
          {
            ...traceViaContact,
            pcb_trace_id: "ordinary",
            pcb_trace_error_id: "overlap_ordinary_via_7",
          },
        ],
        circuitJson: reindexedCircuit,
      },
    }),
  ).toBe(false)
  expect(() =>
    isPipeline9JointDrcOutputNoWorse({
      current,
      candidate: {
        errors: [reindexedError],
        circuitJson: reindexedCircuit.filter(
          (element) => element.type !== "pcb_via",
        ),
      },
    }),
  ).toThrow("cannot resolve copper participant")
})
