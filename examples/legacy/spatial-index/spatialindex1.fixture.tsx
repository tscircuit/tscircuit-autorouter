import { useState, useEffect, useRef, useMemo } from "react"
import {
  HighDensityRouteSpatialIndex,
  HighDensityRoute,
} from "lib/data-structures/HighDensityRouteSpatialIndex"

// Constants for display and calculation
const CANVAS_WIDTH = 800
const CANVAS_HEIGHT = 600
const BOARD_WIDTH = 10 // 10mm board width
const BOARD_HEIGHT = 7.5 // 7.5mm board height
const TRACE_WIDTH = 0.15
const MARGIN = 0.1
const VIA_DIAMETER = 0.6
const SCALE = CANVAS_WIDTH / BOARD_WIDTH // Scale factor to convert mm to pixels

// Create example routes for testing
const createSampleRoutes = (): HighDensityRoute[] => {
  // Create a few sample routes with different paths and vias
  const routes: HighDensityRoute[] = [
    {
      connectionName: "route1",
      traceThickness: TRACE_WIDTH,
      viaDiameter: VIA_DIAMETER,
      route: [
        { x: 2, y: 1, z: 0 },
        { x: 4, y: 1, z: 0 },
        { x: 4, y: 3, z: 0 },
        { x: 6, y: 3, z: 0 },
      ],
      vias: [
        { x: 4, y: 1 },
        { x: 6, y: 3 },
      ],
    },
    {
      connectionName: "route2",
      traceThickness: TRACE_WIDTH,
      viaDiameter: VIA_DIAMETER,
      route: [
        { x: 7, y: 1, z: 0 },
        { x: 7, y: 6, z: 0 },
        { x: 3, y: 6, z: 0 },
      ],
      vias: [
        { x: 7, y: 1 },
        { x: 3, y: 6 },
      ],
    },
    {
      connectionName: "route3",
      traceThickness: TRACE_WIDTH,
      viaDiameter: VIA_DIAMETER,
      route: [
        { x: 1, y: 4, z: 0 },
        { x: 8, y: 4, z: 0 },
      ],
      vias: [
        { x: 1, y: 4 },
        { x: 8, y: 4 },
      ],
    },
  ]

  return routes
}

// Canvas Drawing Utilities
const drawBoard = (ctx: CanvasRenderingContext2D) => {
  ctx.fillStyle = "#f0f0f0"
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

  // Draw grid lines (1mm spacing)
  ctx.strokeStyle = "#e0e0e0"
  ctx.lineWidth = 1

  // Vertical grid lines
  for (let x = 0; x <= BOARD_WIDTH; x++) {
    const xPos = x * SCALE
    ctx.beginPath()
    ctx.moveTo(xPos, 0)
    ctx.lineTo(xPos, CANVAS_HEIGHT)
    ctx.stroke()
  }

  // Horizontal grid lines
  for (let y = 0; y <= BOARD_HEIGHT; y++) {
    const yPos = y * SCALE
    ctx.beginPath()
    ctx.moveTo(0, yPos)
    ctx.lineTo(CANVAS_WIDTH, yPos)
    ctx.stroke()
  }
}

const drawRoutes = (
  ctx: CanvasRenderingContext2D,
  routes: HighDensityRoute[],
) => {
  // Draw each route with a different color
  const colors = ["#3498db", "#e74c3c", "#2ecc71", "#f39c12", "#9b59b6"]

  routes.forEach((route, index) => {
    const color = colors[index % colors.length]
    ctx.strokeStyle = color
    ctx.lineWidth = route.traceThickness * SCALE

    // Draw route segments
    if (route.route.length >= 2) {
      ctx.beginPath()
      const start = route.route[0]
      ctx.moveTo(start.x * SCALE, start.y * SCALE)

      for (let i = 1; i < route.route.length; i++) {
        const point = route.route[i]
        ctx.lineTo(point.x * SCALE, point.y * SCALE)
      }

      ctx.stroke()
    }

    // Draw vias
    ctx.fillStyle = color
    route.vias.forEach((via) => {
      ctx.beginPath()
      ctx.arc(
        via.x * SCALE,
        via.y * SCALE,
        (route.viaDiameter / 2) * SCALE,
        0,
        Math.PI * 2,
      )
      ctx.fill()
    })
  })
}

const drawSegment = (
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) => {
  ctx.strokeStyle = "#000000"
  ctx.lineWidth = 2

  ctx.beginPath()
  ctx.moveTo(startX * SCALE, startY * SCALE)
  ctx.lineTo(endX * SCALE, endY * SCALE)
  ctx.stroke()

  // Draw small circles at the endpoints
  ctx.fillStyle = "#000000"
  ctx.beginPath()
  ctx.arc(startX * SCALE, startY * SCALE, 5, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = "#000000"
  ctx.beginPath()
  ctx.arc(endX * SCALE, endY * SCALE, 5, 0, Math.PI * 2)
  ctx.fill()
}

const drawPoint = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
  ctx.fillStyle = "#FF00FF"
  ctx.beginPath()
  ctx.arc(x * SCALE, y * SCALE, 5, 0, Math.PI * 2)
  ctx.fill()
}

// Component for test fixture
export default () => {
  // Create refs and state
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDraggingA, setIsDraggingA] = useState(false)
  const [isDraggingB, setIsDraggingB] = useState(false)
  const [isDraggingC, setIsDraggingC] = useState(false)
  const [pointA, setPointA] = useState({ x: 2, y: 2, z: 0 })
  const [pointB, setPointB] = useState({ x: 5, y: 3, z: 0 })
  const [pointC, setPointC] = useState({ x: 3, y: 5, z: 0 })
  const [conflicts, setConflicts] = useState<
    Array<{ conflictingRoute: HighDensityRoute; distance: number }>
  >([])
  const [testingMode, setTestingMode] = useState<"segment" | "point">("segment")

  // Create sample routes and spatial index
  const routes = useMemo(() => createSampleRoutes(), [])
  const spatialIndex = useMemo(
    () => new HighDensityRouteSpatialIndex(routes, 0.5),
    [routes],
  )

  // Update canvas when points change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Clear canvas and draw board
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
    drawBoard(ctx)

    // Draw existing routes
    drawRoutes(ctx, routes)

    // Draw test segment and point
    if (testingMode === "segment") {
      drawSegment(ctx, pointA.x, pointA.y, pointB.x, pointB.y)

      // Calculate and set conflict results
      const segmentConflicts = spatialIndex.getConflictingRoutesForSegment(
        pointA,
        pointB,
        MARGIN,
      )
      setConflicts(segmentConflicts)
    } else {
      drawPoint(ctx, pointC.x, pointC.y)

      // Calculate and set conflict results
      const pointConflicts = spatialIndex.getConflictingRoutesNearPoint(
        pointC,
        MARGIN,
      )
      setConflicts(pointConflicts)
    }

    // Draw conflict visualization
    if (conflicts.length > 0) {
      conflicts.forEach((conflict) => {
        ctx.strokeStyle = "rgba(255, 0, 0, 0.3)"
        ctx.lineWidth =
          (conflict.conflictingRoute.traceThickness + MARGIN * 2) * SCALE

        // Highlight conflicting route segments
        if (conflict.conflictingRoute.route.length >= 2) {
          ctx.beginPath()
          const start = conflict.conflictingRoute.route[0]
          ctx.moveTo(start.x * SCALE, start.y * SCALE)

          for (let i = 1; i < conflict.conflictingRoute.route.length; i++) {
            const point = conflict.conflictingRoute.route[i]
            ctx.lineTo(point.x * SCALE, point.y * SCALE)
          }

          ctx.stroke()
        }

        // Highlight conflicting vias
        conflict.conflictingRoute.vias.forEach((via) => {
          ctx.fillStyle = "rgba(255, 0, 0, 0.3)"
          ctx.beginPath()
          ctx.arc(
            via.x * SCALE,
            via.y * SCALE,
            (conflict.conflictingRoute.viaDiameter / 2 + MARGIN) * SCALE,
            0,
            Math.PI * 2,
          )
          ctx.fill()
        })
      })
    }
  }, [pointA, pointB, pointC, routes, spatialIndex, conflicts, testingMode])

  // Mouse event handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / SCALE
    const y = (e.clientY - rect.top) / SCALE

    // Calculate distances to points
    const distToA = Math.sqrt(
      Math.pow(x - pointA.x, 2) + Math.pow(y - pointA.y, 2),
    )
    const distToB = Math.sqrt(
      Math.pow(x - pointB.x, 2) + Math.pow(y - pointB.y, 2),
    )
    const distToC = Math.sqrt(
      Math.pow(x - pointC.x, 2) + Math.pow(y - pointC.y, 2),
    )

    const threshold = 0.5 // Drag threshold in mm

    // Determine which point to drag (if any)
    if (distToA < threshold) {
      setIsDraggingA(true)
    } else if (distToB < threshold) {
      setIsDraggingB(true)
    } else if (distToC < threshold) {
      setIsDraggingC(true)
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingA && !isDraggingB && !isDraggingC) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / SCALE
    const y = (e.clientY - rect.top) / SCALE

    // Update the appropriate point
    if (isDraggingA) {
      setPointA({ x, y, z: 0 })
    } else if (isDraggingB) {
      setPointB({ x, y, z: 0 })
    } else if (isDraggingC) {
      setPointC({ x, y, z: 0 })
    }
  }

  const handleMouseUp = () => {
    setIsDraggingA(false)
    setIsDraggingB(false)
    setIsDraggingC(false)
  }

  const toggleTestingMode = () => {
    setTestingMode((prev) => (prev === "segment" ? "point" : "segment"))
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">
        HighDensityRouteSpatialIndex Testing
      </h1>

      <div className="mb-4">
        <p className="text-sm mb-2">
          Drag points A and B to test segment conflicts, or point C to test
          point conflicts. Current mode:{" "}
          <strong>
            {testingMode === "segment" ? "Segment Testing" : "Point Testing"}
          </strong>
        </p>
        <button
          className="bg-blue-500 text-white px-3 py-1 rounded"
          onClick={toggleTestingMode}
        >
          Switch to {testingMode === "segment" ? "Point" : "Segment"} Testing
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <div className="border border-gray-300 rounded">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className="cursor-pointer"
          />
        </div>

        <div className="flex-1">
          <h2 className="text-xl font-bold mb-2">Conflict Results</h2>
          <div className="border border-gray-300 rounded p-4 bg-gray-50 h-[400px] overflow-auto">
            <p className="mb-2 font-semibold">
              Testing: {testingMode === "segment" ? "Segment A→B" : "Point C"}
            </p>
            <p className="mb-2 text-sm">
              {testingMode === "segment"
                ? `A(${pointA.x.toFixed(2)}, ${pointA.y.toFixed(2)}) → B(${pointB.x.toFixed(2)}, ${pointB.y.toFixed(2)})`
                : `C(${pointC.x.toFixed(2)}, ${pointC.y.toFixed(2)})`}
            </p>

            <p className="font-semibold">
              {conflicts.length === 0
                ? "No conflicts found"
                : `Found ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}`}
            </p>

            {conflicts.map((conflict, index) => (
              <div key={index} className="mt-3 p-2 border-t border-gray-300">
                <p>
                  <strong>Route:</strong>{" "}
                  {conflict.conflictingRoute.connectionName}
                </p>
                <p>
                  <strong>Distance:</strong> {conflict.distance.toFixed(4)}mm
                </p>
                <p>
                  <strong>Trace Width:</strong>{" "}
                  {conflict.conflictingRoute.traceThickness}mm
                </p>
                <p>
                  <strong>Via Diameter:</strong>{" "}
                  {conflict.conflictingRoute.viaDiameter}mm
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 p-3 bg-gray-100 rounded text-sm">
            <p>
              <strong>Parameters:</strong>
            </p>
            <ul className="list-disc pl-5">
              <li>Trace Width: {TRACE_WIDTH}mm</li>
              <li>Via Diameter: {VIA_DIAMETER}mm</li>
              <li>Margin: {MARGIN}mm</li>
              <li>
                Board Size: {BOARD_WIDTH}mm × {BOARD_HEIGHT}mm
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
