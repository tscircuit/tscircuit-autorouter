import type { CircuitJson } from "circuit-json"
import type { SimpleRouteJson, SimplifiedPcbTrace, Obstacle } from "lib/types"
import type { PcbTraceError } from "circuit-json"

/** Draw actual board-world geometry in mm, with +Y up converted to screen -Y. */
export function getCompactViaCopperDiagnosticSvg({
  srj,
  circuitJson,
  traces,
  obstacles,
  errors,
}: {
  srj: SimpleRouteJson
  circuitJson: CircuitJson
  traces: SimplifiedPcbTrace[]
  obstacles: Obstacle[]
  errors: PcbTraceError[]
}): string {
  const retained = srj.traces![0]!
  const wireObstacleCount = obstacles.filter((obstacle) =>
    obstacle.obstacleId?.endsWith("_wire"),
  ).length
  const pass = errors.length === 0
  const color = pass ? "#187846" : "#b52a36"
  const heading = pass
    ? "AFTER: both copper segments reserved"
    : "BEFORE: copper segments absent from router obstacles"
  const panels = ["top", "bottom"]
    .map((layer, panelIndex) => {
      const left = 48 + panelIndex * 626
      const x = (value: number): number => left + 287 + value * 65
      const y = (value: number): number => 443 - value * 65
      const copper = [retained, ...traces]
        .flatMap((trace, traceIndex) =>
          trace.route.slice(0, -1).map((a, index) => {
            const b = trace.route[index + 1]!
            if (
              (a.route_type !== "wire" && a.route_type !== "via") ||
              (b.route_type !== "wire" && b.route_type !== "via")
            )
              return ""
            const segmentLayer =
              a.route_type === "wire"
                ? a.layer
                : b.route_type === "wire"
                  ? b.layer
                  : undefined
            const width =
              a.route_type === "wire"
                ? a.width
                : b.route_type === "wire"
                  ? b.width
                  : 0
            const innerTransit =
              layer === "top" && segmentLayer === "inner1" && traceIndex > 0
            if (segmentLayer !== layer && !innerTransit) return ""
            return `<line x1="${x(a.x)}" y1="${y(a.y)}" x2="${x(b.x)}" y2="${y(b.y)}" stroke="${traceIndex === 0 ? "#e78212" : "#087e65"}" stroke-width="${innerTransit ? 3 : width * 65}" ${innerTransit ? 'stroke-dasharray="7 5"' : ""} stroke-linecap="round"/>`
          }),
        )
        .join("")
      const reservations = obstacles
        .filter((obstacle) => obstacle.layers.includes(layer))
        .map(
          (obstacle) =>
            `<rect x="${x(obstacle.center.x - obstacle.width / 2)}" y="${y(obstacle.center.y + obstacle.height / 2)}" width="${obstacle.width * 65}" height="${obstacle.height * 65}" fill="none" stroke="#3066d1" stroke-width="2" stroke-dasharray="5 3" transform="rotate(${-1 * (obstacle.ccwRotationDegrees ?? 0)} ${x(obstacle.center.x)} ${y(obstacle.center.y)})"/>`,
        )
        .join("")
      const pads = circuitJson
        .filter(
          (element) => element.type === "pcb_smtpad" && element.layer === layer,
        )
        .map((pad) => {
          if (pad.type !== "pcb_smtpad" || pad.shape !== "rect")
            throw new Error("Expected rectangular compiled pads")
          const component = circuitJson.find(
            (element) =>
              element.type === "pcb_component" &&
              element.pcb_component_id === pad.pcb_component_id,
          )
          const source =
            component?.type === "pcb_component"
              ? circuitJson.find(
                  (element) =>
                    element.type === "source_component" &&
                    element.source_component_id ===
                      component.source_component_id,
                )
              : undefined
          const name = source?.type === "source_component" ? source.name : "pad"
          return `<rect x="${x(pad.x - pad.width / 2)}" y="${y(pad.y + pad.height / 2)}" width="${pad.width * 65}" height="${pad.height * 65}" rx="3" fill="#ddd" stroke="#555"/><text x="${x(pad.x)}" y="${y(pad.y) + 5}" text-anchor="middle" font-size="11">${name}.${pad.port_hints![0]}</text>`
        })
        .join("")
      const silk = circuitJson
        .filter(
          (element) =>
            element.type === "pcb_silkscreen_path" && element.layer === layer,
        )
        .map((path) => {
          if (path.type !== "pcb_silkscreen_path")
            throw new Error("Expected compiled footprint silk")
          return `<polyline points="${path.route.map((point) => `${x(point.x)},${y(point.y)}`).join(" ")}" fill="none" stroke="#555" stroke-width="${path.stroke_width * 65}"/>`
        })
        .join("")
      const components = circuitJson
        .filter(
          (element) =>
            element.type === "pcb_component" && element.layer === layer,
        )
        .map((component) => {
          if (component.type !== "pcb_component")
            throw new Error("Expected compiled footprint component")
          const source = circuitJson.find(
            (element) =>
              element.type === "source_component" &&
              element.source_component_id === component.source_component_id,
          )!
          if (source.type !== "source_component")
            throw new Error("Expected compiled resistor source")
          return `<text x="${x(component.center.x)}" y="${y(component.center.y) + 50}" text-anchor="middle" font-size="12">${source.name} · 0603 · 10kΩ</text>`
        })
        .join("")
      const newVias = traces
        .flatMap((trace) =>
          trace.route
            .filter(
              (
                point,
              ): point is Extract<
                SimplifiedPcbTrace["route"][number],
                { route_type: "via" }
              > =>
                point.route_type === "via" &&
                (point.from_layer === layer || point.to_layer === layer),
            )
            .map(
              (point) =>
                `<circle cx="${x(point.x)}" cy="${y(point.y)}" r="10" fill="white" stroke="#087e65" stroke-width="3"/><text x="${x(point.x) + 13}" y="${y(point.y) + 20}" font-size="11" fill="#087e65">NEW VIA</text>`,
            ),
        )
        .join("")
      const via = retained.route.find((point) => point.route_type === "via")!
      const short = errors.find((error) =>
        error.pcb_trace_error_id.endsWith(
          layer === "top" ? "source_trace_1_0" : "source_trace_2_0",
        ),
      )
      const marker = short
        ? `<circle cx="${x(layer === "top" ? 0 : 1)}" cy="${y(layer === "top" ? 0 : 1)}" r="22" fill="none" stroke="#c92936" stroke-width="3"/><text x="${x(layer === "top" ? 0 : 1) + 28}" y="${y(layer === "top" ? 0 : 1) - 16}" fill="#c92936" font-size="14" font-weight="bold">ACTUAL SHORT</text>`
        : ""
      return `<g><rect x="${left}" y="191" width="574" height="491" rx="8" fill="#fafafa" stroke="#c4c8ce"/><text x="${left + 20}" y="224" font-size="22" font-weight="bold">${layer.toUpperCase()} COPPER</text><path d="M${x(-3.3)} ${y(0)}H${x(3.3)} M${x(0)} ${y(-3)}V${y(3.1)}" stroke="#e5e7eb"/>${reservations}${copper}${pads}${silk}${components}<circle cx="${x(via.x)}" cy="${y(via.y)}" r="10" fill="#7357a4"/><circle cx="${x(via.x)}" cy="${y(via.y)}" r="4" fill="white"/><text x="${x(via.x) - 14}" y="${y(via.y) - 20}" text-anchor="end" font-size="13">EXISTING VIA</text>${newVias}${marker}</g>`
    })
    .join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="780" viewBox="0 0 1280 780"><rect width="1280" height="780" fill="white"/><g font-family="Arial, sans-serif" fill="#222"><text x="48" y="50" font-size="27" font-weight="bold">${heading}</text><text x="48" y="84" font-size="19">Standard 0603 resistor pads: R1.1 → 3 mm TOP → via → 2 mm BOTTOM → R2.2</text><text x="48" y="119" font-size="21" fill="${color}" font-weight="bold">${wireObstacleCount}/2 retained segments visible • Pipeline 4 solved • independent trace overlap DRC: ${errors.length} shorts</text><text x="48" y="157" font-size="16">0603 pads/silk | Orange: retained | Green: native routes (dashed = INNER1) | Blue dashed: reservations</text>${panels}<text x="48" y="724" font-size="18" fill="${color}">${pass ? "Both pending nets connect without crossing retained copper." : "Router sees only the existing via; it routes both foreign nets directly through real copper."}</text><text x="48" y="753" font-size="15">Diagnostic of this compiled fixture and native Pipeline 4 output; no claim of completing the AM3352 board.</text></g></svg>`
}
