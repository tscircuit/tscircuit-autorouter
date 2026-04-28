import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjTracesToObstacles } from "lib/utils/convertSrjTracesToObstacles"
import { useState } from "react"

export default () => {
  const [srj, setSrj] = useState<SimpleRouteJson | null>(null)
  const [useTracesAsObstacles, setUseTracesAsObstacles] = useState(true)

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
      <h1 className="text-3xl font-bold mb-4">Welcome to Unravel Autorouter</h1>
      <p className="mb-6">
        The unravel autorouter is a new MIT-licensed open-source autorouter. You
        can upload{" "}
        <a href="https://docs.tscircuit.com/advanced/simple-route-json">
          Simple Route Json
        </a>{" "}
        files to test the autorouter. If you're using tscircuit, you can find
        your Simple Route Json files in the "Errors" tab in "Autorouting Log"
      </p>

      <div className="mb-6">{traceObstacleCheckbox}</div>

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
