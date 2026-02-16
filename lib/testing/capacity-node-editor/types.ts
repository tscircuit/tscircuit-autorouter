export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Edge = "top" | "bottom" | "left" | "right"

export interface PointDef {
  edge: Edge
  t: number
  layers: number[]
  portPointId?: string
}

export interface PairDef {
  entry: PointDef
  exit: PointDef
}

export type DraggingState =
  | { type: "resize"; data: { handle: string } }
  | { type: "point"; data: { pairIndex: number; pointType: "entry" | "exit" } }
  | { type: "pan"; data: {} }

export interface DragStartState {
  mx: number
  my: number
  rect: Rect
  x?: number
  y?: number
}

export interface SelectionState {
  pairIndex: number
  pointType: "entry" | "exit"
}
