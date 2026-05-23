import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjTracesToObstacles } from "lib/utils/convertSrjTracesToObstacles"
import { getSimpleRouteJsonFromCircuitJson } from "@tscircuit/core"
import { useState } from "react"

const KICAD_TO_CIRCUIT_JSON_ESM_URL =
  "https://jscdn.tscircuit.com/kicad-to-circuit-json/latest/+esm"

type CircuitJsonElement = Record<string, any>
type TraceHandlingMode = "trace-obstacles" | "remove-traces" | "keep-traces"

type KicadToCircuitJsonModule = {
  KicadToCircuitJsonConverter: new () => {
    addFile: (filePath: string, content: string) => void
    runUntilFinished: () => void
    getOutput: () => CircuitJsonElement[]
    getWarnings: () => string[]
  }
}

const getBoardWithCenter = (
  element: CircuitJsonElement,
): CircuitJsonElement => {
  if (
    element.type !== "pcb_board" ||
    "center" in element ||
    !Array.isArray(element.outline)
  ) {
    return element
  }

  const xs = element.outline.map((point) => point.x)
  const ys = element.outline.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)

  return {
    ...element,
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    },
    width: element.width ?? maxX - minX,
    height: element.height ?? maxY - minY,
  }
}

const normalizeCircuitJsonForCoreSimpleRouteJson = (
  circuitJson: CircuitJsonElement[],
) => circuitJson.map(getBoardWithCenter)

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

  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    circuitJson: normalizeCircuitJsonForCoreSimpleRouteJson(
      converter.getOutput(),
    ) as any,
  })

  return simpleRouteJson as SimpleRouteJson
}

const removeSrjTraces = (srj: SimpleRouteJson): SimpleRouteJson => {
  const { traces, ...srjWithoutTraces } = srj
  return srjWithoutTraces
}

export default () => {
  const [srj, setSrj] = useState<SimpleRouteJson | null>(null)
  const [traceHandlingMode, setTraceHandlingMode] =
    useState<TraceHandlingMode>("remove-traces")
  const [isLoadingKicad, setIsLoadingKicad] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)

  const srjForPreview =
    !srj || traceHandlingMode === "keep-traces"
      ? srj
      : traceHandlingMode === "trace-obstacles"
        ? convertSrjTracesToObstacles(srj)
        : removeSrjTraces(srj)

  const traceHandlingControls = (
    <div className="flex flex-wrap items-center gap-4 border bg-white px-4 py-3 text-sm shadow-sm">
      <span className="font-medium">Traces</span>
      {[
        {
          label: "Treat as obstacles",
          value: "trace-obstacles",
        },
        {
          label: "Remove SRJ traces",
          value: "remove-traces",
        },
        {
          label: "Keep SRJ traces",
          value: "keep-traces",
        },
      ].map((option) => (
        <label
          key={option.value}
          className="flex cursor-pointer items-center gap-2"
        >
          <input
            type="radio"
            name="trace-handling-mode"
            value={option.value}
            checked={traceHandlingMode === option.value}
            onChange={() =>
              setTraceHandlingMode(option.value as TraceHandlingMode)
            }
          />
          {option.label}
        </label>
      ))}
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
          key={traceHandlingMode}
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

      <div className="mb-6">{traceHandlingControls}</div>

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
