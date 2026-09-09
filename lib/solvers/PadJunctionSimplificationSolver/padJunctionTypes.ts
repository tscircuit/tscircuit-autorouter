import type {
  HighDensityRoute,
  HighDensityRoutePoint,
} from "lib/types/high-density-types"
import type {
  Pad,
  TerminalPosition,
  PadJunctionSimplificationInput,
} from "./parsePadJunctionInput"
export type Point = HighDensityRoutePoint
export enum RunDirection {
  TowardRouteStart = -1,
  TowardRouteEnd = 1,
}
export type Run = TerminalPosition & {
  terminal: Point
  start: Point
  startIndex: number
  direction: RunDirection
}
export type CutRun = Run & { cut: Point; preserved: Point[] }
export type AcceptedReplacement = {
  junction: Point
  head: [Point, Point]
  stem: [Point, Point]
}
export type PadJunctionOutcome = {
  outcome: "accepted" | "unsupported" | "no_path" | "no_improvement"
  reason: string
  connectionNames: string[]
}
export const EPSILON = 1e-7
export const TERMINAL_TOLERANCE = 0.001

export type PadJunctionContext = {
  input: PadJunctionSimplificationInput
  output: HighDensityRoute[]
  pads: Pad[]
  terminalsByNet: Map<string, TerminalPosition[]>
  lockedRoutes: Set<number>
  clearance: number
  boardClearance: number
  getNet: (identity: string) => string
}
export type PadV = {
  pad: Pad
  runs: [Run, Run]
  width: number
  axis: "x" | "y"
  across: "x" | "y"
  sign: number
  connectionNames: string[]
  unsupported: PadJunctionOutcome
}
export type PadT = {
  v: PadV
  runs: [CutRun, CutRun]
  replacement: AcceptedReplacement
}
export type PadVSearchResult = {
  pad: Pad
  terminals: [TerminalPosition, TerminalPosition]
  result: PadV | PadJunctionOutcome
}
export type PadTConstructionResult = {
  pad: Pad
  terminals: [TerminalPosition, TerminalPosition]
  result: PadT | PadJunctionOutcome
}
export type ConstructPadTsInput = {
  context: PadJunctionContext
  vs: PadVSearchResult[]
}
export type ApplyPadTsInput = {
  context: PadJunctionContext
  ts: PadTConstructionResult[]
}
