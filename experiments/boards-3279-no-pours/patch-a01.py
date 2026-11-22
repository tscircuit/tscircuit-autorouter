from pathlib import Path
import hashlib, json, re, subprocess, sys

runtime = Path(sys.argv[1])
package = runtime / 'node_modules/@tscircuit/capacity-autorouter'
helper = '''isViaBlockedByPort({row,col,activeConn}){
if(this.viaMinDistFromPort===undefined)return false;
const transform=this.gridToBoundsTransform;
const x=this.gridOrigin.x+(col+0.5)*this.cellSizeMm;
const y=this.gridOrigin.y+(row+0.5)*this.cellSizeMm;
const center={x:transform.a*x+transform.b*y+transform.c,y:transform.d*x+transform.e*y+transform.f};
const requiredDistance=this.viaMinDistFromPort;
const root=this.connIdToRootNet[activeConn];
return this.nodeWithPortPoints.portPoints.some(port=>(port.rootConnectionName??port.connectionName.replace(/_mst\\d+$/,""))!==root&&(port.x-center.x)**2+(port.y-center.y)**2<requiredDistance**2)
}'''
provenance = []
for path in sorted((package / 'dist').glob('**/*.js')):
    outer = path.read_text()
    worker = re.search(r'''workerSource:('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")''', outer)
    source = outer
    if worker:
        decoded = subprocess.run(['node', '-e', 'const fs=require("node:fs"),vm=require("node:vm");process.stdout.write(JSON.stringify(vm.runInNewContext(fs.readFileSync(0,"utf8"))))'], input=worker[1], text=True, capture_output=True, check=True)
        source = json.loads(decoded.stdout)
    marker = 'getSolverName(){return"HighDensitySolverA01"}'
    if marker not in source:
        continue
    assert source.count(marker) == 1, path
    start = source.index(marker)
    method = source.index('computeMoveCostAndRips(', start)
    # Calls precede the method declaration. Locate its closing signature/body.
    method_match = re.search(r'\}computeMoveCostAndRips\([^)]*\)\{', source[method:])
    assert method_match, path
    insert_at = method + method_match.start() + 1
    via = re.compile(r'([a-zA-Z_$][\w$]*)>=this.minViaRow&&\1<=this.maxViaRow&&([a-zA-Z_$][\w$]*)>=this.minViaCol&&\2<=this.maxViaCol')
    matches = list(via.finditer(source, start, insert_at))
    assert len(matches) == 1, (path, len(matches))
    match = matches[0]
    condition = match.group(0) + f'&&!this.isViaBlockedByPort({{row:{match[1]},col:{match[2]},activeConn:this.activeConnId}})'
    patched = source[:insert_at] + helper + source[insert_at:]
    patched = patched[:match.start()] + condition + patched[match.end():]
    constructor = re.search(r'this\.viaDiameter=([\w$]+)\.viaDiameter', patched[start:])
    assert constructor, path
    constructor_at = start + constructor.end()
    patched = patched[:constructor_at] + f',this.viaMinDistFromPort={constructor[1]}.viaMinDistFromPort' + patched[constructor_at:]
    params = patched.index('viaDiameter:this.viaDiameter,', start)
    params_at = params + len('viaDiameter:this.viaDiameter,')
    patched = patched[:params_at] + 'viaMinDistFromPort:this.viaMinDistFromPort,' + patched[params_at:]
    alias = re.search(r'(?:([\w$]+)=class|class ([\w$]+)) extends [\w$]+\{$', source[max(0, start - 150):start])
    assert alias, path
    portfolio = re.search(r'new ' + re.escape(alias[1] or alias[2]) + r'\(\{nodeWithPortPoints:this.nodeWithPortPoints,([^}]+)', patched)
    assert portfolio, path
    margin = re.search(r'traceMargin:([\w$]+),', portfolio[1])
    assert margin, path
    field = 'viaMinDistFromPort:this.constructorParams.preservePhysicalGeometry&&this.constructorParams.allowBlindAndBuriedVias===false?((this.constructorParams.viaDiameter??.3)+(this.constructorParams.traceWidth??.15))/2+' + margin[1] + ':undefined,'
    config_at = portfolio.start(1)
    patched = patched[:config_at] + field + patched[config_at:]
    physical_model = re.compile(r'layerCount:([\w$]+)\.layerCount,useGrowShrinkHighDensityIntraNodeSolver:')
    assert len(physical_model.findall(patched)) == 1, path
    patched = physical_model.sub(lambda model: f'layerCount:{model[1]}.layerCount,allowBlindAndBuriedVias:{model[1]}.allowBlindAndBuriedVias,useGrowShrinkHighDensityIntraNodeSolver:', patched)
    output = outer[:worker.start(1)] + json.dumps(patched) + outer[worker.end(1):] if worker else patched
    path.write_text(output)
    provenance.append({'file': str(path.relative_to(package)), 'before': hashlib.sha256(outer.encode()).hexdigest(), 'after': hashlib.sha256(output.encode()).hexdigest(), 'a01Classes': 1, 'embeddedWorker': bool(worker)})
assert any(row['file'] == 'dist/index.js' for row in provenance)
report = {'sourceRepo': 'tscircuit/high-density-a01', 'sourceRepro': '429bb0b', 'sourceFix': '20d30e6', 'change': 'A01 supplied through-via port clearance, enabled only for physical regional repairs with blind/buried vias disabled. Original grid, order, costs and budgets retained.', 'bundles': provenance}
Path(sys.argv[2]).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
