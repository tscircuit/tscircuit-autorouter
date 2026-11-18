// Keep this board's current JSX props separate from the repository's legacy Core.
import type * as Props from "@tscircuit/props-for-sepic-repro"
import type { Attributes, ReactElement, ReactNode } from "react"
export { Fragment, jsx, jsxs } from "react-for-pipeline9-fixtures/jsx-runtime"

type FixtureProps<P> = P extends object
  ? Omit<P, "key" | "children"> & Attributes & { children?: ReactNode }
  : never

export namespace JSX {
  export type Element = ReactElement
  export type ElementType = import("react").JSX.ElementType
  export interface ElementChildrenAttribute {
    children: {}
  }
  export interface IntrinsicAttributes extends Attributes {}
  export interface IntrinsicElements {
    board: FixtureProps<Props.BoardProps>
    capacitor: FixtureProps<Props.CapacitorProps>
    chip: FixtureProps<Props.ChipProps>
    connector: FixtureProps<Props.ConnectorProps>
    courtyardoutline: FixtureProps<Props.CourtyardOutlineProps>
    courtyardrect: FixtureProps<Props.CourtyardRectProps>
    diode: FixtureProps<Props.DiodeProps>
    fabricationnotepath: FixtureProps<Props.FabricationNotePathProps>
    footprint: FixtureProps<Props.FootprintProps>
    hole: FixtureProps<Props.HoleProps>
    inductor: FixtureProps<Props.InductorProps>
    keepout: FixtureProps<Props.PcbKeepoutProps>
    mosfet: FixtureProps<Props.MosfetProps>
    net: FixtureProps<Props.NetProps>
    platedhole: FixtureProps<Props.PlatedHoleProps>
    port: FixtureProps<Props.PortProps>
    potentiometer: FixtureProps<Props.PotentiometerProps>
    resistor: FixtureProps<Props.ResistorProps>
    schematicpath: FixtureProps<Props.SchematicPathProps>
    schematicsection: FixtureProps<Props.SchematicSectionProps>
    schematicsheet: FixtureProps<Props.SchematicSheetProps>
    schematictext: FixtureProps<Props.SchematicTextProps>
    silkscreencircle: FixtureProps<Props.SilkscreenCircleProps>
    silkscreenpath: FixtureProps<Props.SilkscreenPathProps>
    silkscreenrect: FixtureProps<Props.SilkscreenRectProps>
    silkscreentext: FixtureProps<Props.SilkscreenTextProps>
    smtpad: FixtureProps<Props.SmtPadProps>
    symbol: FixtureProps<Props.SymbolProps>
    trace: FixtureProps<Props.TraceProps>
  }
}
