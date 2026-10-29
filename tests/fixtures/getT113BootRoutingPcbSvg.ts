import type { CircuitJson } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types/srj-types"

type BootRoutingPcbSvgInput = {
  circuitJson: CircuitJson
  srj: SimpleRouteJson
  traces: SimplifiedPcbTrace[]
}

export const getT113BootRoutingPcbSvg = ({
  circuitJson,
  srj,
  traces,
}: BootRoutingPcbSvgInput): string => {
  const nativeCopper = convertToCircuitJson(srj, traces).filter(
    (element) => element.type === "pcb_trace" || element.type === "pcb_via",
  )

  return convertCircuitJsonToPcbSvg([...circuitJson, ...nativeCopper])
}
