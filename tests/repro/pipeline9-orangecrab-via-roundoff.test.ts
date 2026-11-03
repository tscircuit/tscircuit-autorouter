import { beforeAll, expect, test } from "bun:test"
import { PcbConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  renderOrangeCrabDdr,
  type OrangeCrabDdrRender,
} from "tests/fixtures/renderOrangeCrabDdr"

let rendered: OrangeCrabDdrRender

beforeAll(async (): Promise<void> => {
  rendered = await renderOrangeCrabDdr()
  // Keep snapshot errors outside test.failing so they always fail CI.
  await expect(rendered.svg).toMatchSvgSnapshot(import.meta.path)
})

function verifyNativeOrangeCrabRouting(): void {
  expect(rendered.solved).toBe(true)
  expect(rendered.failed).toBe(false)
  expect(rendered.routingErrors).toEqual([])
  const json = rendered.circuitJson
  const traces = json.filter((element) => element.type === "pcb_trace")
  const sourceTraces = json.filter((element) => element.type === "source_trace")
  const ports = new Map(
    json
      .filter((element) => element.type === "pcb_port")
      .map((port) => [port.source_port_id, port.pcb_port_id]),
  )
  const connectivity = new PcbConnectivityMap(json)
  expect(sourceTraces).toHaveLength(50)
  expect(traces).toHaveLength(52)
  expect(json.filter((element) => element.type === "pcb_smtpad")).toHaveLength(
    385,
  )
  for (const trace of sourceTraces) {
    const pcbPorts = trace.connected_source_port_ids.map(
      (port) => ports.get(port)!,
    )
    expect(connectivity.connMap.areAllIdsConnected(pcbPorts)).toBe(true)
  }
  expect(rendered.completedDataTraces).toHaveLength(16)
  for (const trace of rendered.completedDataTraces) {
    const pcbTrace = traces.find(
      (pcb) => pcb.pcb_trace_id === trace.pcb_trace_id,
    )
    expect(pcbTrace?.route).toMatchObject(
      trace.route.map((point) => {
        if (point.route_type !== "via") return point
        const { layers: _layers, ...via } = point
        return via
      }),
    )
  }
  // This proves routing completion, not manufacturing readiness. Preserve the
  // independently measured limitations instead of calling this DRC-clean.
  const findingCounts: Record<string, number> = {}
  for (const finding of rendered.physicalErrors) {
    findingCounts[finding.type] = (findingCounts[finding.type] ?? 0) + 1
  }
  expect(findingCounts).toEqual({
    pcb_trace_error: 6,
    pcb_pad_trace_clearance_error: 5,
    pcb_via_trace_clearance_error: 6,
    pcb_pad_pad_clearance_error: 9,
    pcb_via_clearance_error: 1,
  })
}

test(
  "native OrangeCrab completes all 50 DDR nets without losing via anchors",
  verifyNativeOrangeCrabRouting,
)
