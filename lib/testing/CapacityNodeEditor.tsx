import type { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import { CapacityMeshNode } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { MetricsCard } from "./capacity-node-editor/MetricsCard"
import { PortPoint } from "./capacity-node-editor/PortPoint"
import { LAYER_COLORS, SCALE } from "./capacity-node-editor/constants"
import {
  findEdgeAndT,
  getPointOnEdge,
  getTFromMouseOnEdge,
  parseLayers,
} from "./capacity-node-editor/helpers"
import type {
  DragStartState,
  DraggingState,
  Edge,
  PairDef,
  PointDef,
  Rect,
  SelectionState,
} from "./capacity-node-editor/types"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

export interface CapacityNodeEditorProps {
  onNodeChange?: (node: NodeWithPortPoints) => void
  solver?: HyperSingleIntraNodeSolver
  initialNode?: NodeWithPortPoints
}

export default function CapacityNodeEditor({
  onNodeChange,
  solver,
  initialNode,
}: CapacityNodeEditorProps) {
  const [rect, setRect] = useState<Rect>({
    x: 150,
    y: 80,
    width: 1 * SCALE,
    height: 1 * SCALE,
  })
  const [pairs, setPairs] = useState<PairDef[]>([
    {
      entry: { edge: "left", t: 0.3, layers: [0] },
      exit: { edge: "right", t: 0.3, layers: [0] },
    },
    {
      entry: { edge: "top", t: 0.5, layers: [1, 2] },
      exit: { edge: "bottom", t: 0.5, layers: [1] },
    },
  ])
  const [addMode, setAddMode] = useState<"entry" | "exit" | null>(null)
  const [pendingEntry, setPendingEntry] = useState<PointDef | null>(null)
  const [dragging, setDragging] = useState<DraggingState | null>(null)
  const [dragStart, setDragStart] = useState<DragStartState | null>(null)
  const [selected, setSelected] = useState<SelectionState | null>(null)
  const [layerInput, setLayerInput] = useState("")
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)
  // Via state: UI-only for visualization/diagnostics. Not fed into actual solver.
  // These allow manual via placement to verify solvability predictions visually.
  const [viaMode, setViaMode] = useState(false)
  const [vias, setVias] = useState<Array<{ x: number; y: number }>>([])
  // viaDiameter: used for both visualization AND isHighDensityNodeSolvable diagnostics
  const [viaDiameter, setViaDiameter] = useState(0.3)
  // traceWidth: default from HighDensitySolver (0.15mm)
  const traceWidth = 0.15

  // Initialize from initialNode
  useEffect(() => {
    if (initialNode) {
      // 1. Set Rect
      // Center the node in screen (assuming typical screen offset or centering)
      // We'll keep x, y at 150, 80 default offset for now, or assume node center was 0,0
      // If we want to center on screen:
      const screenCenterX = 150 + (1 * SCALE) / 2 // Default center X
      const screenCenterY = 80 + (1 * SCALE) / 2 // Default center Y

      const newWidth = initialNode.width * SCALE
      const newHeight = initialNode.height * SCALE

      const newRect = {
        x: screenCenterX - newWidth / 2,
        y: screenCenterY - newHeight / 2,
        width: newWidth,
        height: newHeight,
      }

      setRect(newRect)

      // 2. Set Pairs
      // Group ports by connectionName
      const groupedPorts: Record<string, typeof initialNode.portPoints> = {}
      initialNode.portPoints.forEach((p) => {
        if (!groupedPorts[p.connectionName]) groupedPorts[p.connectionName] = []
        groupedPorts[p.connectionName].push(p)
      })

      const newPairs: PairDef[] = []
      Object.values(groupedPorts).forEach((ports) => {
        if (ports.length >= 2) {
          // Naive pairing: first is entry, second is exit.
          // If > 2, we might need multiple pairs or advanced logic.
          // Assuming pairs for now.
          const entryPort = ports[0]
          const exitPort = ports[1] // Or find furthest?

          // Helper to find edge/t
          const mapPortToEditorPoint = (
            p: (typeof initialNode.portPoints)[0],
          ): PointDef => {
            const halfW = initialNode.width / 2
            const halfH = initialNode.height / 2
            // Convert absolute coordinates to relative to node center
            // Assuming initialNode.center is present and valid
            const centerX = initialNode.center?.x ?? 0
            const centerY = initialNode.center?.y ?? 0
            const px = p.x - centerX
            const py = p.y - centerY
            const EPS = 1e-6 // Tolerance for floating point comparisons

            let edge: Edge = "top"
            let t = 0.5

            if (Math.abs(py + halfH) < EPS) {
              // Top edge (-y)
              edge = "top"
              t = (px + halfW) / initialNode.width
            } else if (Math.abs(py - halfH) < EPS) {
              // Bottom edge (+y)
              edge = "bottom"
              t = (px + halfW) / initialNode.width
            } else if (Math.abs(px + halfW) < EPS) {
              // Left edge (-x)
              edge = "left"
              t = (py + halfH) / initialNode.height
            } else if (Math.abs(px - halfW) < EPS) {
              // Right edge (+x)
              edge = "right"
              t = (py + halfH) / initialNode.height
            } else {
              // Fallback: project to nearest edge if not perfectly aligned
              // This is a simplification. Real projection logic would be better.
              // Just snapping to nearest edge logic:
              const distTop = Math.abs(py + halfH)
              const distBottom = Math.abs(py - halfH)
              const distLeft = Math.abs(px + halfW)
              const distRight = Math.abs(px - halfW)
              const minDist = Math.min(distTop, distBottom, distLeft, distRight)

              if (minDist === distTop) {
                edge = "top"
                t = (px + halfW) / initialNode.width
              } else if (minDist === distBottom) {
                edge = "bottom"
                t = (px + halfW) / initialNode.width
              } else if (minDist === distLeft) {
                edge = "left"
                t = (py + halfH) / initialNode.height
              } else {
                edge = "right"
                t = (py + halfH) / initialNode.height
              }
            }

            // Clamp t
            t = Math.max(0.05, Math.min(0.95, t))

            return { edge, t, layers: [p.z], portPointId: p.portPointId } // Single layer per port, can merge if multiples exist at same pos
          }

          const entryDef = mapPortToEditorPoint(entryPort)
          const exitDef = mapPortToEditorPoint(exitPort)

          // Merge layers if other ports share same pos?
          // For now, simple mapping.

          newPairs.push({ entry: entryDef, exit: exitDef })
        }
      })

      if (newPairs.length > 0) {
        setPairs(newPairs)
      }
    }
  }, []) // Run once on mount (or when initialNode changes? User might want to reset)

  // Sync state to parent
  useEffect(() => {
    if (!onNodeChange) return

    // Convert internal state to NodeWithPortPoints
    const width = rect.width / SCALE
    const height = rect.height / SCALE
    // const center = { x: 0, y: 0 };

    const svgCenterX = rect.x + rect.width / 2
    const svgCenterY = rect.y + rect.height / 2

    const portPoints = pairs.flatMap((pair, i) => {
      const entryPos = getPointOnEdge(pair.entry.edge, pair.entry.t, rect)
      const exitPos = getPointOnEdge(pair.exit.edge, pair.exit.t, rect)

      // Convert to node-relative coordinates (mm)
      const entryX = (entryPos.x - svgCenterX) / SCALE
      const entryY = (entryPos.y - svgCenterY) / SCALE
      const exitX = (exitPos.x - svgCenterX) / SCALE
      const exitY = (exitPos.y - svgCenterY) / SCALE

      const entryPorts = pair.entry.layers.map((layer) => ({
        x: entryX,
        y: entryY,
        z: layer,
        connectionName: `pair_${i}`,
      }))

      const exitPorts = pair.exit.layers.map((layer) => ({
        x: exitX,
        y: exitY,
        z: layer,
        connectionName: `pair_${i}`,
      }))

      return [...entryPorts, ...exitPorts]
    })

    onNodeChange({
      capacityMeshNodeId: "interactive-node",
      center: { x: 0, y: 0 },
      width,
      height,
      portPoints,
    })
  }, [rect, pairs])

  useEffect(() => {
    if (selected) {
      const point = pairs[selected.pairIndex]?.[selected.pointType]
      if (point) setLayerInput(point.layers.join(","))
    }
  }, [selected, pairs])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, type: "resize", data: any) => {
      e.stopPropagation()
      const svg = e.currentTarget.closest("svg")
      if (!svg) return
      const svgRect = svg.getBoundingClientRect()
      const mx = e.clientX - svgRect.left
      const my = e.clientY - svgRect.top
      setDragging({ type, data })
      setDragStart({ mx, my, rect: { ...rect } })
    },
    [rect],
  )

  const handlePointMouseDown = useCallback(
    (e: React.MouseEvent, pairIndex: number, pointType: "entry" | "exit") => {
      e.stopPropagation()
      setDragging({ type: "point", data: { pairIndex, pointType } })
    },
    [],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return
      const svgRect = e.currentTarget.getBoundingClientRect()
      const mx = e.clientX - svgRect.left
      const my = e.clientY - svgRect.top

      if (dragging.type === "pan" && dragStart) {
        const dx = mx - dragStart.mx
        const dy = my - dragStart.my
        setPanOffset({ x: (dragStart.x ?? 0) + dx, y: (dragStart.y ?? 0) + dy })
      } else if (dragging.type === "resize" && dragStart) {
        const dx = mx - dragStart.mx
        const dy = my - dragStart.my
        const { rect: startRect } = dragStart
        const { handle } = dragging.data
        const newRect = { ...startRect }
        const minSize = 0.2 * SCALE

        if (handle.includes("left")) {
          const newWidth = Math.max(minSize, startRect.width - dx)
          newRect.x = startRect.x + startRect.width - newWidth
          newRect.width = newWidth
        }
        if (handle.includes("right"))
          newRect.width = Math.max(minSize, startRect.width + dx)
        if (handle.includes("top")) {
          const newHeight = Math.max(minSize, startRect.height - dy)
          newRect.y = startRect.y + startRect.height - newHeight
          newRect.height = newHeight
        }
        if (handle.includes("bottom"))
          newRect.height = Math.max(minSize, startRect.height + dy)
        setRect(newRect)
      } else if (dragging.type === "point") {
        const { pairIndex, pointType } = dragging.data
        const point = pairs[pairIndex][pointType]
        const newT = getTFromMouseOnEdge(
          mx - panOffset.x,
          my - panOffset.y,
          point.edge,
          rect,
        )
        setPairs((prev) =>
          prev.map((pair, i) => {
            if (i !== pairIndex) return pair
            return { ...pair, [pointType]: { ...pair[pointType], t: newT } }
          }),
        )
      }
    },
    [dragging, dragStart, pairs, rect],
  )

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (dragging?.type === "point") {
        const { pairIndex, pointType } = dragging.data
        setSelected({ pairIndex, pointType })
      }
      setDragging(null)
      setDragStart(null)
    },
    [dragging],
  )

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (viaMode) {
        const svgRect = e.currentTarget.getBoundingClientRect()
        const mx = e.clientX - svgRect.left
        const my = e.clientY - svgRect.top
        // Store via in absolute SVG coordinates (affected by pan)
        setVias((prev) => [
          ...prev,
          { x: mx - panOffset.x, y: my - panOffset.y },
        ])
        return
      }

      if (addMode) {
        const svgRect = e.currentTarget.getBoundingClientRect()
        const mx = e.clientX - svgRect.left
        const my = e.clientY - svgRect.top
        const edgeInfo = findEdgeAndT(mx - panOffset.x, my - panOffset.y, rect)
        if (!edgeInfo) return

        if (addMode === "entry") {
          setPendingEntry({ edge: edgeInfo.edge, t: edgeInfo.t, layers: [0] })
          setAddMode("exit")
        } else if (addMode === "exit" && pendingEntry) {
          setPairs((prev) => [
            ...prev,
            {
              entry: pendingEntry,
              exit: { edge: edgeInfo.edge, t: edgeInfo.t, layers: [0] },
            },
          ])
          setPendingEntry(null)
          setAddMode(null)
        }
      } else {
        setSelected(null)
      }
    },
    [addMode, pendingEntry, rect, panOffset, viaMode],
  )

  const handlePointClick = useCallback(
    (e: React.MouseEvent, pairIndex: number, pointType: "entry" | "exit") => {
      e.stopPropagation()
      setSelected({ pairIndex, pointType })
    },
    [],
  )

  const commitLayers = useCallback(() => {
    if (!selected) return
    const layers = parseLayers(layerInput)
    if (layers.length === 0) return
    setPairs((prev) =>
      prev.map((pair, i) => {
        if (i !== selected.pairIndex) return pair
        return {
          ...pair,
          [selected.pointType]: { ...pair[selected.pointType], layers },
        }
      }),
    )
  }, [selected, layerInput])

  const deletePair = useCallback(
    (index: number) => {
      setPairs((prev) => prev.filter((_, i) => i !== index))
      if (selected?.pairIndex === index) setSelected(null)
    },
    [selected],
  )

  const handles = [
    { name: "top-left", x: rect.x, y: rect.y },
    { name: "top-right", x: rect.x + rect.width, y: rect.y },
    { name: "bottom-left", x: rect.x, y: rect.y + rect.height },
    { name: "bottom-right", x: rect.x + rect.width, y: rect.y + rect.height },
    { name: "top", x: rect.x + rect.width / 2, y: rect.y },
    { name: "bottom", x: rect.x + rect.width / 2, y: rect.y + rect.height },
    { name: "left", x: rect.x, y: rect.y + rect.height / 2 },
    { name: "right", x: rect.x + rect.width, y: rect.y + rect.height / 2 },
  ]

  const widthMm = (rect.width / SCALE).toFixed(2)
  const heightMm = (rect.height / SCALE).toFixed(2)
  const selectedPoint = selected
    ? pairs[selected.pairIndex]?.[selected.pointType]
    : null

  const solverGraphics = useMemo(() => {
    if (!solver) return null
    return solver.visualize()
  }, [solver])

  // Calculate metrics
  const metrics = useMemo(() => {
    const widthMm = rect.width / SCALE
    const heightMm = rect.height / SCALE

    const mockNode: any = {
      width: Math.min(widthMm, heightMm),
      _containsTarget: false,
    }

    const svgCenterX = rect.x + rect.width / 2
    const svgCenterY = rect.y + rect.height / 2
    const portPoints = pairs.flatMap((pair, i) => {
      const entryPos = getPointOnEdge(pair.entry.edge, pair.entry.t, rect)
      const exitPos = getPointOnEdge(pair.exit.edge, pair.exit.t, rect)
      const entryX = (entryPos.x - svgCenterX) / SCALE
      const entryY = (entryPos.y - svgCenterY) / SCALE
      const exitX = (exitPos.x - svgCenterX) / SCALE
      const exitY = (exitPos.y - svgCenterY) / SCALE
      const entryPorts = pair.entry.layers.map((layer) => ({
        x: entryX,
        y: entryY,
        z: layer,
        connectionName: `pair_${i}`,
      }))
      const exitPorts = pair.exit.layers.map((layer) => ({
        x: exitX,
        y: exitY,
        z: layer,
        connectionName: `pair_${i}`,
      }))
      return [...entryPorts, ...exitPorts]
    })

    const nodeForCheck: NodeWithPortPoints = {
      capacityMeshNodeId: "interactive-node",
      center: { x: 0, y: 0 },
      width: widthMm,
      height: heightMm,
      portPoints,
    }

    const diagnostics = getIntraNodeCrossings(nodeForCheck)
    const probabilityOfFailure = calculateNodeProbabilityOfFailure(
      mockNode,
      diagnostics.numSameLayerCrossings,
      diagnostics.numEntryExitLayerChanges,
      diagnostics.numTransitionPairCrossings,
    )

    return {
      ...diagnostics,
      probabilityOfFailure,
    }
  }, [pairs, rect, viaDiameter, initialNode])

  // Transform solver coordinates to SVG coordinates
  const svgCenterX = rect.x + rect.width / 2
  const svgCenterY = rect.y + rect.height / 2
  const solverToSvg = (x: number, y: number) => ({
    x: svgCenterX + x * SCALE,
    y: svgCenterY + y * SCALE,
  })

  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <div className="p-3 bg-gray-800 flex gap-4 items-center flex-wrap">
        <button
          onClick={() => {
            setAddMode(addMode ? null : "entry")
            setPendingEntry(null)
            setSelected(null)
            setViaMode(false)
          }}
          className={`px-4 py-2 rounded font-medium ${addMode ? "bg-green-600" : "bg-blue-600 hover:bg-blue-700"}`}
        >
          {addMode === "entry"
            ? "Click edge for ENTRY"
            : addMode === "exit"
              ? "Click edge for EXIT"
              : "Add Pair"}
        </button>
        <button
          onClick={() => {
            setViaMode(!viaMode)
            setAddMode(null)
            setPendingEntry(null)
            setSelected(null)
          }}
          className={`px-4 py-2 rounded font-medium ${viaMode ? "bg-green-600" : "bg-purple-600 hover:bg-purple-700"}`}
        >
          {viaMode ? "Click inside rect to place via" : "Place Via"}{" "}
          <span className="text-xs opacity-70">(purely visual)</span>
        </button>
        {(addMode || viaMode) && (
          <button
            onClick={() => {
              setAddMode(null)
              setPendingEntry(null)
              setViaMode(false)
            }}
            className="px-4 py-2 rounded bg-red-600 hover:bg-red-700"
          >
            Cancel
          </button>
        )}
        {viaMode && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-400">Via Diameter (mm):</label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={viaDiameter}
              onChange={(e) => setViaDiameter(Number(e.target.value))}
              className="w-20 px-2 py-1 rounded bg-gray-700 border border-gray-600 text-sm"
            />
          </div>
        )}
        <div className="text-sm text-gray-400">
          Drag points along edges • Click to select • Drag handles to resize
        </div>
        <div className="flex gap-2 ml-auto">
          {Object.entries(LAYER_COLORS).map(([layer, color]) => (
            <div key={layer} className="flex items-center gap-1">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs">z={layer}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <svg
          ref={svgRef}
          className="flex-1 bg-gray-950"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleSvgClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              handleSvgClick(e as unknown as React.MouseEvent<SVGSVGElement>)
            }
          }}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              const svgRect = e.currentTarget.getBoundingClientRect()
              const mx = e.clientX - svgRect.left
              const my = e.clientY - svgRect.top
              setDragging({ type: "pan", data: {} })
              setDragStart({ mx, my, rect, x: panOffset.x, y: panOffset.y })
            }
          }}
        >
          <title>Capacity Node Editor Canvas</title>
          <defs>
            <pattern
              id="grid"
              width="20"
              height="20"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 20 0 L 0 0 0 20"
                fill="none"
                stroke="#333"
                strokeWidth="0.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          <g transform={`translate(${panOffset.x}, ${panOffset.y})`}>
            {/* Size label */}
            <text
              x={rect.x}
              y={rect.y - 10}
              fill="#94a3b8"
              fontSize="12"
              fontFamily="monospace"
            >
              {widthMm}x{heightMm}mm
            </text>

            <rect
              x={rect.x}
              y={rect.y}
              width={rect.width}
              height={rect.height}
              fill="#1e293b"
              stroke={addMode ? "#22c55e" : "#60a5fa"}
              strokeWidth={addMode ? 3 : 2}
            />

            {pairs.map((pair, i) => {
              const entryPos = getPointOnEdge(
                pair.entry.edge,
                pair.entry.t,
                rect,
              )
              const exitPos = getPointOnEdge(pair.exit.edge, pair.exit.t, rect)
              return (
                <line
                  key={`line-${i}`}
                  x1={entryPos.x}
                  y1={entryPos.y}
                  x2={exitPos.x}
                  y2={exitPos.y}
                  stroke="#94a3b8"
                  strokeWidth={2}
                  strokeDasharray="6,4"
                />
              )
            })}

            {/* Render Solver Results */}
            {solverGraphics && (
              <g>
                {solverGraphics.rects?.map((gRect, i) => {
                  const p = solverToSvg(
                    gRect.center.x - gRect.width / 2,
                    gRect.center.y - gRect.height / 2,
                  )
                  const w = gRect.width * SCALE
                  const h = gRect.height * SCALE
                  return (
                    <rect
                      key={`s-rect-${i}`}
                      x={p.x}
                      y={p.y}
                      width={w}
                      height={h}
                      fill={gRect.fill || "transparent"}
                      stroke={gRect.stroke || "none"}
                      strokeWidth={1}
                    />
                  )
                })}
                {solverGraphics.lines?.map((gLine, i) => {
                  const d = gLine.points
                    .map((p, j) => {
                      const svgP = solverToSvg(p.x, p.y)
                      return j === 0
                        ? `M ${svgP.x} ${svgP.y}`
                        : `L ${svgP.x} ${svgP.y}`
                    })
                    .join(" ")
                  return (
                    <path
                      key={`s-line-${i}`}
                      d={d}
                      fill="none"
                      stroke={gLine.strokeColor || "black"}
                      strokeWidth={(gLine.strokeWidth || 0.1) * SCALE}
                    />
                  )
                })}
                {solverGraphics.points?.map((gPoint, i) => {
                  const svgP = solverToSvg(gPoint.x, gPoint.y)
                  return (
                    <circle
                      key={`s-point-${i}`}
                      cx={svgP.x}
                      cy={svgP.y}
                      r={3}
                      fill={gPoint.color || "black"}
                    />
                  )
                })}
              </g>
            )}

            {pendingEntry && (
              <circle
                cx={getPointOnEdge(pendingEntry.edge, pendingEntry.t, rect).x}
                cy={getPointOnEdge(pendingEntry.edge, pendingEntry.t, rect).y}
                r={12}
                fill={LAYER_COLORS[0]}
                stroke="#fff"
                strokeWidth={2}
                strokeDasharray="4,2"
              />
            )}

            {pairs.map((pair, i) => (
              <g key={`pair-${i}`}>
                <PortPoint
                  pointDef={pair.entry}
                  rect={rect}
                  pairIndex={i}
                  pointType="entry"
                  selected={selected}
                  onMouseDown={handlePointMouseDown}
                  onClick={handlePointClick}
                />
                <PortPoint
                  pointDef={pair.exit}
                  rect={rect}
                  pairIndex={i}
                  pointType="exit"
                  selected={selected}
                  onMouseDown={handlePointMouseDown}
                  onClick={handlePointClick}
                />
              </g>
            ))}

            {/* Render placed vias - independent of rect */}
            {vias.map((via, i) => (
              <circle
                key={`via-${i}`}
                cx={via.x}
                cy={via.y}
                r={(viaDiameter / 2) * SCALE}
                fill="silver"
                stroke="#fff"
                strokeWidth={1}
                opacity={0.7}
              />
            ))}

            {handles.map((handle) => (
              <rect
                key={handle.name}
                x={handle.x - 5}
                y={handle.y - 5}
                width={10}
                height={10}
                fill="#3b82f6"
                stroke="#fff"
                strokeWidth={1}
                style={{ cursor: "pointer" }}
                onMouseDown={(e) =>
                  handleMouseDown(e, "resize", { handle: handle.name })
                }
              />
            ))}
          </g>

          {/* Metrics Card - Fixed position at top-left */}
          <MetricsCard
            numEntryExitLayerChanges={metrics.numEntryExitLayerChanges}
            numSameLayerCrossings={metrics.numSameLayerCrossings}
            numTransitionPairCrossings={metrics.numTransitionPairCrossings}
            probabilityOfFailure={metrics.probabilityOfFailure}
          />
        </svg>

        {selectedPoint && selected && (
          <div className="w-64 bg-gray-800 p-4 border-l border-gray-700">
            <div className="text-sm font-medium mb-3">Edit Point</div>
            <div className="mb-3">
              <div className="text-xs text-gray-400 mb-1">Type</div>
              <div className="text-sm capitalize">{selected.pointType}</div>
            </div>
            <div className="mb-3">
              <div className="text-xs text-gray-400 mb-1">Edge</div>
              <div className="text-sm capitalize">{selectedPoint.edge}</div>
            </div>
            <div className="mb-3">
              <div className="text-xs text-gray-400 mb-1">Port Point</div>
              <div className="text-sm">
                {selectedPoint.portPointId ?? "no portid found"}
              </div>
            </div>
            <div className="mb-3">
              <div className="text-xs text-gray-400 mb-1">Position</div>
              <div className="text-sm">
                {(selectedPoint.t * 100).toFixed(0)}%
              </div>
            </div>
            <div className="mb-3">
              <div className="text-xs text-gray-400 mb-2">
                Layers (comma-separated: 0,1,2,3)
              </div>
              <input
                type="text"
                className="w-full bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
                value={layerInput}
                onChange={(e) => setLayerInput(e.target.value)}
                onBlur={commitLayers}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitLayers()
                }}
              />
              <div className="flex gap-1 mt-2">
                {[0, 1, 2, 3].map((l) => (
                  <div
                    key={l}
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs
                    ${selectedPoint.layers.includes(l) ? "" : "opacity-30"}`}
                    style={{ backgroundColor: LAYER_COLORS[l] }}
                  >
                    {l}
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="w-full mt-2 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              Close
            </button>
          </div>
        )}
      </div>

      <div className="p-3 bg-gray-800 max-h-32 overflow-auto border-t border-gray-700">
        <div className="flex justify-between items-center mb-2">
          <div className="text-sm font-medium">Pairs ({pairs.length})</div>
          <div className="text-sm font-medium">Vias ({vias.length})</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {pairs.map((pair, i) => (
            <div
              key={i}
              className="bg-gray-700 px-3 py-1 rounded text-xs flex items-center gap-2"
            >
              <span className="flex gap-0.5">
                {pair.entry.layers.map((l) => (
                  <span key={l} style={{ color: LAYER_COLORS[l] }}>
                    ●
                  </span>
                ))}
              </span>
              {pair.entry.edge}→{pair.exit.edge}
              <span className="flex gap-0.5">
                {pair.exit.layers.map((l) => (
                  <span key={l} style={{ color: LAYER_COLORS[l] }}>
                    ●
                  </span>
                ))}
              </span>
              <button
                onClick={() => deletePair(i)}
                className="text-red-400 hover:text-red-300 ml-1"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
