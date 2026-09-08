declare module "react-for-pipeline9-fixtures/jsx-runtime" {
  import type {
    BoardProps,
    ChipProps,
    FootprintProps,
    NetProps,
    ResistorProps,
    SilkscreenRectProps,
    SilkscreenTextProps,
    SmtPadProps,
    TraceProps,
  } from "@tscircuit/props"
  import type { LayerRef } from "circuit-json"
  import type { Attributes, ReactElement, ReactNode } from "react"

  export { Fragment, jsx, jsxs } from "react/jsx-runtime"

  type FixtureProps<Props> = Props extends object
    ? Omit<Props, "key" | "children"> & Attributes & { children?: ReactNode }
    : never

  // Reuse the stable component props and declare the verified current-runtime
  // additions used here. This namespace is scoped to the explicit JSX pragma.
  export namespace JSX {
    type Element = ReactElement
    interface ElementChildrenAttribute {
      children: {}
    }
    interface IntrinsicAttributes extends Attributes {}
    interface IntrinsicElements {
      board: FixtureProps<BoardProps> & { layers?: 1 | 2 | 4 | 6 | 8 | 10 }
      chip: FixtureProps<ChipProps>
      copperpour: Attributes & {
        name?: string
        connectsTo: string
        layer: LayerRef
      }
      footprint: FixtureProps<FootprintProps>
      net: FixtureProps<NetProps>
      resistor: FixtureProps<ResistorProps> & {
        manufacturerPartNumber?: string
      }
      silkscreenrect: FixtureProps<SilkscreenRectProps>
      silkscreentext: FixtureProps<SilkscreenTextProps>
      smtpad: FixtureProps<SmtPadProps>
      trace: FixtureProps<TraceProps> & { name?: string }
    }
  }
}
