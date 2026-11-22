from pathlib import Path
p=Path('node_modules/@tscircuit/fanout-solver/lib/route-bus/route-analytic-boundary-alternatives.ts')
s=p.read_text()
marker='  searchConnectionOrders(context)\n  const sourceTrackIsGuided ='
assert s.count(marker)==1
s=s.replace(marker,'  const sourceTrackIsGuided =')
marker='    busUsesCoordinatedWindingChannel(context.bus)\n'
assert s.count(marker)==1
s=s.replace(marker,marker+'  const preferSourceTracks =\n    context.bus.connections.length > 1 &&\n    !sourceTrackIsGuided &&\n    !context.fixedBoundaryTracksByConnectionIndex &&\n    context.bus.connections.every(connection => !connection.hasExplicitExitTarget)\n  searchConnectionOrders(context, { preferSourceTracks })\n')
p.write_text(s)
