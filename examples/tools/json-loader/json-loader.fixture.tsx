import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { SimpleRouteJson } from "lib/types"
import { useState } from "react"

export default () => {
  const [srj, setSrj] = useState<SimpleRouteJson | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string)
        setSrj(json)
      } catch (err) {
        setError(
          `Invalid JSON file: ${err instanceof Error ? err.message : "Unknown error"}`,
        )
        console.error("JSON parse error:", err)
      }
    }
    reader.readAsText(file)
  }

  const handleTextareaInput = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const value = event.target.value.trim()
    if (!value) {
      setSrj(null)
      setError(null)
      return
    }

    try {
      const json = JSON.parse(value)
      setSrj(json)
      setError(null)
    } catch (err) {
      setError(null)
    }
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const textarea = event.currentTarget.querySelector("textarea")
    if (!textarea) return

    const value = textarea.value.trim()
    if (!value) {
      setError("Please enter JSON content")
      return
    }

    try {
      const json = JSON.parse(value)
      setSrj(json)
      setError(null)
    } catch (err) {
      setError(
        `Invalid JSON: ${err instanceof Error ? err.message : "Unknown error"}`,
      )
      console.error("JSON parse error:", err)
    }
  }

  const handleClear = () => {
    setSrj(null)
    setError(null)
  }

  const sampleJson: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    obstacles: [
      {
        type: "rect",
        layers: ["top", "bottom"],
        center: { x: 0, y: 0 },
        width: 3,
        height: 3,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "trace1",
        pointsToConnect: [
          { x: -5, y: 0, layer: "top" },
          { x: 5, y: 0, layer: "top" },
        ],
      },
    ],
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
  }

  if (srj) {
    return (
      <div>
        <div className="fixed top-4 right-4 z-50">
          <button
            onClick={handleClear}
            className="bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 shadow-lg"
          >
            Clear & Load New JSON
          </button>
        </div>
        <AutoroutingPipelineDebugger srj={srj} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <h1 className="text-4xl font-bold mb-2 text-gray-800">
            JSON SRJ Loader
          </h1>
          <p className="text-gray-600 mb-8">
            Load and visualize Simple Route JSON files for autorouting analysis
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 font-medium">{error}</p>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h2 className="text-2xl font-semibold mb-4 text-gray-700">
                Upload JSON File
              </h2>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-blue-400 transition-colors">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  <div className="mb-4">
                    <svg
                      className="mx-auto h-12 w-12 text-gray-400"
                      stroke="currentColor"
                      fill="none"
                      viewBox="0 0 48 48"
                    >
                      <path
                        d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <span className="inline-block bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors font-medium">
                    Choose File
                  </span>
                  <p className="mt-4 text-sm text-gray-500">
                    Click to select a .json file
                  </p>
                </label>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-4 text-gray-700">
                Paste JSON Content
              </h2>
              <form onSubmit={handleSubmit}>
                <textarea
                  className="w-full h-64 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Paste your Simple Route JSON here..."
                  onChange={handleTextareaInput}
                  defaultValue={JSON.stringify(sampleJson, null, 2)}
                />
                <button
                  type="submit"
                  className="mt-4 w-full bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600 transition-colors font-medium"
                >
                  Load JSON
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
