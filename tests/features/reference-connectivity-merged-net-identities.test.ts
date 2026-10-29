import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"

test("reference connectivity preserves net identities when a late source trace joins existing nets", (): void => {
  const circuitJson: AnyCircuitElement[] = [
    {
      type: "source_trace",
      source_trace_id: "source_trace_left",
      connected_source_port_ids: ["left_a", "left_b"],
      connected_source_net_ids: [],
    },
    {
      type: "source_trace",
      source_trace_id: "source_trace_right",
      connected_source_port_ids: ["right_a", "right_b"],
      connected_source_net_ids: [],
    },
    {
      type: "source_trace",
      source_trace_id: "source_trace_independent",
      connected_source_port_ids: ["independent_a", "independent_b"],
      connected_source_net_ids: [],
    },
    {
      type: "source_trace",
      source_trace_id: "source_trace_bridge",
      connected_source_port_ids: ["right_b", "left_a", "right_b"],
      connected_source_net_ids: [],
    },
  ]
  const original = structuredClone(circuitJson)
  const connectivity = getFullConnectivityMapFromCircuitJson(circuitJson)

  expect(Object.keys(connectivity.netMap)).toEqual([
    "connectivity_net6",
    "connectivity_net9",
  ])
  expect(connectivity.getIdsConnectedToNet("connectivity_net9")).toEqual([
    "source_trace_bridge",
    "source_trace_right",
    "right_a",
    "right_b",
    "source_trace_left",
    "left_a",
    "left_b",
  ])
  expect(connectivity.areAllIdsConnected(["left_b", "right_a"])).toBeTrue()
  expect(connectivity.areIdsConnected("left_a", "independent_a")).toBeFalse()
  expect(connectivity.getNetConnectedToId("left_b")).toBe("connectivity_net9")
  expect(connectivity.getNetConnectedToId("independent_b")).toBe(
    "connectivity_net6",
  )
  expect(circuitJson).toEqual(original)
})
