import {
  getPrimaryId,
  getReadableNameForElement,
} from "@tscircuit/circuit-json-util"
import type { AnyCircuitElement, SourceTrace } from "circuit-json"

const firstReadableName = (
  candidates: Array<string | null | undefined>,
  id: string,
): string => {
  for (const candidate of candidates) {
    if (
      !candidate ||
      candidate === id ||
      (id.length > 0 && candidate.includes(id))
    )
      continue
    if (/\b(?:pcb|source|schematic|subcircuit)_[a-z0-9_]+\b/i.test(candidate))
      continue
    return candidate
  }
  return ""
}

export const getDrcReadablePortName = (
  circuitJson: AnyCircuitElement[],
  pcbPortId: string,
): string => {
  const port = circuitJson.find(
    (element) =>
      element.type === "pcb_port" && element.pcb_port_id === pcbPortId,
  )
  if (port?.type !== "pcb_port") return "unnamed port"
  const sourcePort = circuitJson.find(
    (element) =>
      element.type === "source_port" &&
      element.source_port_id === port.source_port_id,
  )
  if (sourcePort?.type !== "source_port") return "unnamed port"
  const component = circuitJson.find(
    (element) =>
      element.type === "source_component" &&
      element.source_component_id === sourcePort.source_component_id,
  )
  const componentName =
    component?.type === "source_component"
      ? firstReadableName([component.name], component.source_component_id)
      : ""
  const portName = firstReadableName(
    [
      sourcePort.name,
      sourcePort.pin_number?.toString(),
      sourcePort.port_hints?.[0],
    ],
    sourcePort.source_port_id,
  )
  if (componentName && portName) return `${componentName}.${portName}`
  return portName || "unnamed port"
}

export const getDrcReadableSourceTraceName = (
  circuitJson: AnyCircuitElement[],
  sourceTrace: SourceTrace,
): string => {
  const displayName = firstReadableName(
    [sourceTrace.display_name],
    sourceTrace.source_trace_id,
  )
  if (displayName) return displayName
  const names: string[] = []
  for (const sourcePortId of sourceTrace.connected_source_port_ids ?? []) {
    const port = circuitJson.find(
      (element) =>
        element.type === "pcb_port" && element.source_port_id === sourcePortId,
    )
    if (port?.type === "pcb_port") {
      const name = getDrcReadablePortName(circuitJson, port.pcb_port_id)
      if (name !== "unnamed port") names.push(name)
    } else {
      const sourcePort = circuitJson.find(
        (element) =>
          element.type === "source_port" &&
          element.source_port_id === sourcePortId,
      )
      if (sourcePort?.type !== "source_port") continue
      const component = circuitJson.find(
        (element) =>
          element.type === "source_component" &&
          element.source_component_id === sourcePort.source_component_id,
      )
      const componentName =
        component?.type === "source_component"
          ? firstReadableName([component.name], component.source_component_id)
          : ""
      const portName = firstReadableName(
        [
          sourcePort.name,
          sourcePort.pin_number?.toString(),
          sourcePort.port_hints?.[0],
        ],
        sourcePort.source_port_id,
      )
      if (componentName && portName) names.push(`${componentName}.${portName}`)
      else if (portName) names.push(portName)
    }
    if (names.length === 2) return `${names[0]} to ${names[1]}`
  }
  return names.length === 1 ? `trace connected to ${names[0]}` : "unnamed trace"
}

export const getDrcReadableTraceName = (
  circuitJson: AnyCircuitElement[],
  pcbTraceId: string,
): string => {
  const trace = circuitJson.find(
    (element) =>
      element.type === "pcb_trace" && element.pcb_trace_id === pcbTraceId,
  )
  if (trace?.type !== "pcb_trace") return "unnamed trace"
  const sourceTrace = circuitJson.find(
    (element) =>
      element.type === "source_trace" &&
      element.source_trace_id === trace.source_trace_id,
  )
  if (sourceTrace?.type === "source_trace")
    return getDrcReadableSourceTraceName(circuitJson, sourceTrace)
  const portIds = Array.from(
    new Set(
      trace.route.flatMap((point) =>
        point.route_type === "wire"
          ? [point.start_pcb_port_id, point.end_pcb_port_id].filter(
              (id): id is string => Boolean(id),
            )
          : [],
      ),
    ),
  )
  const names = portIds
    .map((id) => getDrcReadablePortName(circuitJson, id))
    .filter((name) => name !== "unnamed port")
  if (names.length >= 2) return `${names[0]} to ${names[1]}`
  return names.length === 1 ? `trace connected to ${names[0]}` : "unnamed trace"
}

export const getDrcReadableElementName = (
  circuitJson: AnyCircuitElement[],
  elementId: string,
): string => {
  const element = circuitJson.find(
    (record) => getPrimaryId(record) === elementId,
  )
  if (!element) return "unnamed element"
  if (
    element.type === "pcb_component" ||
    element.type === "schematic_component"
  ) {
    const component = circuitJson.find(
      (record) =>
        record.type === "source_component" &&
        record.source_component_id === element.source_component_id,
    )
    if (component?.type === "source_component")
      return (
        firstReadableName([component.name], component.source_component_id) ||
        "unnamed component"
      )
  }
  if (
    (element.type === "pcb_smtpad" || element.type === "pcb_plated_hole") &&
    element.pcb_port_id
  ) {
    const portName = getDrcReadablePortName(circuitJson, element.pcb_port_id)
    if (portName !== "unnamed port") return portName
  }
  if (element.type === "pcb_trace")
    return getDrcReadableTraceName(circuitJson, elementId)
  const labels: Partial<Record<AnyCircuitElement["type"], string>> = {
    pcb_smtpad: "SMD pad",
    pcb_plated_hole: "through-hole pad",
    pcb_via: "via",
    pcb_hole: "hole",
    pcb_bend: "bend",
    pcb_stiffener: "stiffener",
    pcb_keepout: "keepout",
    pcb_cutout: "cutout",
    pcb_copper_pour: "copper pour",
  }
  const label =
    labels[element.type] ??
    element.type.replace(/^(pcb|source|schematic)_/, "").replaceAll("_", " ")
  return (
    firstReadableName(
      [
        "name" in element ? element.name : undefined,
        "description" in element ? element.description : undefined,
        getReadableNameForElement(circuitJson, elementId),
      ],
      elementId,
    ) || `unnamed ${label}`
  )
}
