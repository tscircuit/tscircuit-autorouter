import { InteractiveGraphics } from "graphics-debug/react"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
} from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import type { ReactElement } from "react"
import capture from "./after.json"
import input from "./bugreport106-nrf52810-battery-pad-short.srj.json"

const inputSrj = input as SimpleRouteJson
const routedTraces = capture.routedTraces as SimplifiedPcbTrace[]
const graphics = convertSrjToGraphicsObject({
  ...inputSrj,
  traces: combinePreloadedAndRoutedTraces(inputSrj.traces ?? [], routedTraces),
})
graphics.points = []
const { errors } = evaluateRelaxedDrc({
  inputSrj,
  srjWithPointPairs: capture.srjWithPointPairs as SimpleRouteJson,
  routedTraces,
})

export default function NrfAfterCapture(): ReactElement {
  return (
    <section style={{ background: "white", color: "#111", padding: 16 }}>
      <h2>After: layer-aware port spacing</h2>
      <p>Frozen full-board output from {capture.sourceCommit}.</p>
      <p>
        Current relaxed DRC errors: {errors.length}. This is not a DRC-clean
        board. This count excludes the separate via-to-pad clearance checker.
      </p>
      <InteractiveGraphics graphics={graphics} height={760} alwaysShowToolbar />
    </section>
  )
}
