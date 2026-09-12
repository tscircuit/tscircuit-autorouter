import { orderConnectionIndexesByNetCardinality } from "../pkg/tiny_hypergraph_bindings.js"
import { assertTinyHypergraphBindingsInitialized } from "./loadTinyHypergraphBindings.js"

export function orderConnectionsByNetCardinality<T>(
  connections: T[],
  getNetId: (connection: T) => string,
): T[] {
  assertTinyHypergraphBindingsInitialized()
  const indexes = orderConnectionIndexesByNetCardinality(connections.map(getNetId)) as number[]
  return indexes.map((index) => connections[index]!)
}
