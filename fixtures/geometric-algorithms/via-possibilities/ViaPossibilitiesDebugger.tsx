// @ts-nocheck
import React, { useState } from "react"
import { InteractiveGraphics } from "graphics-debug/react"
import { getViaPossibilitiesFromPortPairs } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/getViaPossibilities"
import { Bounds } from "@tscircuit/math-utils"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { safeTransparentize } from "lib/solvers/colors"
import { getPortPointsFromNodeWithPortPoints } from "lib/utils/getPortPointsFromNodeWithPortPoints"

interface ViaPossibilitiesDebuggerProps {
  nodeWithPortPoints: NodeWithPortPoints
}

export const ViaPossibilitiesDebugger: React.FC<
  ViaPossibilitiesDebuggerProps
> = ({ nodeWithPortPoints }) => {
  const colorMap = generateColorMapFromNodeWithPortPoints(nodeWithPortPoints)
  const [minViaCount, setMinViaCount] = useState(1)
  const [maxViaCount, setMaxViaCount] = useState(3)
  const [currentCombinationIndex, setCurrentCombinationIndex] = useState(0)

  // Calculate bounds from nodeWithPortPoints
  const bounds: Bounds = {
    minX: nodeWithPortPoints.center.x - nodeWithPortPoints.width / 2,
    maxX: nodeWithPortPoints.center.x + nodeWithPortPoints.width / 2,
    minY: nodeWithPortPoints.center.y - nodeWithPortPoints.height / 2,
    maxY: nodeWithPortPoints.center.y + nodeWithPortPoints.height / 2,
  }

  // Create port pairs map for visualization
  const portPairs = new Map<string, { start: any; end: any }>()
  const portPoints = getPortPointsFromNodeWithPortPoints(nodeWithPortPoints)
  portPoints.forEach((portPoint) => {
    if (!portPairs.has(portPoint.connectionName)) {
      portPairs.set(portPoint.connectionName, {
        start: {
          ...portPoint,
          z1: portPoint.z ?? 0,
          z2: portPoint.z ?? 0,
        },
        end: null,
      })
    } else {
      portPairs.get(portPoint.connectionName)!.end = {
        ...portPoint,
        z1: portPoint.z ?? 0,
        z2: portPoint.z ?? 0,
      }
    }
  })

  // Remove port pairs with only one point
  Array.from(portPairs.keys()).forEach((connectionName) => {
    if (portPairs.get(connectionName)!.end === null) {
      portPairs.delete(connectionName)
    }
  })

  // Get available Z layers
  const availableZ = nodeWithPortPoints.availableZ ?? [0, 1]

  // Get via possibilities
  const { viaPossibilities, viaCombinations } =
    getViaPossibilitiesFromPortPairs({
      portPairs,
      availableZ,
      bounds,
      maxViaCount,
      minViaCount,
    })

  // Ensure index is valid after count changes
  React.useEffect(() => {
    if (currentCombinationIndex >= viaCombinations.length) {
      setCurrentCombinationIndex(Math.max(0, viaCombinations.length - 1))
    }
  }, [viaCombinations.length, currentCombinationIndex])

  const graphics = {
    points: [],
    lines: [],
    circles: [],
    rects: [],
    title: "Via Possibilities Visualization",
    coordinateSystem: "cartesian",
  }

  // Draw node bounds
  graphics.lines.push({
    points: [
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.maxY },
      { x: bounds.minX, y: bounds.minY },
    ],
    strokeColor: "gray",
  })

  // Draw input port points
  for (const pt of portPoints) {
    graphics.points.push({
      x: pt.x,
      y: pt.y,
      label: `${pt.connectionName} (Port z=${pt.z ?? 0})`,
      color: colorMap[pt.connectionName] ?? "blue",
    })
  }

  // Draw segments connecting port pairs
  for (const [connectionName, { start, end }] of portPairs.entries()) {
    if (start && end) {
      const startZ = start.z ?? 0
      const endZ = end.z ?? 0
      let strokeDash: string | undefined = undefined

      if (startZ === 1 && endZ === 1) {
        strokeDash = [0.2, 0.2] // Dashed for lines entirely on z=1
      } else if (startZ !== endZ) {
        strokeDash = [0.3, 0.1] // Distinct dash for z-transitions
      }
      // Otherwise, strokeDash remains undefined for solid lines (e.g., z=0 to z=0)

      graphics.lines.push({
        points: [start, end],
        strokeColor: safeTransparentize(
          colorMap[connectionName] ?? "purple",
          0.5,
        ),
        strokeWidth: 0.1,
        strokeDash: strokeDash,
        label: `${connectionName} raw connection (z=${startZ}->${endZ})`,
      })
    }
  }

  // Draw the CURRENT via combination
  const currentCombination = viaCombinations[currentCombinationIndex] ?? []
  console.log({ currentCombination })
  for (const viaPlacement of currentCombination) {
    const { x, y, connectionName } = viaPlacement
    const color = colorMap[connectionName] ?? "black"

    graphics.circles.push({
      center: { x, y },
      radius: 0.3,
      fill: color,
      strokeColor: "white",
      strokeWidth: 0.02,
      label: `Via (${connectionName})`,
    })
  }

  // Optionally: Draw all possibilities faintly in the background
  for (const viaPossibility of viaPossibilities) {
    const { x, y, connectionNames } = viaPossibility
    const connectionLabel = connectionNames.join(", ")
    const color =
      connectionNames.length === 1
        ? (colorMap[connectionNames[0]] ?? "black")
        : "purple"
    graphics.circles.push({
      center: { x, y },
      radius: 0.05, // Smaller radius for background possibilities
      stroke: "white",
      fill: safeTransparentize(color, 0.1),
      label: `Possible: (${connectionLabel})`,
    })
  }

  return (
    <div className="p-4">
      <div className="flex gap-4 mb-4">
        <div>
          <label
            htmlFor="minViaCount"
            className="block text-sm font-medium text-gray-700"
          >
            Min Via Count:
          </label>
          <input
            id="minViaCount"
            type="number"
            value={minViaCount}
            onChange={(e) =>
              setMinViaCount(Math.max(1, Number(e.target.value)))
            }
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label
            htmlFor="maxViaCount"
            className="block text-sm font-medium text-gray-700"
          >
            Max Via Count:
          </label>
          <input
            id="maxViaCount"
            type="number"
            value={maxViaCount}
            onChange={(e) =>
              setMaxViaCount(Math.max(minViaCount, Number(e.target.value)))
            }
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Combination Controls */}
      <div className="flex justify-between items-center mb-4">
        <button
          onClick={() =>
            setCurrentCombinationIndex((prev) => Math.max(0, prev - 1))
          }
          disabled={
            currentCombinationIndex === 0 || viaCombinations.length === 0
          }
          className="px-4 py-2 bg-gray-300 rounded disabled:opacity-50"
        >
          Previous Combination
        </button>
        <span>
          Combination{" "}
          {viaCombinations.length > 0 ? currentCombinationIndex + 1 : 0} /{" "}
          {viaCombinations.length}
        </span>
        <button
          onClick={() =>
            setCurrentCombinationIndex((prev) =>
              Math.min(viaCombinations.length - 1, prev + 1),
            )
          }
          disabled={
            currentCombinationIndex >= viaCombinations.length - 1 ||
            viaCombinations.length === 0
          }
          className="px-4 py-2 bg-gray-300 rounded disabled:opacity-50"
        >
          Next Combination
        </button>
      </div>

      <div className="border rounded-md p-4 mb-4">
        <InteractiveGraphics graphics={graphics} />
      </div>

      <div className="mt-4 border-t pt-4">
        <h3 className="font-bold mb-2">Visualization Information</h3>
        <div className="border p-2 rounded mb-2">
          Node: {nodeWithPortPoints.capacityMeshNodeId || "Unknown"}
        </div>
        <div className="border p-2 rounded mb-2">
          Port Pairs: {portPairs.size}
        </div>
        <div className="border p-2 rounded mb-2">
          Via Possibilities: {viaPossibilities.length}
        </div>
        <div className="border p-2 rounded mb-2">
          Available Z Layers: {availableZ.join(", ")}
        </div>
        <div className="border p-2 rounded mb-2">
          Valid Via Combinations Found: {viaCombinations.length}
        </div>
      </div>
    </div>
  )
}
