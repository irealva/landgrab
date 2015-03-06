# todo: handle cases where the boundary crosses the dateline

# from __future__ import print_function
from __future__ import division
import requests, json, time, math, re, sys, os
from sys import stdout
from numpy import *
import numpy as np
import colorsys
import xml.etree.ElementTree as ET
import pprint
from random import randint
from Polygon import *
# from Polygon.Utils import *
from Polygon.IO import *
# OSMID=sys.argv[1]
# zoom=int(sys.argv[2])

files = []
inf = float('inf')
tilemin = [inf, inf]
tilemax = [0, 0]
p = re.compile('(\d*)-(\d*)-(\d*).*')
path = "tiles"
for f in os.listdir(path):
    if f.endswith(".json"):
        files.append(path+"/"+f)
        # convert matches to ints and store in m
        m = [int(i) for i in p.findall(f)[0]]
        latlong = [m[1], m[2]]
        tilemin = [min(tilemin[0], latlong[0]), min(tilemin[1], latlong[1])]
        tilemax = [max(tilemax[0], latlong[0]), max(tilemax[1], latlong[1])]

# print "min:", tilemin, "max:", tilemax

tiles = []

def xtolong(x, z):
    return x / pow(2.0, z) * 360.0 - 180

def ytolat(y, z):
    n = 2.0 ** z
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
    return math.degrees(lat_rad)

class Tile:
    def __init__(self, filename, x, y, z, data):
        self.path = filename
        self.x = x
        self.y = y
        self.data = data

        self.bounds = Polygon(((xtolong(x,z), ytolat(y,z)), (xtolong(x+1,z), ytolat(y,z)), (xtolong(x+1,z), ytolat(y+1,z)), (xtolong(x,z), ytolat(y+1,z))))
        
        self.bbox = [inf,inf,-inf,-inf]
        self.polys = []

for t in files:
    f = open(t, 'r')

    # run the filename through the regex - m = saved matches 
    # example: [15, 9646, 12319]
    m = [int(i) for i in p.findall(t)[0]]
    filedata = f.read()
    tile = Tile(t, m[1], m[2], m[0], filedata)
    tiles.append(tile)

print "Processing", len(tiles), "tiles:"

# naming conventions for clarity:
# "jpoly" will be a polygon defined in json - "poly" will be a Polygon()
# "jcontour" will be a contour of a jpoly - "contour", that of a poly

# expand bbox1 to include bbox2
def updateBbox(bbox1, bbox2):
    new = [bbox1[0], bbox1[1], bbox1[2], bbox1[3]]
    new[0] = min(bbox1[0], bbox2[0])
    new[1] = min(bbox1[1], bbox2[1])
    new[2] = max(bbox1[2], bbox2[2])
    new[3] = max(bbox1[3], bbox2[3])
    return new

def overlapsEnough(p, q):
    if p.overlaps(q):
        if ((p & q).area() > 5e-09):
            return True
    return False

def centroid(p):
    c = [0,0]
    for v in p[0]:
        c = [c[0]+v[0], c[1]+v[1]]
    return (c[0]/len(p[0]), c[1]/len(p[0]))

# a flat list of all the polygons in the scene
# alljpolys = []

# create a non-duplicated set of all the jpolys in the scene
# buildingcount = 0
# contourcount = 0




## convert json polys to Polygon() objects

for i, t in enumerate(tiles):
    percent = abs(round(( i / len(tiles) * 100), 0))
    stdout.write("\r%d%%"%percent)
    stdout.flush()
    j = json.loads(t.data)

    # for each building
    buildings = j["buildings"]["features"]
    for b in buildings:
        # buildingcount += 1
        # make a list of all the contours in the jpoly
        contours = b["geometry"]["coordinates"]
        if not b["id"]:
            print "whoa"
            sys.exit()
        
        # new Polygon object
        poly = Polygon()
        poly.id = b["id"]

        # for each contour in the jpoly
        for c in contours:
            # contourcount += 1
            # remove last redundant coordinate from each contour
            del c[-1]
            # for each vertex
            # for v in c:
                # offset all verts in tile to arrange in scenespace
                # this isn't necessary when the data is coming straight from the json,
                # only when the data is coming from a tangram vbo
                # v = [v[0]+(4096*(tilemax[0]-tile.x)), v[1]+(4096*(tilemax[1]-tile.y))]

            poly.addContour(c)
            # update tile's bbox with contour's bbox
            t.bbox = updateBbox(t.bbox, list(poly.boundingBox()))

        t.polys.append(poly)

stdout.write("\r100%\n")
stdout.flush()

# polys = [p for p in t.polys for t in tiles]
# print len(polys)
polys = []
for t in tiles:
    for p in t.polys:
        polys.append(p)

print "\nChecking", len(polys), "polys for overlap:"
groups = [] # all buildings
contains = [] # all shapes which completely contain other shapes
overlaps = [] # all shapes which touch other shapes
area = []
areas = []
sortedpolys = []
count = 0
total = np.float64(np.sum(range(len(polys)))*2)

# check for intersection of two bounding boxes
def bboxIntersect(bbox1, bbox2):
    if (bbox1[2]<bbox2[0] or bbox2[2]<bbox1[0] or bbox1[3]<bbox2[1] or bbox2[3]<bbox1[1]):
        return False
    else:
        return True

## Group overlapping polygons and assign whole groups to tiles

grouped = []
toremove = []

# for every tile
for i, tile in enumerate(tiles):
    # for every poly in the tile
    for j, p in enumerate(tile.polys):

        # progress percentage indicator
        percent = abs(round(((len(grouped))/len(polys) * 100), 0))
        stdout.write("\r%d%%"%percent)
        stdout.flush()
        
        # if this is a copy of one we've already seen:
        if p.id in grouped:
            # it is redundant, mark it for removal
            toremove.append([tile, p])
            # skip to the next poly
            continue

        # otherwise, add it to the register
        grouped.append(p.id)        
        # start a new group
        group = [p]

        groupsToJoin = set()
        # check overlaps with polys in preexisting groups first
        for k, g in enumerate(groups):
            for poly in g:
                # if p.id != poly.id and p.overlaps(poly):
                if p.id != poly.id and overlapsEnough(p, poly):
                    groupsToJoin.add(k)

        groupsToJoin = list(groupsToJoin)

        # combine and flatten all implicated groups into the new group
        for i in groupsToJoin: group += groups[i]
        # once the combination is done, delete the implicated groups
        # (slightly more complex because groupsToJoin is a list of indices)
        # set groups to be the list all the elements which aren't indexed in groupsToJoin
        groups[:] = [x for ind, x in enumerate(groups) if ind not in groupsToJoin]

        # check against all other polys in all other tiles
        for t in tiles:
            # skip self, skip any tiles whose bbox doesn't overlap self's bbox
            if (tile == t) or (not bboxIntersect(tile.bbox, t.bbox)): continue

            # now checking tile.polys[p] against all polys 'q' in t.polys
            for q in t.polys:
                # if q is a copy of p
                if p.id == q.id:
                    # mark it for removal
                    toremove.append([t, q])
                    # skip to next q poly
                    continue
                # if p.overlaps(q):
                if overlapsEnough(p, q):
                    if len(group) > 100:
                        print p.id
                        sys.exit()
                    good = True
                    # if q is already in the group, mark it for removal
                    for x in group:
                        if x.id == q.id:
                            toremove.append([t, q])
                            good = False
                    # otherwise add q to the group
                    if good: group.append(q)

        groups.append(group)


stdout.write("\r100%\n")
stdout.flush() 

for g in groups:
    if len(g) > 1:
        overlaps.append(g)

# print "groups:", len(grouped)
# print "removed:", len(toremove)
print "\nAssigning", len(groups), "groups to tiles:"


# remove redundant polys
# each entry is a list: [tile, poly]
for r in toremove:
    if r[1] in r[0].polys:
        r[0].polys.remove(r[1])

# assign groups to tiles
for g in groups:
    # sort all polys in group by area
    g.sort(key=lambda p: p.area)
    # assume poly with largest area is the outermost polygon
    outer = g[0]
    # find "home" tile in which the outer's centroid lies
    c = centroid(outer)
    home = None
    for i, t in enumerate(tiles):
        if t.bounds.isInside(c[0], c[1]):
            home = t
    # if the poly's centroid is outside of all the tiles,
    # the poly is homeless - leave it where it is for now
    if home == None:
        # skip to the next group
        continue

    # for each polygon in the group
    for p in g:
        # copy poly to home tile
        if home != "":
            home.polys.append(p)
        # remove from all other tiles
        for t in tiles:
            if t != home:
                if p in t.polys:
                    t.polys.remove(p)





# flatten lists for writing to svg
groups2 = [item for sublist in groups for item in sublist] 
overlaps2 = [item for sublist in overlaps for item in sublist] 

overlap_count = len(overlaps2)



stdout.write("\r100%\n")
stdout.flush() 

## SVG OUTPUT

# color each tile randomly
strokecolor = ()
allpolys = []
for i, t in enumerate(tiles):
    color = ((colorsys.hsv_to_rgb(random.random(), 1., 1.)),)
    color = (tuple([int(i*255) for i in list(color[0])]),)
    # add tile bounds to polys list, to visualize it in the svg
    allpolys.append(t.bounds)
    # add a color entry, to color the boundary
    strokecolor += color
    for p in t.polys:
        # add the poly to the poly list and a corresponding color entry to the colors list
        allpolys.append(p)
        strokecolor += color
    # writeSVG('t%d.svg'%i, tiles[i].polys, height=800, stroke_width=(1, 1), stroke_color=(strokecolor,), fill_opacity=((0),), )

# strokecolor = ((0, 0, 0), (255, 0, 0), (0, 255, 0))
# print strokecolor
# writeSVG('t%d.svg'%i, allpolys, height=800, stroke_width=(1, 1), stroke_color=(strokecolor,), fill_opacity=((0),), )
# writeSVG('t%d.svg'%i, allpolys, height=800, stroke_width=(1, 1), stroke_color=strokecolor, fill_opacity=((0),), )
# writeSVG('allpolys.svg', allpolys, height=800, stroke_width=(1, 1), fill_opacity=((0),), )
writeSVG('allpolys.svg', allpolys, height=2000, stroke_width=(2, 2), stroke_color=strokecolor, fill_opacity=((0),), )

sys.exit()

# done!






## TODO
# check ids of all polys after conversion and remove jpolys not in the list
# write json tiles back out





























# print r.encoding
open('outfile.xml', 'w').close() # clear existing OUTFILE

with open('outfile.xml', 'w') as fd:
  fd.write(r.text.encode("UTF-8"))
  fd.close()

try:
    tree = ET.parse('outfile.xml')
except Exception, e:
    print e
    print "XML parse failed, please check outfile.xml"
    sys.exit()

root = tree.getroot()

points = []
tiles = []

##
## HELPER FUNCTIONS
##

tile_size = 256
half_circumference_meters = 20037508.342789244;

# Convert lat-lng to mercator meters
def latLngToMeters( coords ):
    y = float(coords['y'])
    x = float(coords['x'])
    # Latitude
    y = math.log(math.tan(y*math.pi/360 + math.pi/4)) / math.pi
    y *= half_circumference_meters

    # Longitude
    x *= half_circumference_meters / 180;

    return {"x": x, "y": y}

# convert from tile-space coords to meters, depending on zoom
def tile_to_meters(zoom):
    return 40075016.68557849 / pow(2, zoom)

# Given a point in mercator meters and a zoom level, return the tile X/Y/Z that the point lies in
def tileForMeters(coords, zoom):
    y = float(coords['y'])
    x = float(coords['x'])
    return {
        "x": math.floor((x + half_circumference_meters) / (half_circumference_meters * 2 / pow(2, zoom))),
        "y": math.floor((-y + half_circumference_meters) / (half_circumference_meters * 2 / pow(2, zoom))),
        "z": zoom
    }

# Convert tile location to mercator meters - multiply by pixels per tile, then by meters per pixel, adjust for map origin
def metersForTile(tile):
    return {
        "x": tile['x'] * half_circumference_meters * 2 / pow(2, tile.z) - half_circumference_meters,
        "y": -(tile['y'] * half_circumference_meters * 2 / pow(2, tile.z) - half_circumference_meters)
    }

## de-dupe
newtiles = [dict(tupleized) for tupleized in set(tuple(item.items()) for item in newtiles)]
## add fill tiles to boundary tiles
tiles = tiles + newtiles
## de-dupe
tiles = [dict(tupleized) for tupleized in set(tuple(item.items()) for item in tiles)]


if coordsonly == 1:
    ## output coords
    # pprint.pprint(tiles)
    print "Finished: %i tiles at zoom level %i" % (len(tiles), zoom)
else:
    ## download tiles
    print "Downloading %i tiles at zoom level %i" % (len(tiles), zoom)

    ## make/empty the tiles folder
    folder = "tiles1"
    if not os.path.exists(folder):
        os.makedirs(folder)

    for the_file in os.listdir(folder):
        file_path = os.path.join(folder, the_file)
        try:
            if os.path.isfile(file_path):
                os.unlink(file_path)
        except Exception, e:
            print e

    total = len(tiles)
    if total == 0:
        print("Error: no tiles")
        exit()
    count = 0
    sys.stdout.write("\r%d%%" % (float(count)/float(total)*100.))
    sys.stdout.flush()
    for tile in tiles:
        tilename = "%i-%i-%i.json" % (zoom,tile['x'],tile['y'])
        r = requests.get("http://vector.mapzen.com/osm/all/%i/%i/%i.json" % (zoom, tile['x'],tile['y']))
        j = json.loads(r.text)

        # extract only buildings layer - mapzen vector tile files are collections of jeojson objects -
        # doing this turns each file into a valid standalone geojson files -
        # you can replace "buildings" with whichever layer you want
        # j = json.dumps(j["buildings"]) 

        # use this jumps() command instead for the original feature collection with all the data
        j = json.dumps(j);

        with open('tiles/'+tilename, 'w') as fd:
            fd.write(j.encode("UTF-8"))
            fd.close()
        count += 1
        sys.stdout.write("\r%d%%" % (float(count)/float(total)*100.))
        sys.stdout.flush()
        