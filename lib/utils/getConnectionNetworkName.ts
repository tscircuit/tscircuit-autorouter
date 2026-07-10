import type { SimpleRouteConnection } from "lib/types"

export const getConnectionNetworkName = (
  connection: SimpleRouteConnection,
): string => {
  const rootConnectionNames = connection.__rootConnectionNames
  if (!rootConnectionNames || rootConnectionNames.length === 0) {
    return connection.name
  }

  return [...rootConnectionNames].sort().join("__")
}
