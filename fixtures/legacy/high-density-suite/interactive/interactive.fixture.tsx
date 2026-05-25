import { useState } from "react"
import defaultJson from "tests/high-density-suite/assets/highdensitysuite1.json"
import { HighDensityInteractiveNodeDebugger } from "lib/testing/HighDensityInteractiveNodeDebugger"
import { createPortPointPairsFromPortPoints } from "lib/utils/getPortPointsFromNodeWithPortPoints"

const getNodeWithPortPointsFromJson = (inputData: {
  nodeId?: string
  nodeWithPortPoints?: any
  capacityMeshNodeId?: string
  capacityMeshNode?: {
    capacityMeshNodeId?: string
    center: [number, number]
    width: number
    height: number
  }
  portPoints?: Array<number>
}) => {
  if (inputData?.nodeWithPortPoints) return inputData.nodeWithPortPoints
  if (inputData?.capacityMeshNodeId && inputData?.portPoints) {
    const { portPoints, ...node } = inputData
    return {
      ...node,
      portPointsInPairs: createPortPointPairsFromPortPoints(portPoints as any),
    }
  }
  if (inputData?.capacityMeshNode && inputData?.portPoints) {
    const node = inputData.capacityMeshNode
    return {
      capacityMeshNodeId:
        node.capacityMeshNodeId ?? inputData.nodeId ?? "interactive-node",
      center: node.center,
      width: node.width,
      height: node.height,
      portPointsInPairs: createPortPointPairsFromPortPoints(
        inputData.portPoints as any,
      ),
    }
  }
  return null
}

export default () => {
  const [jsonText, setJsonText] = useState(JSON.stringify(defaultJson, null, 2))
  const [nodeWithPortPoints, setNodeWithPortPoints] = useState<ReturnType<
    typeof getNodeWithPortPointsFromJson
  > | null>(null)

  const handleTextareaInput = (
    event: React.ChangeEvent<HTMLTextAreaElement>,
  ) => {
    setJsonText(event.target.value)
  }

  const loadFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string)
        const node = getNodeWithPortPointsFromJson(json)
        if (!node) {
          alert("JSON does not contain a nodeWithPortPoints-like structure")
          return
        }
        setNodeWithPortPoints(node)
        setJsonText(JSON.stringify(json, null, 2))
      } catch (error) {
        alert(
          "Invalid JSON file! Please upload a valid nodeWithPortPoints JSON.",
        )
        console.error("JSON parse error:", error)
      }
    }
    reader.readAsText(file)
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    loadFile(file)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (!file) return
    loadFile(file)
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()

    try {
      const parsed = JSON.parse(jsonText)
      const node = getNodeWithPortPointsFromJson(parsed)
      if (!node) {
        alert("JSON does not contain a nodeWithPortPoints-like structure")
        return
      }
      setNodeWithPortPoints(node)
    } catch (error) {
      alert("Invalid JSON! Please enter a valid nodeWithPortPoints JSON.")
      console.error("JSON parse error:", error)
    }
  }

  if (!nodeWithPortPoints) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-6">
        <div className="text-xs text-gray-700 space-y-2">
          <div>
            This interactive debugger expects a JSON object describing a single
            capacity node with port points.
          </div>
          <div>
            It must contain either <code>nodeWithPortPoints</code>, or{" "}
            <code>capacityMeshNodeId + portPoints</code>, or{" "}
            <code>capacityMeshNode + portPoints</code>.
          </div>
          <div>
            A sample is prefilled below from{" "}
            <code>tests/high-density-suite/assets/highdensitysuite1.json</code>.
            Edit it or replace it to explore different nodes.
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            className="w-full h-64 p-2 border border-gray-300 rounded-lg font-mono text-xs"
            placeholder="Paste your nodeWithPortPoints JSON here..."
            onChange={handleTextareaInput}
            value={jsonText}
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 text-xs"
            >
              Load JSON
            </button>
            <label className="text-xs flex items-center gap-1 cursor-pointer">
              or choose file
              <input
                type="file"
                accept=".json"
                onChange={handleFileUpload}
                className="text-xs hidden"
              />
            </label>
          </div>
          <div
            className="mt-2 border-2 border-dashed border-gray-300 rounded-lg p-4 text-center text-xs text-gray-500"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            Drag &amp; drop a JSON file here, or use the controls above.
          </div>
        </form>
      </div>
    )
  }

  return (
    <HighDensityInteractiveNodeDebugger
      nodeWithPortPoints={nodeWithPortPoints}
    />
  )
}
