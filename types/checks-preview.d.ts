import type {
  AnyCircuitElement,
  PcbPadTraceClearanceError,
  PcbTraceError,
  PcbViaClearanceError,
  PcbViaTraceClearanceError,
} from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"

interface ClearanceCheckOptions {
  connMap?: ConnectivityMap
  minClearance?: number
}

export function checkDifferentNetViaSpacing(
  circuitJson: AnyCircuitElement[],
  options?: ClearanceCheckOptions,
): PcbViaClearanceError[]

export function checkEachPcbTraceNonOverlapping(
  circuitJson: AnyCircuitElement[],
  options?: ClearanceCheckOptions,
): PcbTraceError[]

export function checkPadTraceClearance(
  circuitJson: AnyCircuitElement[],
  options?: ClearanceCheckOptions,
): PcbPadTraceClearanceError[]

export function checkSameNetViaSpacing(
  circuitJson: AnyCircuitElement[],
  options?: ClearanceCheckOptions,
): PcbViaClearanceError[]

export function checkTracesAreContiguous(
  circuitJson: AnyCircuitElement[],
): PcbTraceError[]

export function checkViaTraceClearance(
  circuitJson: AnyCircuitElement[],
  options?: ClearanceCheckOptions,
): PcbViaTraceClearanceError[]

export function dedupePcbDrcErrors<T extends AnyCircuitElement>(errors: T[]): T[]
