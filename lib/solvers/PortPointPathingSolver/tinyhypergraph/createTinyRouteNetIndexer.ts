export type TinyRouteNetIndexSource = {
  connectionId: string;
  mutuallyConnectedNetworkId: string;
};

export type TinyRouteNetIndexer = (
  routeMetadata: TinyRouteNetIndexSource,
) => number;

export function createTinyRouteNetIndexer(): TinyRouteNetIndexer {
  const netIndexById = new Map<string, number>();

  return (routeMetadata: TinyRouteNetIndexSource): number => {
    const netId = routeMetadata.mutuallyConnectedNetworkId;
    let netIndex = netIndexById.get(netId);
    if (netIndex === undefined) {
      netIndex = netIndexById.size;
      netIndexById.set(netId, netIndex);
    }
    return netIndex;
  };
}
