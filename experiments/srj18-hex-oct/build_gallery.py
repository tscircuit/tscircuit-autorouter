"""Build the offline HTML comparison from real, checksum-verified SRJ outputs."""
import base64
import gzip
import html
import json
from collections import defaultdict
from pathlib import Path
from materialize import load_recording

ROOT = Path(__file__).resolve().parent
VARIANTS = [
    ('hex-p020', 'Hex · 0.200 mm'), ('oct-p020', 'Oct · 0.200 mm'),
    ('oct-density020', 'Oct · 0.186 mm, equal density'),
    ('hex-p010', 'Hex · 0.100 mm'), ('oct-density010', 'Oct · 0.093 mm, equal density'),
    ('tscircuit', 'tscircuit · default edge'), ('tscircuit-edge01', 'tscircuit · 0.1 mm edge'),
    ('freerouting', 'FreeRouting · strict width'), ('freerouting-fanout', 'FreeRouting · normal fanout'),
]
COLORS = {'top':'#fb7185','bottom':'#60a5fa','inner1':'#34d399','inner2':'#facc15','inner3':'#fb923c','inner4':'#c084fc'}
METRIC_FIELDS = ['physicallyConnected','routeRequiredConnections','fullyConnected','drcPass','traceCount',
                 'traceLengthMm','viaCount','elapsedMs','solverStatus','newShortPairs','newClearancePairs',
                 'belowMinWidthItems','outsideCopperItems','malformedRouteItems']


def result_geometry(result, layers):
    segments = {layer: [] for layer in layers}
    vias = {}
    for trace in result['traces']:
        route = trace['route']
        for i, point in enumerate(route):
            kind = point['route_type']
            if kind == 'wire' and i + 1 < len(route):
                target = route[i+1]
                if target['route_type'] == 'through_obstacle':
                    target = target['start']
                elif target['route_type'] == 'wire' and target['layer'] != point['layer']:
                    continue  # Never draw an unrepresented layer transition.
                if point['layer'] in segments:
                    segments[point['layer']].append([point['width'],point['x'],point['y'],target['x'],target['y']])
            elif kind == 'via':
                diameter = point.get('outer_diameter',point.get('diameter',point.get('via_diameter',.3)))
                hole = point.get('hole_diameter',point.get('drill_diameter',.15))
                active = layers
                if point.get('via_type') in ['blind','buried']:
                    a,b=sorted([layers.index(point['from_layer']),layers.index(point['to_layer'])])
                    active=layers[a:b+1]
                key=(point['x'],point['y'],diameter,hole,tuple(active))
                vias[key]=[point['x'],point['y'],diameter,hole,active]
            elif kind not in ['wire','through_obstacle']:
                raise ValueError(f'Unsupported recorded route geometry: {kind}')
    return {'segments':segments,'vias':list(vias.values())}


def badge(metric):
    if metric['fullyConnected'] and metric['drcPass']:
        return '<span class="badge complete">Complete + clean</span>'
    if not metric['drcPass']:
        label='Complete + violations' if metric['fullyConnected'] else 'Partial + violations'
        return f'<span class="badge violation">{label}</span>'
    return '<span class="badge partial">Partial + clean</span>'


def main():
    recording=load_recording()
    aggregate={row['variant']:row for row in json.loads((ROOT/'aggregate.json').read_text())}
    summary_rows=[];matrix_rows=[];sections=[];boards=[]
    for variant,label in VARIANTS:
        row=aggregate[variant]
        runs=recording['evaluations'][variant]
        if set(runs) != set(recording['inputs']):
            raise ValueError(f'Incomplete per-board coverage: {variant}')
        expected=[sum(m['physicallyConnected']for m in runs.values()),sum(m['routeRequiredConnections']for m in runs.values()),
                  sum(m['fullyConnected']for m in runs.values()),sum(m['fullyConnected']and m['drcPass']for m in runs.values())]
        actual=[row['connectedRequests'],row['requiredRequests'],row['fullyConnectedBoards'],row['fullyConnectedDrcPassBoards']]
        if actual != expected:
            raise ValueError(f'Aggregate table does not match recorded per-board evaluations: {variant}')
        summary_rows.append(f'<tr><th>{html.escape(label)}</th><td class="number">{row["connectedRequests"]:,} / {row["requiredRequests"]:,} <b>({row["completionPercent"]:.1f}%)</b></td><td>{row["fullyConnectedBoards"]} / 16</td><td>{row["fullyConnectedDrcPassBoards"]} / 16</td><td class="number">{row["medianWallSeconds"]:.1f} s</td></tr>')
    for sample,text in sorted(recording['inputs'].items()):
        source=json.loads(text);n=source['layerCount']
        layers=['top']+[f'inner{i}' for i in range(1,n-1)]+['bottom']
        board={'sample':sample,'name':source['sourceName'],'bounds':source['bounds'],'layers':layers,
               'outline':source['outline'],
               'obstacles':[{key:o[key] for key in ['type','center','width','height','layers','ccwRotationDegrees'] if key in o}
                            for o in source['obstacles']], 'results':{}}
        name=html.escape(source['sourceName'].replace('_',' '));cards=[];cells=[]
        for variant,label in VARIANTS:
            result=recording['results'][variant][sample]
            metric=recording['evaluations'][variant][sample]
            board['results'][variant]={**result_geometry(result,layers),'metrics':{key:metric[key]for key in METRIC_FIELDS}}
            fraction=f'{metric["physicallyConnected"]}/{metric["routeRequiredConnections"]}'
            state=html.escape(metric['solverStatus'])
            errors=metric['newShortPairs']+metric['newClearancePairs']+metric['belowMinWidthItems']+metric['outsideCopperItems']+metric['malformedRouteItems']
            cells.append(f'<td><a href="#{sample}" data-jump-variant="{variant}">{badge(metric)}<small class="number">{fraction} requests</small></a></td>')
            empty='<p class="empty-note">No final copper exported at the cap. Internal unstitched fragments may exist.</p>' if metric['traceCount']==0 else ''
            error_note=f'<p class="empty-note">{errors} geometry / width findings. Full request connectivity does not imply clean copper.</p>' if not metric['drcPass'] else ''
            cards.append(f'''<article class="router-card" data-variant="{variant}" data-sample="{sample}">
              <div class="card-head"><h3>{html.escape(label)}</h3><div class="card-status">{badge(metric)}<span class="solver-status">{state}</span></div></div>
              <div class="image-stage"><img class="board-image" alt="Recorded copper loading" width="1200" height="800"></div>
              <div class="card-metrics"><div><b>{fraction}</b><small>connections completed</small></div><div><b>{metric['viaCount']:,}</b><small>vias</small></div><div><b>{metric['traceLengthMm']:,.1f} mm</b><small>routed length</small></div></div>
              <div class="card-footer"><button class="inspect" type="button">Inspect / zoom</button><span class="subtle">{metric['elapsedMs']/1000:.1f} s</span><a class="download-svg">Save SVG</a></div>{empty}{error_note}
              </article>''')
        matrix_rows.append(f'<tr><th><a href="#{sample}">{sample}</a><br><span class="subtle">{name}</span></th>{"".join(cells)}</tr>')
        options='<option value="all">All copper layers</option>'+''.join(f'<option value="{layer}">{layer}</option>' for layer in layers)
        legend=''.join(f'<span><i class="swatch" style="background:{COLORS[layer]}"></i>{layer}</span>' for layer in layers)+'<span><i class="swatch" style="background:#e879f9"></i>vias / drill holes</span>'
        sections.append(f'''<section class="board" id="{sample}"><div class="board-header"><div><p class="sample-id">{sample} · {n} copper layers</p><h2>{name}</h2></div><div class="board-actions"><label for="layer-{sample}">Compare layer</label><select class="board-layer" id="layer-{sample}">{options}</select><button data-scroll="-1" aria-label="Previous router cards">←</button><button data-scroll="1" aria-label="Next router cards">→</button></div></div><div class="router-row" aria-label="Router comparison for {name}">{"".join(cards)}</div><div class="layer-legend">{legend}</div></section>''')
        boards.append(board)
    data={'variants':[{'id':v,'label':l}for v,l in VARIANTS],'boards':boards}
    encoded=json.dumps(data,separators=(',',':')).encode()
    payload=base64.b64encode(gzip.compress(encoded,compresslevel=9,mtime=0)).decode()
    css=(ROOT/'src/gallery.css').read_text();script=(ROOT/'gallery.js').read_text()
    jump_options=''.join(f'<option value="{b["sample"]}">{b["sample"]} · {html.escape(b["name"].replace("_"," "))}</option>' for b in boards)
    page=f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SRJ18 · Hex / Oct routing comparison</title><style>{css}</style></head><body><main>
    <header><div class="eyebrow">tscircuit · routing research · 14 October 2026</div><h1>SRJ18 routing, side by side.</h1><p class="intro">Compare the actual routed copper from every autorouter configuration on all 16 boards. The tables show independently measured connectivity and geometry checks. Scroll each board’s single row to compare routers, choose a copper layer, then zoom in to inspect traces and drilled vias.</p><div class="meta"><span>16 real boards</span><span>9 router configurations</span><span>2,194 nontrivial requests</span><span>60-second routing caps</span></div></header>
    <h2>Overall routing results</h2><div class="table-shell"><table aria-label="Overall routing results"><thead><tr><th>Router</th><th>Connections completed</th><th>Complete boards</th><th>Complete + clean boards</th><th>Median observed time</th></tr></thead><tbody>{''.join(summary_rows)}</tbody></table></div><p class="note">“Complete + clean” requires physical connectivity and no new geometry findings at the common 0.1 mm trace / clearance rules. A clean partial output can still leave many connections unfinished. Single-terminal records are excluded. FreeRouting times include startup and export beyond its internal cap; concurrent host timing is provisional.</p>
    <h2>Which router solved each board?</h2><div class="table-shell"><table class="matrix" aria-label="Per-board completion matrix"><thead><tr><th>SRJ18 problem</th>{''.join('<th>'+html.escape(label)+'</th>'for _,label in VARIANTS)}</tr></thead><tbody>{''.join(matrix_rows)}</tbody></table></div><div class="key"><span class="badge complete">Complete + clean</span><span class="badge partial">Partial + clean</span><span class="badge violation">Geometry / width violations</span><span>Click a cell to jump to that router’s image.</span></div>
    <div class="gallery-toolbar"><h2>Inspect the routed boards</h2><label>Jump to board<select id="jump-board">{jump_options}</select></label></div><p class="note" id="load-status" role="status">Loading the recorded SRJ copper images…</p><noscript><p class="error">Enable JavaScript to view the offline vector images; the result tables remain available above.</p></noscript>
    {''.join(sections)}<footer class="footer">Rendered from checksum-verified, recorded Simple Route JSON; no paths are inferred or generated for the images. Every copper layer is available. The geometry checker is an SRJ comparison check, rather than a complete fabrication DRC. <a href="https://github.com/tscircuit/dataset-srj18/tree/b38e23cb1941084d1f77c935699eff425a902db5">Pinned SRJ18 dataset</a>. The normal FreeRouting fanout variant includes sub-minimum widths; the strict variant disables fanout. tscircuit uses capacity-autorouter 0.0.983, local pipeline 9, effort 1.</footer></main>
    <dialog id="detail"><div class="detail-header"><h2 id="detail-title">Inspect routed copper</h2><button id="detail-close" aria-label="Close copper inspector">Close ×</button></div><div class="detail-controls"><label for="detail-layer">Copper layer</label><select id="detail-layer"></select><button id="zoom-out" aria-label="Zoom out">−</button><span id="zoom-label">100%</span><button id="zoom-in" aria-label="Zoom in">+</button><button id="zoom-reset">Reset</button><span>Scroll to inspect the enlarged image · magenta rings show vias and drill holes</span></div><div class="detail-stage"><img id="detail-image" alt="Enlarged routed copper" width="1200" height="800"></div></dialog>
    <script>window.SRJ18_GALLERY_GZIP="{payload}";</script><script>{script}</script></body></html>'''
    (ROOT/'gallery.html').write_text(page)
    print(f'Built standalone gallery: 16 rows, 144 router cards, {sum(len(b["layers"])for b in boards)*9} individual-layer views; {len(page.encode()):,} bytes')


if __name__=='__main__':
    main()
