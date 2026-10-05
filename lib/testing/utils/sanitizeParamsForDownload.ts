const getObjectPath = (parentPath: string, key: string | number) => {
  if (typeof key === "number") {
    return `${parentPath}[${key}]`
  }

  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parentPath}.${key}`
    : `${parentPath}[${JSON.stringify(key)}]`
}

const getReferenceSummary = (value: unknown) => {
  if (!value || typeof value !== "object") {
    return {}
  }

  const summary: Record<string, string | number | boolean> = {}
  for (const key of [
    "capacityMeshNodeId",
    "regionId",
    "portId",
    "portPointId",
    "connectionId",
    "connectionName",
    "id",
    "name",
  ] as const) {
    const fieldValue = (value as Record<string, unknown>)[key]
    if (
      typeof fieldValue === "string" ||
      typeof fieldValue === "number" ||
      typeof fieldValue === "boolean"
    ) {
      summary[key] = fieldValue
    }
  }

  return summary
}

const createReferenceMarker = (value: unknown, refPath: string) => ({
  $ref: refPath,
  ...getReferenceSummary(value),
})

export const sanitizeParamsForDownload = (
  value: unknown,
  seen = new WeakMap<object, string>(),
  path = "$",
): unknown => {
  const omitValue = Symbol("omitValue")

  const sanitizeLeafValue = (input: unknown) => {
    if (typeof input === "bigint") {
      return input.toString()
    }

    if (
      input === undefined ||
      typeof input === "function" ||
      typeof input === "symbol"
    ) {
      return omitValue
    }

    if (input === null || typeof input !== "object") {
      return input
    }

    if (input instanceof Date) {
      return input.toISOString()
    }

    if (input instanceof Error) {
      return {
        name: input.name,
        message: input.message,
        stack: input.stack,
      }
    }

    return undefined
  }

  const rootLeafValue = sanitizeLeafValue(value)
  if (rootLeafValue !== undefined) {
    if (rootLeafValue === omitValue) {
      return null
    }
    return rootLeafValue
  }

  const rootValue = value as object
  const seenPath = seen.get(rootValue)
  if (seenPath) {
    return createReferenceMarker(rootValue, seenPath)
  }

  const createContainer = (input: object) => {
    if (Array.isArray(input) || input instanceof Set) {
      return [] as unknown[]
    }
    return {} as Record<string, unknown>
  }

  const rootContainer = createContainer(rootValue)
  seen.set(rootValue, path)

  const stack: Array<{
    source: object
    target: unknown[] | Record<string, unknown>
    path: string
  }> = [
    {
      source: rootValue,
      target: rootContainer,
      path,
    },
  ]

  while (stack.length > 0) {
    const frame = stack.pop()!

    if (Array.isArray(frame.source)) {
      frame.source.forEach((item, index) => {
        const childPath = getObjectPath(frame.path, index)
        const leafValue = sanitizeLeafValue(item)
        if (leafValue !== undefined) {
          ;(frame.target as unknown[])[index] =
            leafValue === omitValue ? null : leafValue
          return
        }

        const childValue = item as object
        const existingPath = seen.get(childValue)
        if (existingPath) {
          ;(frame.target as unknown[])[index] = createReferenceMarker(
            childValue,
            existingPath,
          )
          return
        }

        const childContainer = createContainer(childValue)
        seen.set(childValue, childPath)
        ;(frame.target as unknown[])[index] = childContainer
        stack.push({
          source: childValue,
          target: childContainer,
          path: childPath,
        })
      })
      continue
    }

    if (frame.source instanceof Set) {
      Array.from(frame.source.values()).forEach((item, index) => {
        const childPath = getObjectPath(frame.path, index)
        const leafValue = sanitizeLeafValue(item)
        if (leafValue !== undefined) {
          ;(frame.target as unknown[])[index] =
            leafValue === omitValue ? null : leafValue
          return
        }

        const childValue = item as object
        const existingPath = seen.get(childValue)
        if (existingPath) {
          ;(frame.target as unknown[])[index] = createReferenceMarker(
            childValue,
            existingPath,
          )
          return
        }

        const childContainer = createContainer(childValue)
        seen.set(childValue, childPath)
        ;(frame.target as unknown[])[index] = childContainer
        stack.push({
          source: childValue,
          target: childContainer,
          path: childPath,
        })
      })
      continue
    }

    if (frame.source instanceof Map) {
      for (const [key, item] of frame.source.entries()) {
        const stringKey = String(key)
        const childPath = `${frame.path}.<map:${stringKey}>`
        const leafValue = sanitizeLeafValue(item)
        if (leafValue !== undefined) {
          if (leafValue !== omitValue) {
            ;(frame.target as Record<string, unknown>)[stringKey] = leafValue
          }
          continue
        }

        const childValue = item as object
        const existingPath = seen.get(childValue)
        if (existingPath) {
          ;(frame.target as Record<string, unknown>)[stringKey] =
            createReferenceMarker(childValue, existingPath)
          continue
        }

        const childContainer = createContainer(childValue)
        seen.set(childValue, childPath)
        ;(frame.target as Record<string, unknown>)[stringKey] = childContainer
        stack.push({
          source: childValue,
          target: childContainer,
          path: childPath,
        })
      }
      continue
    }

    for (const key of Object.keys(frame.source)) {
      const propertyValue = (frame.source as Record<string, unknown>)[key]
      const childPath = getObjectPath(frame.path, key)

      if (key === "_parent" && propertyValue) {
        const parentPath =
          typeof propertyValue === "object" && propertyValue !== null
            ? (seen.get(propertyValue) ?? childPath)
            : childPath
        ;(frame.target as Record<string, unknown>)[key] = createReferenceMarker(
          propertyValue,
          parentPath,
        )
        continue
      }

      const leafValue = sanitizeLeafValue(propertyValue)
      if (leafValue !== undefined) {
        if (leafValue !== omitValue) {
          ;(frame.target as Record<string, unknown>)[key] = leafValue
        }
        continue
      }

      const childValue = propertyValue as object
      const existingPath = seen.get(childValue)
      if (existingPath) {
        ;(frame.target as Record<string, unknown>)[key] = createReferenceMarker(
          childValue,
          existingPath,
        )
        continue
      }

      const childContainer = createContainer(childValue)
      seen.set(childValue, childPath)
      ;(frame.target as Record<string, unknown>)[key] = childContainer
      stack.push({
        source: childValue,
        target: childContainer,
        path: childPath,
      })
    }
  }

  return rootContainer
}
