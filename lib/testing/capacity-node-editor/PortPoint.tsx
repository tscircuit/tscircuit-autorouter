import type { PointDef, Rect, SelectionState } from "./types"
import { getPointOnEdge } from "./helpers"
import { LAYER_COLORS, LAYER_RADII } from "./constants"

interface PortPointProps {
  pointDef: PointDef
  rect: Rect
  pairIndex: number
  pointType: "entry" | "exit"
  selected: SelectionState | null
  onMouseDown: (
    e: React.MouseEvent,
    pairIndex: number,
    pointType: "entry" | "exit",
  ) => void
  onClick: (
    e: React.MouseEvent,
    pairIndex: number,
    pointType: "entry" | "exit",
  ) => void
}

export function PortPoint(props: PortPointProps) {
  const {
    pointDef,
    rect,
    pairIndex,
    pointType,
    selected,
    onMouseDown,
    onClick,
  } = props

  const pointPosition = getPointOnEdge(pointDef.edge, pointDef.t, rect)
  const isSelected =
    selected?.pairIndex === pairIndex && selected?.pointType === pointType
  const maxLayer = Math.max(...pointDef.layers)

  return (
    <g
      style={{ cursor: "grab" }}
      onMouseDown={(e) => onMouseDown(e, pairIndex, pointType)}
      onClick={(e) => onClick(e, pairIndex, pointType)}
    >
      {isSelected && (
        <circle
          cx={pointPosition.x}
          cy={pointPosition.y}
          r={LAYER_RADII[3] + 4}
          fill="none"
          stroke="#fff"
          strokeWidth={2}
          strokeDasharray="4,2"
        />
      )}
      {[3, 2, 1, 0].map((layer) => (
        <circle
          key={layer}
          cx={pointPosition.x}
          cy={pointPosition.y}
          r={LAYER_RADII[layer]}
          fill={
            pointDef.layers.includes(layer)
              ? LAYER_COLORS[layer]
              : layer <= maxLayer
                ? "#4b5563"
                : "transparent"
          }
          stroke={layer === maxLayer ? "#000" : "none"}
          strokeWidth={layer === maxLayer ? 1.5 : 0}
        />
      ))}
    </g>
  )
}
