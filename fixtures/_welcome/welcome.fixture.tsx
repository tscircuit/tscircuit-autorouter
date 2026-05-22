import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjTracesToObstacles } from "lib/utils/convertSrjTracesToObstacles"
import { useState } from "react"

const KICAD_TO_CIRCUIT_JSON_ESM_URL =
  "https://cdn.jsdelivr.net/npm/kicad-to-circuit-json@0.0.32/+esm"

type CircuitJsonElement = Record<string, any>
type SrjConnection = SimpleRouteJson["connections"][number]
type SrjObstacle = SimpleRouteJson["obstacles"][number]
type SrjTrace = NonNullable<SimpleRouteJson["traces"]>[number]
type SrjTraceRoutePoint = SrjTrace["route"][number]

type KicadToCircuitJsonModule = {
  KicadToCircuitJsonConverter: new () => {
    addFile: (filePath: string, content: string) => void
    runUntilFinished: () => void
    getOutput: () => CircuitJsonElement[]
    getWarnings: () => string[]
  }
}

const getElementsByType = (circuitJson: CircuitJsonElement[], type: string) =>
  circuitJson.filter((element) => element.type === type)

const numberOrUndefined = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

const stringOrUndefined = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

const uniqueStrings = (values: Array<string | undefined>) =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))))

const getElementLayers = (element: CircuitJsonElement): string[] => {
  if (Array.isArray(element.layers)) return element.layers.filter(Boolean)
  if (typeof element.layer === "string") return [element.layer]
  return ["top"]
}

const getPointBounds = (points: Array<{ x: number; y: number }>) => {
  if (points.length === 0) return null
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

const getCircuitElementBounds = (element: CircuitJsonElement) => {
  const points = Array.isArray(element.points)
    ? element.points
    : Array.isArray(element.route)
      ? element.route
      : Array.isArray(element.outline)
        ? element.outline
        : null

  if (points) {
    const bounds = getPointBounds(
      points.filter(
        (point) => typeof point?.x === "number" && typeof point?.y === "number",
      ),
    )
    if (bounds) return bounds
  }

  const x = numberOrUndefined(element.x ?? element.center?.x)
  const y = numberOrUndefined(element.y ?? element.center?.y)
  if (x === undefined || y === undefined) return null

  const width =
    numberOrUndefined(
      element.width ??
        element.outer_width ??
        element.rect_pad_width ??
        element.outer_diameter ??
        element.hole_diameter,
    ) ?? 0.5
  const height =
    numberOrUndefined(
      element.height ??
        element.outer_height ??
        element.rect_pad_height ??
        element.outer_diameter ??
        element.hole_diameter,
    ) ?? width

  return {
    minX: x - width / 2,
    maxX: x + width / 2,
    minY: y - height / 2,
    maxY: y + height / 2,
  }
}

const getObstacleFromCircuitElement = ({
  element,
  obstacleId,
  connectedTo,
  isCopperPour = false,
}: {
  element: CircuitJsonElement
  obstacleId: string
  connectedTo: string[]
  isCopperPour?: boolean
}): SimpleRouteJson["obstacles"][number] | null => {
  const bounds = getCircuitElementBounds(element)
  if (!bounds) return null

  return {
    obstacleId,
    componentId: stringOrUndefined(element.pcb_component_id),
    type: "rect",
    layers: getElementLayers(element),
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: Math.max(bounds.maxX - bounds.minX, 0.001),
    height: Math.max(bounds.maxY - bounds.minY, 0.001),
    ccwRotationDegrees: numberOrUndefined(
      element.ccw_rotation ?? element.rect_ccw_rotation,
    ),
    connectedTo,
    isCopperPour,
  }
}

const getLayerCount = (circuitJson: CircuitJsonElement[]) => {
  const layerNames = new Set<string>()

  for (const element of circuitJson) {
    for (const layer of getElementLayers(element)) {
      layerNames.add(layer)
    }
    for (const routePoint of element.route ?? []) {
      if (typeof routePoint.layer === "string") layerNames.add(routePoint.layer)
      if (typeof routePoint.from_layer === "string") {
        layerNames.add(routePoint.from_layer)
      }
      if (typeof routePoint.to_layer === "string")
        layerNames.add(routePoint.to_layer)
    }
  }

  const nonOuterLayers = Array.from(layerNames).filter(
    (layer) => layer !== "top" && layer !== "bottom",
  )
  return Math.max(
    2,
    nonOuterLayers.length +
      (layerNames.has("top") ? 1 : 0) +
      (layerNames.has("bottom") ? 1 : 0),
  )
}

const getSrjBounds = (circuitJson: CircuitJsonElement[]) => {
  const board = getElementsByType(circuitJson, "pcb_board")[0]
  const boardBounds = board ? getCircuitElementBounds(board) : null
  if (boardBounds) return boardBounds

  const allBounds = circuitJson
    .map(getCircuitElementBounds)
    .filter((bounds): bounds is NonNullable<typeof bounds> => Boolean(bounds))

  if (allBounds.length === 0) {
    return { minX: -10, maxX: 10, minY: -10, maxY: 10 }
  }

  const bounds = {
    minX: Math.min(...allBounds.map((bound) => bound.minX)),
    maxX: Math.max(...allBounds.map((bound) => bound.maxX)),
    minY: Math.min(...allBounds.map((bound) => bound.minY)),
    maxY: Math.max(...allBounds.map((bound) => bound.maxY)),
  }

  const margin = 2
  return {
    minX: bounds.minX - margin,
    maxX: bounds.maxX + margin,
    minY: bounds.minY - margin,
    maxY: bounds.maxY + margin,
  }
}

const circuitJsonToSimpleRouteJson = (
  circuitJson: CircuitJsonElement[],
): SimpleRouteJson => {
  const sourceTraces = getElementsByType(circuitJson, "source_trace")
  const pcbPorts = getElementsByType(circuitJson, "pcb_port")
  const sourceTraceIdsByDisplayName = new Map<string, string>()
  const sourcePortIdToTraceIds = new Map<string, string[]>()
  const pcbPortIdToSourcePortId = new Map<string, string>()
  const pcbPortBySourcePortId = new Map<string, CircuitJsonElement>()

  for (const sourceTrace of sourceTraces) {
    const sourceTraceId =
      stringOrUndefined(sourceTrace.source_trace_id) ??
      stringOrUndefined(sourceTrace.display_name)
    if (!sourceTraceId) continue

    const displayName = stringOrUndefined(sourceTrace.display_name)
    if (displayName) sourceTraceIdsByDisplayName.set(displayName, sourceTraceId)

    for (const sourcePortId of sourceTrace.connected_source_port_ids ?? []) {
      if (typeof sourcePortId !== "string") continue
      sourcePortIdToTraceIds.set(sourcePortId, [
        ...(sourcePortIdToTraceIds.get(sourcePortId) ?? []),
        sourceTraceId,
      ])
    }
  }

  for (const pcbPort of pcbPorts) {
    const pcbPortId = stringOrUndefined(pcbPort.pcb_port_id)
    const sourcePortId = stringOrUndefined(pcbPort.source_port_id)
    if (!sourcePortId) continue

    pcbPortBySourcePortId.set(sourcePortId, pcbPort)
    if (pcbPortId) pcbPortIdToSourcePortId.set(pcbPortId, sourcePortId)
  }

  const connections: SrjConnection[] = []
  for (const [traceIndex, sourceTrace] of sourceTraces.entries()) {
    const sourceTraceId =
      stringOrUndefined(sourceTrace.source_trace_id) ??
      `source_trace_${traceIndex}`
    const displayName = stringOrUndefined(sourceTrace.display_name)
    const pointsToConnect: SrjConnection["pointsToConnect"] = (
      sourceTrace.connected_source_port_ids ?? []
    )
      .map((sourcePortId: unknown) =>
        typeof sourcePortId === "string"
          ? pcbPortBySourcePortId.get(sourcePortId)
          : undefined,
      )
      .filter(
        (port: CircuitJsonElement | undefined): port is CircuitJsonElement =>
          Boolean(port),
      )
      .map((port: CircuitJsonElement) => {
        const layers = getElementLayers(port)
        const point = {
          x: numberOrUndefined(port.x) ?? 0,
          y: numberOrUndefined(port.y) ?? 0,
          pcb_port_id: stringOrUndefined(port.pcb_port_id),
        }

        if (layers.length > 1) {
          return { ...point, layers }
        }

        return { ...point, layer: layers[0] ?? "top" }
      })

    if (pointsToConnect.length < 2) continue

    connections.push({
      name: sourceTraceId,
      rootConnectionName: displayName,
      netConnectionName: displayName,
      pointsToConnect,
    })
  }

  const getConnectedTraceIdsForPcbPort = (pcbPortId: unknown) => {
    if (typeof pcbPortId !== "string") return []
    const sourcePortId = pcbPortIdToSourcePortId.get(pcbPortId)
    if (!sourcePortId) return []
    return sourcePortIdToTraceIds.get(sourcePortId) ?? []
  }

  const obstacles: SrjObstacle[] = [
    ...getElementsByType(circuitJson, "pcb_smtpad").map((element, index) =>
      getObstacleFromCircuitElement({
        element,
        obstacleId: `kicad_smtpad_${stringOrUndefined(element.pcb_smtpad_id) ?? index}`,
        connectedTo: getConnectedTraceIdsForPcbPort(element.pcb_port_id),
      }),
    ),
    ...getElementsByType(circuitJson, "pcb_plated_hole").map((element, index) =>
      getObstacleFromCircuitElement({
        element,
        obstacleId: `kicad_plated_hole_${stringOrUndefined(element.pcb_plated_hole_id) ?? index}`,
        connectedTo: getConnectedTraceIdsForPcbPort(element.pcb_port_id),
      }),
    ),
    ...getElementsByType(circuitJson, "pcb_via").map((element, index) =>
      getObstacleFromCircuitElement({
        element,
        obstacleId:
          stringOrUndefined(element.pcb_via_id) ?? `kicad_via_${index}`,
        connectedTo: [],
      }),
    ),
    ...getElementsByType(circuitJson, "pcb_copper_pour").map((element, index) =>
      getObstacleFromCircuitElement({
        element,
        obstacleId: `kicad_copper_pour_${index}`,
        connectedTo: uniqueStrings([
          sourceTraceIdsByDisplayName.get(
            stringOrUndefined(element.net_name) ?? "",
          ),
        ]),
        isCopperPour: true,
      }),
    ),
  ].filter((obstacle): obstacle is SrjObstacle => Boolean(obstacle))

  const traces: SrjTrace[] = getElementsByType(circuitJson, "pcb_trace")
    .map((trace, traceIndex) => {
      const route: SrjTraceRoutePoint[] = (trace.route ?? [])
        .map((routePoint: CircuitJsonElement) => {
          if (routePoint.route_type !== "wire") return null
          return {
            route_type: "wire" as const,
            x: numberOrUndefined(routePoint.x) ?? 0,
            y: numberOrUndefined(routePoint.y) ?? 0,
            width: numberOrUndefined(routePoint.width) ?? 0.2,
            layer: stringOrUndefined(routePoint.layer) ?? "top",
          }
        })
        .filter(
          (
            routePoint: SrjTraceRoutePoint | null,
          ): routePoint is SrjTraceRoutePoint => Boolean(routePoint),
        )

      if (route.length < 2) return null

      return {
        type: "pcb_trace" as const,
        pcb_trace_id:
          stringOrUndefined(trace.pcb_trace_id) ?? `kicad_trace_${traceIndex}`,
        connection_name:
          stringOrUndefined(trace.source_trace_id) ??
          `kicad_trace_connection_${traceIndex}`,
        route,
      }
    })
    .filter((trace): trace is SrjTrace => Boolean(trace))

  const traceWidths = traces.flatMap((trace) =>
    trace.route
      .map((routePoint) =>
        routePoint.route_type === "wire" ? routePoint.width : undefined,
      )
      .filter(
        (width): width is number => typeof width === "number" && width > 0,
      ),
  )
  const minTraceWidth = traceWidths.length > 0 ? Math.min(...traceWidths) : 0.2

  const board = getElementsByType(circuitJson, "pcb_board")[0]
  const outline = Array.isArray(board?.outline) ? board.outline : undefined

  return {
    layerCount: getLayerCount(circuitJson),
    minTraceWidth,
    obstacles,
    connections,
    bounds: getSrjBounds(circuitJson),
    ...(outline ? { outline } : {}),
    ...(traces.length > 0 ? { traces } : {}),
  }
}

const convertKicadPcbToSimpleRouteJson = async (file: File) => {
  if (!file.name.toLowerCase().endsWith(".kicad_pcb")) {
    throw new Error("Only .kicad_pcb files are supported.")
  }

  const { KicadToCircuitJsonConverter } = (await import(
    /* @vite-ignore */ KICAD_TO_CIRCUIT_JSON_ESM_URL
  )) as KicadToCircuitJsonModule
  const converter = new KicadToCircuitJsonConverter()
  converter.addFile(file.name, await file.text())
  converter.runUntilFinished()

  const warnings = converter.getWarnings()
  if (warnings.length > 0) {
    console.warn("KiCad conversion warnings:", warnings)
  }

  return circuitJsonToSimpleRouteJson(converter.getOutput())
}

export default () => {
  const [srj, setSrj] = useState<SimpleRouteJson | null>(null)
  const [useTracesAsObstacles, setUseTracesAsObstacles] = useState(true)
  const [isLoadingKicad, setIsLoadingKicad] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)

  const srjForPreview =
    srj && useTracesAsObstacles ? convertSrjTracesToObstacles(srj) : srj

  const traceObstacleCheckbox = (
    <div className="flex flex-wrap items-center gap-3 border bg-white px-4 py-3 text-sm shadow-sm">
      <input
        type="checkbox"
        id="use-traces-as-obstacles"
        checked={useTracesAsObstacles}
        onChange={(event) => setUseTracesAsObstacles(event.target.checked)}
      />
      <label htmlFor="use-traces-as-obstacles" className="font-medium">
        Treat SRJ traces as obstacles
      </label>
    </div>
  )

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string)
        setSrj(json)
      } catch (error) {
        alert(
          "Invalid JSON file! Please upload a valid Simple Route Json file.",
        )
        console.error("JSON parse error:", error)
      }
    }
    reader.readAsText(file)
  }

  const loadKicadPcbFile = async (file: File) => {
    setUploadMessage(null)
    setIsLoadingKicad(true)
    try {
      const nextSrj = await convertKicadPcbToSimpleRouteJson(file)
      setSrj(nextSrj)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load KiCad PCB file."
      setUploadMessage(message)
      alert(message)
      console.error("KiCad PCB conversion error:", error)
    } finally {
      setIsLoadingKicad(false)
    }
  }

  const handleKicadPcbUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      await loadKicadPcbFile(file)
    } finally {
      event.target.value = ""
    }
  }

  const handleKicadPcbDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = isLoadingKicad ? "none" : "copy"
  }

  const handleKicadPcbDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (isLoadingKicad) return

    const file = event.dataTransfer.files?.[0]
    if (!file) return

    await loadKicadPcbFile(file)
  }

  const handleTextareaInput = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    try {
      const json = JSON.parse(event.target.value)
      setSrj(json)
    } catch (error) {
      // Don't show error while typing - only when submitting
      console.debug("JSON parsing in progress...")
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const textarea = event.currentTarget.querySelector("textarea")
    if (!textarea) return

    try {
      const json = JSON.parse(textarea.value)
      setSrj(json)
    } catch (error) {
      alert("Invalid JSON! Please enter valid Simple Route Json.")
      console.error("JSON parse error:", error)
    }
  }

  // Sample JSON for users to get started
  const sampleJson: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    obstacles: [
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 0, y: 0 },
        width: 5,
        height: 5,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "conn1",
        pointsToConnect: [
          { x: -10, y: 5, layer: "top" },
          { x: 10, y: 5, layer: "top" },
        ],
      },
    ],
    bounds: { minX: -15, maxX: 15, minY: -15, maxY: 15 },
  }

  if (srj && srjForPreview) {
    return (
      <div>
        <AutoroutingPipelineDebugger
          key={useTracesAsObstacles ? "trace-obstacles" : "plain-srj"}
          srj={srjForPreview}
        />
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-4">
        Welcome to the tscircuit autorouter
      </h1>
      <p className="mb-6">
        The tscircuit autorouter is an MIT-licensed open-source autorouter. You
        can upload{" "}
        <a href="https://docs.tscircuit.com/advanced/simple-route-json">
          Simple Route Json
        </a>{" "}
        files to test the autorouter. If you're using tscircuit, you can find
        your Simple Route Json files in the "Errors" tab in "Autorouting Log"
      </p>

      <div className="mb-6">{traceObstacleCheckbox}</div>

      {uploadMessage && (
        <div className="mb-6 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {uploadMessage}
        </div>
      )}

      <div
        className="mb-8 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center"
        onDragOver={handleKicadPcbDragOver}
        onDrop={handleKicadPcbDrop}
      >
        <h2 className="text-xl font-semibold mb-3">Upload KiCad PCB</h2>
        <input
          type="file"
          accept=".kicad_pcb"
          onChange={handleKicadPcbUpload}
          className="hidden"
          id="kicad-pcb-upload"
          disabled={isLoadingKicad}
        />
        <label
          htmlFor="kicad-pcb-upload"
          className="cursor-pointer bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          {isLoadingKicad ? "Converting..." : "Choose .kicad_pcb File"}
        </label>
        <p className="mt-2 text-sm text-gray-500">
          KiCad PCB files are converted to Circuit JSON in the browser, then
          loaded into the autorouter debugger as Simple Route Json.
        </p>
      </div>

      <div className="flex gap-8 items-start">
        <div className="flex-1">
          <h2 className="text-xl font-semibold mb-3">
            Upload Simple Route Json
          </h2>
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="cursor-pointer bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              Choose File
            </label>
            <p className="mt-2 text-sm text-gray-500">
              or drag and drop a JSON file here
            </p>
          </div>
        </div>

        <div className="flex-1">
          <h2 className="text-xl font-semibold mb-3">
            Paste Simple Route Json
          </h2>
          <form onSubmit={handleSubmit}>
            <textarea
              className="w-full h-64 p-3 border border-gray-300 rounded-lg font-mono text-sm"
              placeholder="Paste your Simple Route Json here..."
              onChange={handleTextareaInput}
              defaultValue={JSON.stringify(sampleJson, null, 2)}
            />
            <button
              type="submit"
              className="mt-3 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            >
              Load JSON
            </button>
          </form>
        </div>
      </div>

      <div className="mt-10 p-4 bg-gray-100 rounded-lg">
        <h2 className="text-xl font-semibold mb-3">Quick Tips</h2>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            The Simple Route Json should include obstacles, connections, and
            layer information.
          </li>
          <li>Use multiple layers to create more complex routing scenarios.</li>
          <li>Adjust the minTraceWidth property to control trace spacing.</li>
          <li>Check out the examples in the sidebar for inspiration.</li>
          <li>
            Once the autorouter runs, you can debug each step of the routing
            process.
          </li>
        </ul>
      </div>
    </div>
  )
}
