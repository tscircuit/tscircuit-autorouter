import type { SimplifiedPcbTrace } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

/** Signal-layer restrictions apply to wires, not a through via's drilled span. */
export function getPipeline9WireLayerErrors({
  traces,
  allowedZByConnectionName,
  layerCount,
}: {
  traces: SimplifiedPcbTrace[]
  allowedZByConnectionName: ReadonlyMap<string, readonly number[]>
  layerCount: number
}): Record<string, unknown>[] {
  const errors: Record<string, unknown>[] = []
  if (allowedZByConnectionName.size === 0) return errors
  for (const trace of traces) {
    const allowedZ = allowedZByConnectionName.get(trace.connection_name)
    if (allowedZ === undefined) continue
    for (let index = 1; index < trace.route.length; index++) {
      const a = trace.route[index - 1]!,
        b = trace.route[index]!
      if (
        (a.route_type !== "wire" && a.route_type !== "via") ||
        (b.route_type !== "wire" && b.route_type !== "via") ||
        (a.x === b.x && a.y === b.y)
      )
        continue
      // Match Core's fixed-copper conversion: a wire starts on its own layer;
      // a segment leaving a via starts on that via's logical exit layer.
      const layer = a.route_type === "wire" ? a.layer : a.to_layer
      if (allowedZ.includes(mapLayerNameToZ(layer, layerCount))) continue
      errors.push({
        type: "pcb_trace_error",
        error_type: "pcb_trace_error",
        drc_source: "wire_layer",
        pcb_trace_id: trace.pcb_trace_id,
        pcb_trace_error_id: `wire_layer_${trace.pcb_trace_id}_${index}`,
        message: `Connection "${trace.connection_name}" uses prohibited wire layer "${layer}"`,
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      })
    }
  }
  return errors
}
