import type * as Props from "@tscircuit/props"
import type { Attributes } from "react"
interface NativeElements {
  board: Props.BoardProps & Attributes
  autoroutingphase: Props.AutoroutingPhaseProps & Attributes
  trace: Props.TraceProps & Attributes
  net: Props.NetProps & Attributes
  bus: Props.BusProps & Attributes
  copperpour: Props.CopperPourProps & Attributes
  fanout: Props.BreakoutProps & Attributes
  footprint: Props.FootprintProps & Attributes
  platedhole: Props.PlatedHoleProps & Attributes
  hole: Props.HoleProps & Attributes
  smtpad: Props.SmtPadProps & Attributes
  chip: Props.ChipProps & Attributes
  silkscreenpath: Props.SilkscreenPathProps & Attributes
}
declare module "react" { namespace JSX { interface IntrinsicElements extends NativeElements {} } }
declare module "react/jsx-runtime" { namespace JSX { interface IntrinsicElements extends NativeElements {} } }
