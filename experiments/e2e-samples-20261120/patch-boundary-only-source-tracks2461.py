from pathlib import Path
root=Path('node_modules/@tscircuit/fanout-solver/lib')
p=root/'route-bus/types.ts';s=p.read_text();start=s.index('export interface RouteBusParams');tail=s[start:];marker='  srj: SimpleRouteJson\n';assert marker in tail;tail=tail.replace(marker,marker+'  /** Prefer source-aligned tracks for compact automatic boundary handoffs. */\n  preferSourceTracks?: boolean\n',1);p.write_text(s[:start]+tail)
p=root/'route-bus/route-analytic-boundary-alternatives.ts';s=p.read_text();marker='  searchConnectionOrders(context)\n  const sourceTrackIsGuided =';assert s.count(marker)==1;s=s.replace(marker,'  const sourceTrackIsGuided =');marker='    busUsesCoordinatedWindingChannel(context.bus)\n';assert s.count(marker)==1;s=s.replace(marker,marker+'''  const preferSourceTracks =
    context.preferSourceTracks === true &&
    context.compactBusTracks &&
    !sourceTrackIsGuided &&
    !context.fixedBoundaryTracksByConnectionIndex &&
    context.bus.connections.every(connection => !connection.hasExplicitExitTarget)
  searchConnectionOrders(context, { preferSourceTracks })
''');marker='    searchConnectionOrders(context, { preferSourceTracks: true })';assert s.count(marker)==1;s=s.replace(marker,'    searchConnectionOrders(context, { preferSourceTracks: !preferSourceTracks })');p.write_text(s)
p=root/'fanout-solver.ts';s=p.read_text();start=s.index('function getCandidateEscapeLayersForBus(');end=s.index('export class FanoutSolver',start);part=s[start:end];marker='  staticClearanceCache: RouteBusStaticClearanceCache\n';assert part.count(marker)==1;part=part.replace(marker,marker+'  preferSourceTracks: boolean\n');marker='  const { bus, srj, config, staticClearanceCache } = params';assert part.count(marker)==1;part=part.replace(marker,'  const { bus, srj, config, staticClearanceCache, preferSourceTracks } = params');marker='        bus,\n';assert part.count(marker)==1;part=part.replace(marker,marker+'        preferSourceTracks,\n');s=s[:start]+part+s[end:]
start=s.index('  private stepRoutingInitialization()');end=s.index('    const generatedAssignments',start);part=s[start:end];marker='        staticClearanceCache: this.routeStaticClearanceCache,\n';assert part.count(marker)==1;part=part.replace(marker,marker+'        preferSourceTracks: this.boundaryBuses.length === this.preparedBuses.length,\n');s=s[:start]+part+s[end:]
start=s.index('    let routingPrefixKey = `${routingStrategy}|`');end=s.index('      let busPlans = routeBus(routeParams)',start);part=s[start:end];marker='        compactBusTracks: this.config.compactBusTracks,\n';assert part.count(marker)==1;part=part.replace(marker,marker+'        preferSourceTracks: this.boundaryBuses.length === this.preparedBuses.length,\n');s=s[:start]+part+s[end:];p.write_text(s)
