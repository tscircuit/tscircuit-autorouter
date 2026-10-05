import { useState, useRef, useEffect } from "react"
import { computeDumbbellPaths } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/computeDumbbellPaths"

interface Point {
  x: number
  y: number
  z?: number
  connectionName?: string
}

interface DumbbellDebuggerProps {
  A?: Point
  B?: Point
  C?: Point
  D?: Point
  E?: Point
  F?: Point
  radius?: number
  margin?: number
  subdivisions?: number
}

export const DumbbellDebugger = ({
  A = { x: 150, y: 250 },
  B = { x: 350, y: 250 },
  C = { x: 100, y: 100 },
  D = { x: 500, y: 100 },
  E = { x: 309, y: 106 },
  F = { x: 500, y: 400 },
  radius: initialRadius = 30,
  margin: initialMargin = 15,
  subdivisions: initialSubdivisions = 1,
}: DumbbellDebuggerProps) => {
  // State for points and parameters, initialized from props
  const [pointA, setPointA] = useState<Point>(A)
  const [pointB, setPointB] = useState<Point>(B)
  const [pointC, setPointC] = useState<Point>(C)
  const [pointD, setPointD] = useState<Point>(D)
  const [pointE, setPointE] = useState<Point>(E)
  const [pointF, setPointF] = useState<Point>(F)
  const [radius, setRadius] = useState(initialRadius)
  const [margin, setMargin] = useState(initialMargin)
  const [subdivisions, setSubdivisions] = useState(initialSubdivisions)

  // State for UI controls
  const [dragging, setDragging] = useState<{
    name: string
    setter: React.Dispatch<React.SetStateAction<Point>>
  } | null>(null)
  const [showInnerPoints, setShowInnerPoints] = useState(true)
  const [showOuterPoints, setShowOuterPoints] = useState(false)
  const [showJPair, setShowJPair] = useState(true)
  const [showOptimalPath, setShowOptimalPath] = useState(true)
  const [showSubdivided, setShowSubdivided] = useState(true)

  // State for computation result
  const [pathResult, setPathResult] = useState<ReturnType<
    typeof computeDumbbellPaths
  > | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Compute paths whenever parameters change
  useEffect(() => {
    const result = computeDumbbellPaths({
      A: pointA,
      B: pointB,
      C: pointC,
      D: pointD,
      E: pointE,
      F: pointF,
      radius,
      margin,
      subdivisions: showSubdivided ? subdivisions : 0,
    })
    setPathResult(result)
  }, [
    pointA,
    pointB,
    pointC,
    pointD,
    pointE,
    pointF,
    radius,
    margin,
    subdivisions,
    showSubdivided,
  ])

  // Helper function to calculate dumbbell points
  const calculatePoints = (a: Point, b: Point, r: number) => {
    // Vector from A to B
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.sqrt(dx * dx + dy * dy)

    // Unit vectors
    const ux = dx / len,
      uy = dy / len
    const px = -uy,
      py = ux // Perpendicular unit vector

    return {
      midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      A_Opp: { x: a.x - ux * r, y: a.y - uy * r },
      A_Right: { x: a.x + px * r, y: a.y + py * r },
      A_Left: { x: a.x - px * r, y: a.y - py * r },
      B_Opp: { x: b.x + ux * r, y: b.y + uy * r },
      B_Right: { x: b.x + px * r, y: b.y + py * r },
      B_Left: { x: b.x - px * r, y: b.y - py * r },
    }
  }

  // Draw on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !pathResult) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Calculate inner and outer dumbbell points
    const innerPoints = calculatePoints(pointA, pointB, radius)
    const outerPoints = calculatePoints(pointA, pointB, radius + margin)

    // Draw helper function for points
    const drawPoint = (
      point: Point,
      label: string,
      color = "#000",
      size = 5,
    ) => {
      ctx.beginPath()
      ctx.arc(point.x, point.y, size, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
      ctx.fillStyle = "#000"
      ctx.font = "12px Arial"
      ctx.fillText(label, point.x + 10, point.y - 10)
    }

    // Draw main points
    drawPoint(pointA, "A", "#6495ED")
    drawPoint(pointB, "B", "#FFA500")
    drawPoint(pointC, "C", "#CC0000")
    drawPoint(pointD, "D", "#00CC00")
    drawPoint(pointE, "E", "#9900CC")
    drawPoint(pointF, "F", "#CC9900")

    // Draw line between A and B
    ctx.beginPath()
    ctx.moveTo(pointA.x, pointA.y)
    ctx.lineTo(pointB.x, pointB.y)
    ctx.strokeStyle = "#333"
    ctx.lineWidth = 2
    ctx.stroke()

    // Draw inner dumbbell circles
    // Circle A
    ctx.beginPath()
    ctx.arc(pointA.x, pointA.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(100, 149, 237, 0.3)"
    ctx.fill()
    ctx.strokeStyle = "#6495ED"
    ctx.lineWidth = 2
    ctx.stroke()

    // Circle B
    ctx.beginPath()
    ctx.arc(pointB.x, pointB.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = "rgba(255, 165, 0, 0.3)"
    ctx.fill()
    ctx.strokeStyle = "#FFA500"
    ctx.lineWidth = 2
    ctx.stroke()

    // Draw outer dumbbell circles
    // Circle A
    ctx.beginPath()
    ctx.arc(pointA.x, pointA.y, radius + margin, 0, Math.PI * 2)
    ctx.strokeStyle = "#6495ED"
    ctx.setLineDash([2, 2])
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])

    // Circle B
    ctx.beginPath()
    ctx.arc(pointB.x, pointB.y, radius + margin, 0, Math.PI * 2)
    ctx.strokeStyle = "#FFA500"
    ctx.setLineDash([2, 2])
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.setLineDash([])

    // Draw inner dumbbell calculated points
    if (showInnerPoints) {
      const drawSmallPoint = (point: Point, label: string, color: string) => {
        ctx.beginPath()
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.fillStyle = color
        ctx.font = "10px Arial"
        ctx.fillText(label, point.x + 5, point.y - 5)
      }

      drawSmallPoint(innerPoints.midpoint, "Mid", "purple")
      drawSmallPoint(innerPoints.A_Opp, "A_Opp", "red")
      drawSmallPoint(innerPoints.A_Right, "A_Right", "green")
      drawSmallPoint(innerPoints.A_Left, "A_Left", "blue")
      drawSmallPoint(innerPoints.B_Opp, "B_Opp", "red")
      drawSmallPoint(innerPoints.B_Right, "B_Right", "green")
      drawSmallPoint(innerPoints.B_Left, "B_Left", "blue")
    }

    // Draw outer dumbbell calculated points
    if (showOuterPoints) {
      const drawSmallPoint = (point: Point, label: string, color: string) => {
        ctx.beginPath()
        ctx.arc(point.x, point.y, 3, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        ctx.fillStyle = color
        ctx.font = "10px Arial"
        ctx.fillText(label, point.x + 5, point.y - 5)
      }

      drawSmallPoint(outerPoints.A_Right, "Out_A_Right", "green")
      drawSmallPoint(outerPoints.A_Left, "Out_A_Left", "blue")
      drawSmallPoint(outerPoints.A_Opp, "Out_A_Opp", "red")
      drawSmallPoint(outerPoints.B_Right, "Out_B_Right", "green")
      drawSmallPoint(outerPoints.B_Left, "Out_B_Left", "blue")
      drawSmallPoint(outerPoints.B_Opp, "Out_B_Opp", "red")
    }

    // Draw optimal path
    if (showOptimalPath && pathResult.optimalPath) {
      const { points } = pathResult.optimalPath

      if (points && points.length > 1) {
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        ctx.strokeStyle = "#0000FF"
        ctx.lineWidth = 3
        ctx.stroke()

        // Draw points on the path
        for (let i = 1; i < points.length - 1; i++) {
          const point = points[i] as Point & {
            isSpecial?: boolean
            specialType?: "A" | "B"
          }
          let color = "#0000AA"
          let size = 3

          // Special coloring for points at radius distance
          if (point.isSpecial) {
            color = point.specialType === "A" ? "#8B0000" : "#8B4500"
            size = 5

            ctx.beginPath()
            ctx.arc(point.x, point.y, size, 0, Math.PI * 2)
            ctx.fillStyle = color
            ctx.fill()
            ctx.strokeStyle = "#000"
            ctx.lineWidth = 1
            ctx.stroke()

            // Label
            ctx.font = "10px Arial"
            ctx.fillStyle = "#000"
            ctx.fillText(`R${point.specialType}`, point.x - 7, point.y - 7)
          } else {
            ctx.beginPath()
            ctx.arc(point.x, point.y, size, 0, Math.PI * 2)
            ctx.fillStyle = color
            ctx.fill()
          }
        }

        // Path info
        ctx.font = "12px Arial"
        ctx.fillStyle = "#000"
        ctx.fillText(
          `Optimal Path: S${(pathResult.optimalPath as any).index} (${pathResult.optimalPath.startsAt} → ${pathResult.optimalPath.goesTo})`,
          10,
          20,
        )

        if (showSubdivided && subdivisions > 0) {
          const specialPoints = points.filter((p: any) => p.isSpecial)
          ctx.fillText(
            `Subdivided: ${points.length} points, ${specialPoints.length} at radius distance`,
            10,
            40,
          )
        }
      }
    }

    // Draw J-pair
    if (showJPair && pathResult.jPair) {
      const { line1, line2 } = pathResult.jPair

      // Draw first J-line
      if (line1 && line1.points) {
        ctx.beginPath()
        ctx.moveTo(line1.points[0].x, line1.points[0].y)
        for (let i = 1; i < line1.points.length; i++) {
          ctx.lineTo(line1.points[i].x, line1.points[i].y)
        }
        ctx.strokeStyle = "#FF00FF" // Magenta
        ctx.lineWidth = 3
        ctx.stroke()

        // Draw waypoints
        for (let i = 1; i < line1.points.length - 1; i++) {
          ctx.beginPath()
          ctx.arc(line1.points[i].x, line1.points[i].y, 3, 0, Math.PI * 2)
          ctx.fillStyle = "#FF00FF"
          ctx.fill()
        }

        ctx.font = "12px Arial"
        ctx.fillStyle = "#000"
        ctx.fillText(
          `J-Line 1: J${line1.index} (${line1.startsAt} → ${line1.goesTo})`,
          10,
          60,
        )
      }

      // Draw second J-line
      if (line2 && line2.points) {
        ctx.beginPath()
        ctx.moveTo(line2.points[0].x, line2.points[0].y)
        for (let i = 1; i < line2.points.length; i++) {
          ctx.lineTo(line2.points[i].x, line2.points[i].y)
        }
        ctx.strokeStyle = "#00FF00" // Lime
        ctx.lineWidth = 3
        ctx.stroke()

        // Draw waypoints
        for (let i = 1; i < line2.points.length - 1; i++) {
          ctx.beginPath()
          ctx.arc(line2.points[i].x, line2.points[i].y, 3, 0, Math.PI * 2)
          ctx.fillStyle = "#00FF00"
          ctx.fill()
        }

        ctx.font = "12px Arial"
        ctx.fillStyle = "#000"
        ctx.fillText(
          `J-Line 2: J${line2.index} (${line2.startsAt} → ${line2.goesTo})`,
          10,
          80,
        )
      }
    }
  }, [
    pathResult,
    pointA,
    pointB,
    pointC,
    pointD,
    pointE,
    pointF,
    radius,
    margin,
    showInnerPoints,
    showOuterPoints,
    showJPair,
    showOptimalPath,
    showSubdivided,
    subdivisions,
  ])

  // Event handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Check which point we're clicking on
    const points = [
      { point: pointA, name: "A", setter: setPointA },
      { point: pointB, name: "B", setter: setPointB },
      { point: pointC, name: "C", setter: setPointC },
      { point: pointD, name: "D", setter: setPointD },
      { point: pointE, name: "E", setter: setPointE },
      { point: pointF, name: "F", setter: setPointF },
    ]

    for (const { point, name, setter } of points) {
      const dist = Math.sqrt((x - point.x) ** 2 + (y - point.y) ** 2)
      if (dist < 10) {
        setDragging({ name, setter })
        return
      }
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Update point position
    dragging.setter({ x, y })
  }

  const handleMouseUp = () => {
    setDragging(null)
  }

  // Output path data for debugging
  const pathData = JSON.stringify(pathResult, null, 2)

  return (
    <div className="flex flex-col items-center p-4">
      <h1 className="text-2xl font-bold mb-4">Dumbbell Path Debugger</h1>

      <div className="flex flex-wrap gap-4 mb-4">
        <div className="flex flex-col items-start p-4 border rounded shadow-sm bg-gray-50">
          <h2 className="text-lg font-semibold mb-2">Parameters</h2>

          <div className="mb-2">
            <label htmlFor="radius" className="mr-2">
              Radius: {radius}px
            </label>
            <input
              type="range"
              id="radius"
              min="10"
              max="100"
              value={radius}
              onChange={(e) => setRadius(parseInt(e.target.value))}
              className="w-48"
            />
          </div>

          <div className="mb-2">
            <label htmlFor="margin" className="mr-2">
              Margin: {margin}px
            </label>
            <input
              type="range"
              id="margin"
              min="5"
              max="50"
              value={margin}
              onChange={(e) => setMargin(parseInt(e.target.value))}
              className="w-48"
            />
          </div>

          <div className="mb-2">
            <label htmlFor="subdivisions" className="mr-2">
              Subdivisions: {subdivisions}
            </label>
            <input
              type="range"
              id="subdivisions"
              min="0"
              max="10"
              value={subdivisions}
              onChange={(e) => setSubdivisions(parseInt(e.target.value))}
              className="w-48"
            />
          </div>
        </div>

        <div className="flex flex-col items-start p-4 border rounded shadow-sm bg-gray-50">
          <h2 className="text-lg font-semibold mb-2">Display Options</h2>

          <div className="flex items-center mb-1">
            <input
              type="checkbox"
              id="showInnerPoints"
              checked={showInnerPoints}
              onChange={() => setShowInnerPoints(!showInnerPoints)}
              className="mr-2"
            />
            <label htmlFor="showInnerPoints">Show Inner Points</label>
          </div>

          <div className="flex items-center mb-1">
            <input
              type="checkbox"
              id="showOuterPoints"
              checked={showOuterPoints}
              onChange={() => setShowOuterPoints(!showOuterPoints)}
              className="mr-2"
            />
            <label htmlFor="showOuterPoints">Show Outer Points</label>
          </div>

          <div className="flex items-center mb-1">
            <input
              type="checkbox"
              id="showOptimalPath"
              checked={showOptimalPath}
              onChange={() => setShowOptimalPath(!showOptimalPath)}
              className="mr-2"
            />
            <label htmlFor="showOptimalPath">Show Optimal Path</label>
          </div>

          <div className="flex items-center mb-1">
            <input
              type="checkbox"
              id="showJPair"
              checked={showJPair}
              onChange={() => setShowJPair(!showJPair)}
              className="mr-2"
            />
            <label htmlFor="showJPair">Show J-Pair</label>
          </div>

          <div className="flex items-center mb-1">
            <input
              type="checkbox"
              id="showSubdivided"
              checked={showSubdivided}
              onChange={() => setShowSubdivided(!showSubdivided)}
              className="mr-2"
            />
            <label htmlFor="showSubdivided">Enable Subdivision</label>
          </div>
        </div>
      </div>

      <div className="border border-gray-300 rounded bg-white shadow-md">
        <canvas
          ref={canvasRef}
          width={700}
          height={500}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="cursor-move"
        />
      </div>

      <div className="mt-4 text-sm">
        <p className="font-medium">
          Drag points A-F to configure the geometry.
        </p>
        {pathResult &&
        pathResult.optimalPath &&
        pathResult.optimalPath.points.length > 0 ? (
          <p className="text-green-600">Valid optimal path found.</p>
        ) : (
          <p className="text-red-500">
            No valid optimal path found with current geometry.
          </p>
        )}

        {pathResult &&
        pathResult.jPair &&
        pathResult.jPair.line1 &&
        pathResult.jPair.line2 ? (
          <p className="text-green-600">Valid J-pair found.</p>
        ) : (
          <p className="text-red-500">
            No valid J-pair found. Need non-intersecting lines from E and F.
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 mt-2">
          <div className="p-2 bg-blue-50 rounded">
            <span className="font-bold">Point A:</span> ({Math.round(pointA.x)},{" "}
            {Math.round(pointA.y)})
          </div>
          <div className="p-2 bg-orange-50 rounded">
            <span className="font-bold">Point B:</span> ({Math.round(pointB.x)},{" "}
            {Math.round(pointB.y)})
          </div>
          <div className="p-2 bg-red-50 rounded">
            <span className="font-bold">Point C:</span> ({Math.round(pointC.x)},{" "}
            {Math.round(pointC.y)})
          </div>
          <div className="p-2 bg-green-50 rounded">
            <span className="font-bold">Point D:</span> ({Math.round(pointD.x)},{" "}
            {Math.round(pointD.y)})
          </div>
          <div className="p-2 bg-purple-50 rounded">
            <span className="font-bold">Point E:</span> ({Math.round(pointE.x)},{" "}
            {Math.round(pointE.y)})
          </div>
          <div className="p-2 bg-yellow-50 rounded">
            <span className="font-bold">Point F:</span> ({Math.round(pointF.x)},{" "}
            {Math.round(pointF.y)})
          </div>
        </div>
      </div>

      <div className="mt-4 w-full">
        <details>
          <summary className="cursor-pointer font-semibold mb-2">
            Path Computation Result (Click to expand)
          </summary>
          <pre
            className="bg-gray-100 p-3 rounded text-xs overflow-auto"
            style={{ maxHeight: "200px" }}
          >
            {pathData}
          </pre>
        </details>
      </div>
    </div>
  )
}

export default DumbbellDebugger
