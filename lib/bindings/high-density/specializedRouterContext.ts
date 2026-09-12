import * as bindings from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"

type ContextProps = {
  connMap?: object
  obstacles?: object[]
  layerCount?: number
  [key: string]: unknown
}

let contextScopeDepth = 0

export function withSpecializedRouterContext<T>(create: () => T): T {
  contextScopeDepth++
  try {
    return create()
  } finally {
    contextScopeDepth--
  }
}

const noConnectivity = {}
const noObstacles: object[] = []
const multiHeadContexts = new WeakMap<object, bindings.SpecializedRouterContext>()
const throughObstacleContexts = new WeakMap<object[], WeakMap<object, Map<number, bindings.SpecializedRouterContext>>>()

function serializeContext(props: ContextProps): string {
  return JSON.stringify(props, (_key, value: unknown): unknown => value instanceof Map ? Object.fromEntries(value) : value)
}

export function getSpecializedRouterContext(
  kind: string,
  props: ContextProps,
): { context: bindings.SpecializedRouterContext; params: ContextProps } | undefined {
  if (contextScopeDepth === 0) return undefined
  if (kind === "multi-head" || kind === "multi-head2" || kind === "multi-head3") {
    const { connMap, ...params } = props
    const key = connMap ?? noConnectivity
    let context = multiHeadContexts.get(key)
    if (!context) {
      context = new bindings.SpecializedRouterContext(serializeContext({ connMap }))
      multiHeadContexts.set(key, context)
    }
    return { context, params }
  }
  if (kind === "through-obstacle") {
    const { connMap, obstacles, layerCount, ...params } = props
    const obstacleKey = obstacles ?? noObstacles
    const connectivityKey = connMap ?? noConnectivity
    const layers = layerCount ?? 2
    let byConnectivity = throughObstacleContexts.get(obstacleKey)
    if (!byConnectivity) {
      byConnectivity = new WeakMap()
      throughObstacleContexts.set(obstacleKey, byConnectivity)
    }
    let byLayer = byConnectivity.get(connectivityKey)
    if (!byLayer) {
      byLayer = new Map()
      byConnectivity.set(connectivityKey, byLayer)
    }
    let context = byLayer.get(layers)
    if (!context) {
      context = new bindings.SpecializedRouterContext(serializeContext({ connMap, obstacles, layerCount: layers }))
      byLayer.set(layers, context)
    }
    return { context, params }
  }
  return undefined
}
