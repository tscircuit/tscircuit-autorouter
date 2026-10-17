#!/usr/bin/env python3
"""SRJ->Specctra DSN->FreeRouting CLI->SRJ baseline, with explicit time budget.

No routes from the original KiCad boards are used. Each SRJ obstacle becomes a
synthetic pad (or a keepout if netless); physical connectivity is not inferred
from net names during result evaluation. Ovals are capsules and rotations are
preserved in DSN placement. Coordinates are micrometres on input.
"""
import argparse, collections, concurrent.futures, hashlib, json, math, re, subprocess, time
from pathlib import Path

class Union:
    def __init__(self): self.p={}
    def find(self,x):
        self.p.setdefault(x,x)
        if self.p[x]!=x:self.p[x]=self.find(self.p[x])
        return self.p[x]
    def union(self,a,b):self.p[self.find(b)]=self.find(a)

def layers(n): return ['top']+[f'inner{i}' for i in range(1,n-1)]+['bottom'] if n>1 else ['top']
def f(x): return f'{x*1000:.6f}'.rstrip('0').rstrip('.') or '0'
def q(x): return json.dumps(x)

def make_dsn(srj, clearance=.1, via_diameter=.3):
    uf=Union(); connections=srj['connections']; obs=srj['obstacles']; ls=layers(srj['layerCount'])
    for o in obs:
        ids=o.get('connectedTo',[])
        for a in ids[1:]:uf.union(ids[0],a)
    for c in connections:
        uf.find(c['name'])
        for p in c['pointsToConnect']:
            if p.get('pointId') or p.get('pcb_port_id'):uf.union(c['name'],p.get('pointId',p.get('pcb_port_id')))
    byroot=collections.defaultdict(list)
    for c in connections:byroot[uf.find(c['name'])].append(c['name'])
    canonical={r:next((n for n in names if n.startswith('source_net_')),names[0]) for r,names in byroot.items()}
    aliases={c['name']:canonical[uf.find(c['name'])] for c in connections}
    pins=collections.defaultdict(list); placement=[]; images=[]; stacks=[]; keepouts=[]; padmap=[]
    for i,o in enumerate(obs):
        active=[l for l in o['layers'] if l in ls]
        if not active:continue
        w=o['width'];h=o['height'];x=o['center']['x'];y=o['center']['y'];ang=o.get('ccwRotationDegrees',0)
        root=uf.find(o['connectedTo'][0]) if o.get('connectedTo') else None
        net=canonical.get(root)
        def shape(layer):
            if o['type']=='oval':
                radius=min(w,h); dx=max(0,(w-h)/2);dy=max(0,(h-w)/2)
                return f'(path {layer} {f(radius)} {f(-dx)} {f(-dy)} {f(dx)} {f(dy)})'
            return f'(rect {layer} {f(-w/2)} {f(-h/2)} {f(w/2)} {f(h/2)})'
        # A netless synthetic pad still acts as foreign copper, matching an SRJ
        # obstacle; unlike image keepouts it is handled consistently on all layers.
        pn=f'P{i}';sn=f'S{i}';im=f'I{i}'
        placement.append(f'(component {im} (place {pn} {f(x)} {f(y)} front {ang}))')
        images.append(f'(image {im} (pin {sn} 1 0 0))')
        stacks.append(f'(padstack {sn} '+ ' '.join(f'(shape {shape(l)})' for l in active)+' (attach off))')
        if net:pins[net].append(f'{pn}-1')
        padmap.append({'index':i,'pin':pn+'-1','net':net,'layers':active,'center':o['center']})
    # Every requested terminal must touch a physical pad. Normally SRJ terminals
    # coincide with obstacle centres. For offset terminals (e.g. shared shield
    # holes), accept geometric containment on the correct layer and logical net.
    unmatched=[];terminal_keys=set()
    for c in connections:
        net=aliases[c['name']]
        for p in c['pointsToConnect']:
            found=False
            for m in padmap:
                if m['net']!=net or p['layer'] not in m['layers']:continue
                o=obs[m['index']];a=math.radians(-o.get('ccwRotationDegrees',0));dx=p['x']-o['center']['x'];dy=p['y']-o['center']['y'];rx=dx*math.cos(a)-dy*math.sin(a);ry=dx*math.sin(a)+dy*math.cos(a)
                if abs(rx)<=o['width']/2+1e-6 and abs(ry)<=o['height']/2+1e-6:found=True;break
            if not found:
                unmatched.append({'connection':c['name'],'point':p})
                key=(net,p['x'],p['y'],p['layer'])
                if key in terminal_keys:continue
                terminal_keys.add(key);idx=len(terminal_keys);pn=f'T{idx}';sn=f'TS{idx}';im=f'TI{idx}'
                placement.append(f'(component {im} (place {pn} {f(p["x"])} {f(p["y"])} front 0))')
                images.append(f'(image {im} (pin {sn} 1 0 0))')
                stacks.append(f'(padstack {sn} (shape (circle {p["layer"]} {f(srj.get("minTraceWidth",.1))})) (attach off))')
                pins[net].append(pn+'-1')
    outline=srj.get('outline') or [{'x':srj['bounds']['minX'],'y':srj['bounds']['minY']},{'x':srj['bounds']['maxX'],'y':srj['bounds']['minY']},{'x':srj['bounds']['maxX'],'y':srj['bounds']['maxY']},{'x':srj['bounds']['minX'],'y':srj['bounds']['maxY']}]
    if outline[0]!=outline[-1]:outline=outline+[outline[0]]
    layerexpr=' '.join(f'(layer {l} (type signal) (property (index {i})))' for i,l in enumerate(ls))
    boundary=' '.join(f'{f(p["x"])} {f(p["y"])}' for p in outline)
    via='(padstack VIA '+ ' '.join(f'(shape (circle {l} {f(via_diameter)}))' for l in ls)+' (attach off))'
    width=srj.get('minTraceWidth',.1)
    network=' '.join(f'(net {q(n)} (pins '+ ' '.join(ps)+'))'for n,ps in pins.items())
    rules=f'(class default '+ ' '.join(q(n)for n in pins)+f' (circuit (use_via VIA)) (rule (width {f(width)}) (clearance {f(clearance)})))'
    dsn=f'(pcb {srj["id"]}.dsn (parser (string_quote ") (space_in_quoted_tokens on) (host_cad "SRJ experiment") (host_version "1")) (resolution um 10) (unit um) (structure {layerexpr} (boundary (path pcb 0 {boundary})) (via VIA) (rule (width {f(width)}) (clearance {f(clearance)}))) (placement '+ ' '.join(placement)+') (library '+ ' '.join(images+stacks+[via])+f') (network {network} {rules}))\n'
    return dsn,{'aliases':aliases,'padmap':padmap,'layers':ls,'clearance':clearance,'viaDiameter':via_diameter,'viaHoleDiameter':.15,'unmatchedTerminals':unmatched}

def sexpr(text):
    tokens=re.findall(r'"(?:[^"\\]|\\.)*"|[()]|[^\s()]+',text);stack=[[]]
    for t in tokens:
        if t=='(':v=[];stack[-1].append(v);stack.append(v)
        elif t==')':stack.pop()
        else:stack[-1].append(json.loads(t) if t.startswith('"') else t)
    return stack[0][0]
def child(s,name):return next((v for v in s if isinstance(v,list) and v and v[0]==name),None)

def ses_to_srj(path,srj,mapping):
    s=sexpr(path.read_text());routes=child(s,'routes');res=child(routes,'resolution');scale=float(res[2])*1000 if res[1]=='um' else float(res[2])
    library=child(routes,'library_out');diameters={};via_layers={}
    for stack in library[1:] if library else []:
        if not isinstance(stack,list)or stack[0]!='padstack':continue
        sizes=[float(sh[1][2])/scale for sh in stack if isinstance(sh,list)and sh and sh[0]=='shape'and sh[1][0]=='circle']
        if sizes:diameters[stack[1]]=max(sizes)
        via_layers[stack[1]]=[sh[1][1]for sh in stack if isinstance(sh,list)and sh and sh[0]=='shape']
    netout=child(routes,'network_out');traces=[];wi=0;vi=0
    for net in netout[1:]:
        if not isinstance(net,list) or net[0]!='net':continue
        name=net[1]
        for copper in net[2:]:
            if copper[0]=='wire':
                p=child(copper,'path');layer=p[1];width=float(p[2])/scale;coords=p[3:]
                route=[{'route_type':'wire','x':float(coords[i])/scale,'y':float(coords[i+1])/scale,'layer':layer,'width':width}for i in range(0,len(coords),2)]
                traces.append({'type':'pcb_trace','pcb_trace_id':f'freerouting_wire_{wi}','connection_name':name,'route':route});wi+=1
            elif copper[0]=='via':
                x=float(copper[2])/scale;y=float(copper[3])/scale;ls=via_layers.get(copper[1],mapping['layers'])
                traces.append({'type':'pcb_trace','pcb_trace_id':f'freerouting_via_{vi}','connection_name':name,'route':[{'route_type':'via','x':x,'y':y,'from_layer':ls[0],'to_layer':ls[-1],'diameter':diameters.get(copper[1],mapping['viaDiameter']),'hole_diameter':mapping['viaHoleDiameter']} ]});vi+=1
    out=dict(srj);out['traces']=traces
    return out

def run_one(path,args):
    started=time.monotonic();srj=json.loads(path.read_text());outdir=args.output/srj['id'];outdir.mkdir(parents=True,exist_ok=True)
    (args.output/(srj['id']+'.json')).unlink(missing_ok=True)
    meta={'algorithm':'freerouting','sampleId':srj['id'],'version':'2.5.0','timeBudgetSeconds':args.seconds,'inputSha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    try:
        dsn,mapping=make_dsn(srj,args.clearance,args.via_diameter);dsnp=outdir/'input.dsn';dsnp.write_text(dsn);(outdir/'mapping.json').write_text(json.dumps(mapping,indent=2));sesp=outdir/'output.ses'
        for old in [sesp,outdir/'native-result.json',outdir/'routed.json']:old.unlink(missing_ok=True)
        prefix=[str(args.binary.resolve())]
        if args.jar:prefix+=['-Xmx1g','-jar',str(args.jar.resolve())]
        duration=f'{args.seconds//3600:02d}:{args.seconds//60%60:02d}:{args.seconds%60:02d}'
        command=prefix+['-de',str(dsnp.resolve()),'-do',str(sesp.resolve()),'--gui.enabled=false','--router.autorouter.max_passes=100','--router.optimizer.max_threads=1','--router.optimizer.max_passes=5','--router.automatic_neckdown=false','--router.neck_width_um=100',f'--router.fanout.enabled={str(args.fanout).lower()}','--router.strict_drc=true',f'--router.copper_to_edge_clearance_um={args.clearance*1000}',f'--router.fanout.start_via_diameter_mm={args.via_diameter}',f'--router.fanout.end_via_diameter_mm={args.via_diameter}',f'--router.job_timeout={duration}',f'--router.result_json={str((outdir/"native-result.json").resolve())}',f'--user_data_path={str((outdir/"user-data").resolve())}','-da','--logging.file.enabled=false','--api_server.enabled=false']
        meta['command']=command
        try:
            p=subprocess.run(command,capture_output=True,text=True,timeout=args.seconds+10);log=p.stdout+p.stderr;meta['exitCode']=p.returncode;meta['status']='completed' if p.returncode==0 else 'failed'
        except subprocess.TimeoutExpired as e:
            log=(e.stdout or b'').decode()+(e.stderr or b'').decode();meta['status']='process-timeout'
        (outdir/'run.log').write_text(log)
        if sesp.exists():
            result=ses_to_srj(sesp,srj,mapping);(outdir/'routed.json').write_text(json.dumps(result));meta['traceCount']=len(result['traces'])
            meta['netAliases']=mapping['aliases']
            if 'TIMED_OUT' in log or 'completed with timeout:' in log:meta['status']='timeout-with-output'
        native=outdir/'native-result.json'
        if native.exists():
            data=json.loads(native.read_text());meta['nativeFinalState']=data.get('final_state');stats=data.get('board_statistics',{});meta['nativeUnrouted']=stats.get('connections',{}).get('incomplete_count');meta['nativeViolations']=stats.get('clearance_violations');meta['nativeTraceLengthMm']=stats.get('traces',{}).get('total_length_mm');meta['nativeViaCount']=stats.get('vias',{}).get('total_count')
            if meta['nativeFinalState']=='COMPLETED' and meta.get('nativeUnrouted',0)>0:meta['status']='stopped-incomplete'
        if 'ERROR ' in log:meta['nativeErrors']=True
    except Exception as e:meta['status']='setup-error';meta['error']=str(e)
    meta['runtimeMs']=round((time.monotonic()-started)*1000);(outdir/'result.json').write_text(json.dumps(meta,indent=2));print(json.dumps({k:v for k,v in meta.items()if k not in ['command','netAliases']}, separators=(',',':')),flush=True);return meta

def main():
    p=argparse.ArgumentParser();p.add_argument('inputs',nargs='+',type=Path);p.add_argument('--binary',type=Path);p.add_argument('--jar',type=Path);p.add_argument('--output',type=Path,default=Path('work/results/freerouting'));p.add_argument('--seconds',type=int,default=60);p.add_argument('--workers',type=int,default=1);p.add_argument('--fanout',action='store_true',help='Enable upstream fanout; it may violate min-width even with automatic neckdown disabled');p.add_argument('--clearance',type=float,default=.1);p.add_argument('--via-diameter',type=float,default=.3);args=p.parse_args()
    if args.binary is None:
        args.binary=Path('work/freerouting-runtime/jdk-25.0.4.1+1-jre/bin/java')
        args.jar=args.jar or Path('work/freerouting-runtime/freerouting-2.5.0.jar')
    args.output.mkdir(parents=True,exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:results=list(pool.map(lambda path:run_one(path,args),args.inputs))
    (args.output/'summary.json').write_text(json.dumps(results,indent=2))
if __name__=='__main__':main()
