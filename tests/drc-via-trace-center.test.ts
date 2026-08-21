import { expect, test } from "bun:test";
import type { AnyCircuitElement } from "circuit-json";
import { getDrcErrors } from "lib/testing/getDrcErrors";

test("via-trace clearance errors are centered on their exact via", () => {
  const circuitJson: AnyCircuitElement[] = [
    {
      type: "pcb_via",
      pcb_via_id: "via_a",
      x: 0,
      y: 0,
      outer_diameter: 0.2,
      hole_diameter: 0.1,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "trace_a",
      route: [
        { route_type: "wire", x: 0.5, y: -1, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0.5, y: 1, width: 0.1, layer: "top" },
      ],
    },
  ];

  const { errorsWithCenters } = getDrcErrors(circuitJson, {
    traceClearance: 0.4,
    includeTraceContinuity: false,
  });
  const viaTraceError = errorsWithCenters.find(
    (error) => error.type === "pcb_via_trace_clearance_error",
  );

  expect(viaTraceError).toMatchObject({
    pcb_via_id: "via_a",
    pcb_trace_id: "trace_a",
    center: { x: 0, y: 0 },
  });
});
