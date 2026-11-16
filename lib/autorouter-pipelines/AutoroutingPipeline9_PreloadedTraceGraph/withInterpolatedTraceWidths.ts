import type { SimplifiedPcbTrace } from "lib/types"

type TraceThicknessMode = Pick<SimplifiedPcbTrace, "route_thickness_mode">
type TraceWithWidths = Pick<
  SimplifiedPcbTrace,
  "route" | "__replaces_pcb_trace_id"
> &
  TraceThicknessMode

/** Preserve vertex widths when Core reverses a newly routed trace. */
export function withInterpolatedTraceWidths<T extends TraceWithWidths>(
  traces: readonly T[],
): Array<T & TraceThicknessMode> {
  return traces.map((trace): T & TraceThicknessMode => {
    if (trace.__replaces_pcb_trace_id || trace.route_thickness_mode) {
      return trace
    }
    const hasWidthTransition = trace.route.some((point, index) => {
      const previous = trace.route[index - 1]
      return (
        point.route_type === "wire" &&
        previous?.route_type === "wire" &&
        point.layer === previous.layer &&
        point.width !== previous.width
      )
    })
    return hasWidthTransition
      ? { ...trace, route_thickness_mode: "interpolated" }
      : trace
  })
}
