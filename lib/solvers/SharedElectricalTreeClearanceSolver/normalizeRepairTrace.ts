import type { SimplifiedPcbTrace } from "./nativeRepairTypes"

/** Give each via explicit adjacent copper endpoints without altering the input. */
export const normalizeRepairTrace = (
  trace: SimplifiedPcbTrace,
  minTraceWidth: number,
): SimplifiedPcbTrace => {
  const output: SimplifiedPcbTrace["route"] = []
  for (let index = 0; index < trace.route.length; index += 1) {
    const token = trace.route[index]!
    if (token.route_type !== "via") {
      output.push(structuredClone(token))
      continue
    }
    const previous = output[output.length - 1]
    const next = trace.route[index + 1]
    const incomingWidth =
      previous?.route_type === "wire"
        ? previous.width
        : next?.route_type === "wire"
          ? next.width
          : minTraceWidth
    const outgoingWidth =
      next?.route_type === "wire" ? next.width : incomingWidth
    if (
      previous?.route_type !== "wire" ||
      previous.x !== token.x ||
      previous.y !== token.y ||
      previous.layer !== token.from_layer
    ) {
      output.push({
        route_type: "wire",
        x: token.x,
        y: token.y,
        layer: token.from_layer,
        width: incomingWidth,
      })
    }
    output.push(structuredClone(token))
    if (
      next?.route_type !== "wire" ||
      next.x !== token.x ||
      next.y !== token.y ||
      next.layer !== token.to_layer
    ) {
      output.push({
        route_type: "wire",
        x: token.x,
        y: token.y,
        layer: token.to_layer,
        width: outgoingWidth,
      })
    }
  }
  return { ...structuredClone(trace), route: output }
}
