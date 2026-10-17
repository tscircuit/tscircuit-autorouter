def fixture():
    return {'bounds':{'minX':-1,'maxX':11,'minY':-2,'maxY':2},'layerCount':2,'minTraceWidth':.1,
            'obstacles':[], 'connections':[{'name':'a','pointsToConnect':[{'x':0,'y':0,'layer':'top'},
                                                                       {'x':10,'y':0,'layer':'top'}]}]}

def trace(name, points, layer='top'):
    return {'type':'pcb_trace','connection_name':name,'route':[{'route_type':'wire','x':x,'y':y,'layer':layer,'width':.1} for x,y in points]}
