import {
  getPrimaryId,
  getReadableNameForElement,
} from "@tscircuit/circuit-json-util"
import type { AnyCircuitElement, SourceTrace } from "circuit-json"

type ElementOfType<T extends AnyCircuitElement["type"]> = Extract<
  AnyCircuitElement,
  { type: T }
>
type ReadableNameIndexes = {
  elements: Map<string | undefined, AnyCircuitElement>
  pcbPorts: Map<string | undefined, ElementOfType<"pcb_port">>
  pcbPortsBySourcePort: Map<string | undefined, ElementOfType<"pcb_port">>
  sourcePorts: Map<string | undefined, ElementOfType<"source_port">>
  sourceComponents: Map<string | undefined, ElementOfType<"source_component">>
  pcbTraces: Map<string | undefined, ElementOfType<"pcb_trace">>
  sourceTraces: Map<string | undefined, SourceTrace>
}
export type DrcReadableNameResolver = {
  getPortName: (pcbPortId: string) => string
  getSourceTraceName: (sourceTrace: SourceTrace) => string
  getTraceName: (pcbTraceId: string) => string
  getElementName: (elementId: string) => string
}
type ReadableNameContext = DrcReadableNameResolver & {
  getIndexes: () => ReadableNameIndexes
}

const memoizeReadableName = <T>(resolve: (key: T) => string): ((key: T) => string) => {
  const names = new Map<T, string>()
  return (key): string => {
    const cached = names.get(key)
    if (cached !== undefined) return cached
    const name = resolve(key)
    names.set(key, name)
    return name
  }
}

/** Names are cached only for this evaluation; create a new resolver after edits. */
export const createDrcReadableNameResolver = (
  circuitJson: AnyCircuitElement[],
): DrcReadableNameResolver => {
  let indexes: ReadableNameIndexes | undefined
  const getIndexes = (): ReadableNameIndexes => {
    if (indexes) return indexes
    const result: ReadableNameIndexes = {
      elements: new Map(),
      pcbPorts: new Map(),
      pcbPortsBySourcePort: new Map(),
      sourcePorts: new Map(),
      sourceComponents: new Map(),
      pcbTraces: new Map(),
      sourceTraces: new Map(),
    }
    for (const element of circuitJson) {
      const id = getPrimaryId(element)
      // Array.find chooses the first record when identifiers are duplicated.
      if (!result.elements.has(id)) result.elements.set(id, element)
      if (element.type === "pcb_port") {
        if (!result.pcbPorts.has(element.pcb_port_id))
          result.pcbPorts.set(element.pcb_port_id, element)
        if (!result.pcbPortsBySourcePort.has(element.source_port_id))
          result.pcbPortsBySourcePort.set(element.source_port_id, element)
      } else if (element.type === "source_port") {
        if (!result.sourcePorts.has(element.source_port_id))
          result.sourcePorts.set(element.source_port_id, element)
      } else if (element.type === "source_component") {
        if (!result.sourceComponents.has(element.source_component_id))
          result.sourceComponents.set(element.source_component_id, element)
      } else if (element.type === "pcb_trace") {
        if (!result.pcbTraces.has(element.pcb_trace_id))
          result.pcbTraces.set(element.pcb_trace_id, element)
      } else if (element.type === "source_trace") {
        if (!result.sourceTraces.has(element.source_trace_id))
          result.sourceTraces.set(element.source_trace_id, element)
      }
    }
    indexes = result
    return result
  }
  const context: ReadableNameContext = {
    getIndexes,
    getPortName: memoizeReadableName((id) =>
      resolveDrcReadablePortName(circuitJson, id, context),
    ),
    getSourceTraceName: memoizeReadableName((trace) =>
      resolveDrcReadableSourceTraceName(circuitJson, trace, context),
    ),
    getTraceName: memoizeReadableName((id) =>
      resolveDrcReadableTraceName(circuitJson, id, context),
    ),
    getElementName: memoizeReadableName((id) =>
      resolveDrcReadableElementName(circuitJson, id, context),
    ),
  }
  return context
}

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

const resolveDrcReadablePortName = (
  circuitJson: AnyCircuitElement[],
  pcbPortId: string,
  context?: ReadableNameContext,
): string => {
  const port = context
    ? context.getIndexes().pcbPorts.get(pcbPortId)
    : circuitJson.find(
        (element) =>
          element.type === "pcb_port" && element.pcb_port_id === pcbPortId,
      )
  if (port?.type !== "pcb_port") return "unnamed port"
  const sourcePort = context
    ? context.getIndexes().sourcePorts.get(port.source_port_id)
    : circuitJson.find(
        (element) =>
          element.type === "source_port" &&
          element.source_port_id === port.source_port_id,
      )
  if (sourcePort?.type !== "source_port") return "unnamed port"
  const component = context
    ? context.getIndexes().sourceComponents.get(sourcePort.source_component_id)
    : circuitJson.find(
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

const resolveDrcReadableSourceTraceName = (
  circuitJson: AnyCircuitElement[],
  sourceTrace: SourceTrace,
  context?: ReadableNameContext,
): string => {
  const displayName = firstReadableName(
    [sourceTrace.display_name],
    sourceTrace.source_trace_id,
  )
  if (displayName) return displayName
  const names: string[] = []
  for (const sourcePortId of sourceTrace.connected_source_port_ids ?? []) {
    const port = context
      ? context.getIndexes().pcbPortsBySourcePort.get(sourcePortId)
      : circuitJson.find(
          (element) =>
            element.type === "pcb_port" && element.source_port_id === sourcePortId,
        )
    if (port?.type === "pcb_port") {
      const name = context
        ? context.getPortName(port.pcb_port_id)
        : getDrcReadablePortName(circuitJson, port.pcb_port_id)
      if (name !== "unnamed port") names.push(name)
    } else {
      const sourcePort = context
        ? context.getIndexes().sourcePorts.get(sourcePortId)
        : circuitJson.find(
            (element) =>
              element.type === "source_port" &&
              element.source_port_id === sourcePortId,
          )
      if (sourcePort?.type !== "source_port") continue
      const component = context
        ? context.getIndexes().sourceComponents.get(sourcePort.source_component_id)
        : circuitJson.find(
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

const resolveDrcReadableTraceName = (
  circuitJson: AnyCircuitElement[],
  pcbTraceId: string,
  context?: ReadableNameContext,
): string => {
  const trace = context
    ? context.getIndexes().pcbTraces.get(pcbTraceId)
    : circuitJson.find(
        (element) =>
          element.type === "pcb_trace" && element.pcb_trace_id === pcbTraceId,
      )
  if (trace?.type !== "pcb_trace") return "unnamed trace"
  const sourceTrace = context
    ? context.getIndexes().sourceTraces.get(trace.source_trace_id)
    : circuitJson.find(
        (element) =>
          element.type === "source_trace" &&
          element.source_trace_id === trace.source_trace_id,
      )
  if (sourceTrace?.type === "source_trace")
    return context
      ? context.getSourceTraceName(sourceTrace)
      : getDrcReadableSourceTraceName(circuitJson, sourceTrace)
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
    .map((id) =>
      context ? context.getPortName(id) : getDrcReadablePortName(circuitJson, id),
    )
    .filter((name) => name !== "unnamed port")
  if (names.length >= 2) return `${names[0]} to ${names[1]}`
  return names.length === 1 ? `trace connected to ${names[0]}` : "unnamed trace"
}

const resolveDrcReadableElementName = (
  circuitJson: AnyCircuitElement[],
  elementId: string,
  context?: ReadableNameContext,
): string => {
  const element = context
    ? context.getIndexes().elements.get(elementId)
    : circuitJson.find((record) => getPrimaryId(record) === elementId)
  if (!element) return "unnamed element"
  if (
    element.type === "pcb_component" ||
    element.type === "schematic_component"
  ) {
    const component = context
      ? context.getIndexes().sourceComponents.get(element.source_component_id)
      : circuitJson.find(
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
    const portName = context
      ? context.getPortName(element.pcb_port_id)
      : getDrcReadablePortName(circuitJson, element.pcb_port_id)
    if (portName !== "unnamed port") return portName
  }
  if (element.type === "pcb_trace")
    return context
      ? context.getTraceName(elementId)
      : getDrcReadableTraceName(circuitJson, elementId)
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

export const getDrcReadablePortName = (
  circuitJson: AnyCircuitElement[],
  pcbPortId: string,
): string => {
  return resolveDrcReadablePortName(circuitJson, pcbPortId)
}

export const getDrcReadableSourceTraceName = (
  circuitJson: AnyCircuitElement[],
  sourceTrace: SourceTrace,
): string => {
  return resolveDrcReadableSourceTraceName(circuitJson, sourceTrace)
}

export const getDrcReadableTraceName = (
  circuitJson: AnyCircuitElement[],
  pcbTraceId: string,
): string => {
  return resolveDrcReadableTraceName(circuitJson, pcbTraceId)
}

export const getDrcReadableElementName = (
  circuitJson: AnyCircuitElement[],
  elementId: string,
): string => {
  return resolveDrcReadableElementName(circuitJson, elementId)
}
