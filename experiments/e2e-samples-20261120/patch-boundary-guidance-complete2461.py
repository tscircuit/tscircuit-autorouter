from pathlib import Path
import subprocess
subprocess.run(['python3','auto-boundary.py'],check=True)
subprocess.run(['python3','own-pad.py'],check=True)
root=Path('node_modules/@tscircuit/fanout-solver/lib')
p=root/'route-bus/route-coordinated-boundary-steps.ts';s=p.read_text()
marker='''    const boundaryDirection = getDirectionForExitEdge(bus.exitEdge)''';assert s.count(marker)==1
s=s.replace(marker,'''    const sourceLayerRouting =
      !fixedViaPointsByConnectionIndex &&
      !context.sourceEscapePaths &&
      bus.connections.every(connection => connection.sourceLayer === targetLayer)
'''+marker)
marker='''          viaPoint: terminalPattern.getViaPoint''';assert s.count(marker)==1
s=s.replace(marker,'''          viaPoint: sourceLayerRouting
            ? { x: preparedConnection.sourcePoint.x, y: preparedConnection.sourcePoint.y }
            : terminalPattern.getViaPoint''')
marker='''          maximumRouteOrderAttempts: terminalPattern.maximumRouteOrderAttempts,''';assert s.count(marker)==1
s=s.replace(marker,marker+'\n          allowSourceLayerRouting: sourceLayerRouting,');p.write_text(s)
p=root/'fanout-solver.ts';s=p.read_text();marker='  if (busUsesCoordinatedWinding(bus)) return allowedEscapeLayers';assert s.count(marker)==1
s=s.replace(marker,'  if (busUsesCoordinatedWinding(bus) && bus.connections.length > 1) return allowedEscapeLayers');p.write_text(s)
