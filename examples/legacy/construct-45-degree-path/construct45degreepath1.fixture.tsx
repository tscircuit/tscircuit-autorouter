import { calculate45DegreePaths } from "lib/utils/calculate45DegreePaths"
import React, { useState, useEffect, useRef } from "react"
import { Stage, Layer, Circle, Line, Text } from "react-konva"

interface Point {
  x: number
  y: number
}

const Construct45DegreePathFixture: React.FC = () => {
  const [pointA, setPointA] = useState<Point>({ x: 100, y: 100 })
  const [pointB, setPointB] = useState<Point>({ x: 300, y: 200 })
  const [paths, setPaths] = useState<Array<Array<Point>>>([])
  const stageRef = useRef<any>(null)

  // Path colors
  const pathColors = ["#FF5733", "#33FF57", "#3357FF", "#F033FF"]

  // Update paths when points change
  useEffect(() => {
    setPaths(calculate45DegreePaths(pointA, pointB))
  }, [pointA, pointB])

  const handleDragMove = (e: any, point: "A" | "B") => {
    const pos = e.target.position()
    if (point === "A") {
      setPointA({ x: pos.x, y: pos.y })
    } else {
      setPointB({ x: pos.x, y: pos.y })
    }
  }

  return (
    <div>
      <h2>45-Degree Path Construction</h2>
      <p>Drag points A and B to see different path options</p>
      <Stage
        width={600}
        height={400}
        ref={stageRef}
        style={{ border: "1px solid #ddd" }}
      >
        <Layer>
          {/* Draw all possible paths */}
          {paths.map((path, index) => (
            <React.Fragment key={index}>
              <Line
                points={path.flatMap((p) => [p.x, p.y])}
                stroke={pathColors[index]}
                strokeWidth={2}
                dash={index === 0 ? undefined : [5, 5]}
              />
              {/* Draw midpoint */}
              <Circle
                x={path[1].x}
                y={path[1].y}
                radius={4}
                fill={pathColors[index]}
              />
              <Text
                x={path[1].x + 5}
                y={path[1].y + 5}
                text={`M${index + 1}`}
                fontSize={12}
                fill={pathColors[index]}
              />
            </React.Fragment>
          ))}

          {/* Point A */}
          <Circle
            x={pointA.x}
            y={pointA.y}
            radius={8}
            fill="blue"
            draggable
            onDragMove={(e) => handleDragMove(e, "A")}
          />
          <Text
            x={pointA.x + 10}
            y={pointA.y - 20}
            text="A"
            fontSize={16}
            fill="blue"
          />

          {/* Point B */}
          <Circle
            x={pointB.x}
            y={pointB.y}
            radius={8}
            fill="red"
            draggable
            onDragMove={(e) => handleDragMove(e, "B")}
          />
          <Text
            x={pointB.x + 10}
            y={pointB.y - 20}
            text="B"
            fontSize={16}
            fill="red"
          />
        </Layer>
      </Stage>
    </div>
  )
}

export default Construct45DegreePathFixture
