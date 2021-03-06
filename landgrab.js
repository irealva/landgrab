var tile_size = 256;
const half_circumference_meters = 20037508.342789244;

function range(start, end) {
    // console.log('range ', start, end)
  return Array.apply(0, Array(end - start))
    .map(function (element, index) { 
      return index + start;
  });
}

function dedupe(b) {
    a = [];
    b.forEach(function(value){
        if (a.indexOf(value)==-1) a.push(value);
    });
    return a;
}

function getHttp(url, type, callback) {
    var xhr = new XMLHttpRequest();
    var method = 'GET';
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4 && xhr.status === 200) {
            if (type === "text" || type === "json") {
                var response = xhr.responseText;
            } else {
                response = xhr.response;
                // console.log('response?', response)
            }
            var error = null;
            callback(error, response);
        } else if (xhr.readyState === 4 && xhr.status === 404) {
            var error = 'nope';
            callback(error, response);
        }
    };
    xhr.open(method, url, true);
    if (type !== "text" && type !== "json") xhr.responseType = "arraybuffer";
    xhr.send();
}

// Convert lat-lng to mercator meters
function latLngToMeters( coords ) {
    y = parseFloat(coords['y']);
    x = parseFloat(coords['x']);
    // Latitude
    y = Math.log(Math.tan(y*Math.PI/360 + Math.PI/4)) / Math.PI;
    y *= half_circumference_meters;

    // Longitude
    x *= half_circumference_meters / 180;

    return {"x": x, "y": y};
}

// convert from tile-space coords to meters, depending on zoom
function tile_to_meters(zoom) {
    return 40075016.68557849 / Math.pow(2, zoom);
}

// Given a point in mercator meters and a zoom level
// return the tile X/Y/Z that the point lies in
function tileForMeters(coords, zoom) {
    y = parseFloat(coords['y']);
    x = parseFloat(coords['x']);
    return {
        "x": Math.floor((x + half_circumference_meters) / (half_circumference_meters * 2 / Math.pow(2, zoom))),
        "y": Math.floor((-y + half_circumference_meters) / (half_circumference_meters * 2 / Math.pow(2, zoom))),
        "z": zoom
    }
}

// Convert tile location to mercator meters - multiply by pixels per tile,
// then by meters per pixel, adjust for map origin
function metersForTile(tile) {
    return {
        "x": tile['x'] * half_circumference_meters * 2 / Math.pow(2, tile.z) - half_circumference_meters,
        "y": -(tile['y'] * half_circumference_meters * 2 / Math.pow(2, tile.z) - half_circumference_meters)
    }
}

// grab land
// expects an OpenStreetMap ID integer, a zoom argument string, and a format string
// examples:
// landgrab(209879879874648, "0-3, 1, 12", "list")
// landgrab(204648, "0-3, 1, 12", "terrain")
// landgrab(3954665, 16, "vector")
// landgrab(3954665, 14) // default type is "list"
function landgrab(OSMID, zoomarg, format = "list", api_key) {
    window.oldTitle = document.title;

    if (zoomarg != scene.zoom) {
        map.setZoom(zoomarg);
    }

    console.log('OSMID:', OSMID, 'zoomarg:', zoomarg, 'format:', format);
    if (arguments.length < 2) {
        console.log("At least 2 arguments needed - please enter an OSM ID and zoom level.")
        return false;
    }

    zoom = [];
    console.log('String(zoomarg).split(","):', String(zoomarg).split(','))
    // parse zoom argument – accepts a comma-separated list and ranges in the form start-stop
    // eg: "1,3,5-8"
    zoomarg = String(zoomarg).replace(/\s+/g, '');
    String(zoomarg).split(',').forEach(function(part) {
        if (part.indexOf('-') > -1) {
            split = part.split('-')
            a = parseInt(split[0]);
            b = parseInt(split[1]);
            zoom.push.apply(zoom, range(a, b + 1))
        } else {
            a = parseInt(part);
            zoom.push(a);
        }
    });
    zoom = dedupe(zoom);

    // get points
    getPoints(OSMID, function(response){
        points = parseFile(response)

        getBbox(points);

        // GET TILES for all zoom levels
        tiles = [];
        for (z in zoom) {
            tiles.push(getTiles(points, zoom[z]));
        }

        if (format === "list") {
            // output coords
            tiles = getBBoxTiles(tiles);
            console.log(JSON.stringify(tiles));
            console.log("Finished:", tiles.length, "tiles at zoom level", zoom);
        } else if (format === "vbo") {
            // load tiles
            console.log("Downloading", tiles.length, "tiles at zoom level", zoom);
            grabVBOs(getBBoxTiles(tiles));
            // pull in functionality from manhattan-project
        } else if (format === "vector") {
            grabVectorTiles(tiles, api_key);
        } else if (format === "terrain-png") {
            grabTerrainTiles(getBBoxTiles(tiles), api_key);
        } else if (format === "terrain-tif") {
            grabTerrainTiffs(tiles, api_key);
        }
    });
}

function getBbox(points) {
    var minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (var i = 0; i < points.length; i++) {
        minx = Math.min(minx, points[i].x);
        maxx = Math.max(maxx, points[i].x);
        miny = Math.min(miny, points[i].y);
        maxy = Math.max(maxy, points[i].y);
    }
    console.log('bbox:',miny, minx, maxy, maxx)
}

function getPoints(OSMID, callback) {
    // try to download the node's xml from OSM
    // three possible element types: relation, way, and node
    INFILE = 'http://www.openstreetmap.org/api/0.6/relation/'+OSMID+'/full';
    console.log("Downloading relation:", INFILE);
    getHttp(INFILE, 'text', function(err, res){
    if (err) {
        console.error('no relation:', err);
        INFILE = 'http://www.openstreetmap.org/api/0.6/way/'+OSMID+'/full';
        console.log("Downloading way:", INFILE);
        getHttp(INFILE, 'text', function(err, res){
        if (err) {
            console.error('no way:', err);

            INFILE = 'http://www.openstreetmap.org/api/0.6/node/'+OSMID;
            console.log("Downloading node:", INFILE);
            getHttp(INFILE, 'text', function(err, res){
            if (err) {
                console.error('no node:', err);
            } else {
                console.log('node received')
                callback(res);
            }
            });
        } else {
            console.log('way received')
            callback(res);
        }
        });
    } else {
        console.log('relation received')
        callback(res);
    }
    });
}

// parse an XML response from the OSM API and extract latlon points
// which make up the outline of the object
function parseFile(res) {
    parser = new DOMParser();
    response = parser.parseFromString(res, "text/xml");
    // console.log('xml:', response)

    var xmlroot = response.documentElement;

    // extract points from XML response
    points = [];
    for (n in xmlroot.children) {
        node = xmlroot.children[n];
        if (node.tagName == "node") {
            lat = parseFloat(node.getAttribute("lat"));
            lon = parseFloat(node.getAttribute("lon"));
            points.push({'y':lat, 'x':lon});
        }
    }

    return points;
}

function dedupeArray(a) {
    var newset = new Set();
    var newarray = [];
    for (i in a) {
        newset.add(JSON.stringify(a[i]));
    }
    newset.forEach(function(t){
        newarray.push(JSON.parse(t));
    });
    return newarray;
}

function getTiles(points,zoom) {
    tiles = [];
    var tilesset = new Set();
    for (p in points) {
      point = points[p];
        tile = JSON.stringify(tileForMeters(latLngToMeters({'x':point['x'],'y':point['y']}), zoom));
        tilesset.add(tile);
    }

    tilesset.forEach(function (t) {
        tiles.push(JSON.parse(t));
    });
    // console.log('number of tiles:', tiles.length);

    // patch holes in tileset

    // get min and max tiles for lat and long
    // set min vals to maximum tile #s + 1 at zoom 21
    minx = 2097152;
    maxx = -1;
    miny = 2097152;
    maxy = -1;
    // console.log("tiles:"+JSON.stringify(tiles));
    for (t in tiles) {
        tile = tiles[t];
        minx = Math.min(minx, tile['x'])
        maxx = Math.max(maxx, tile['x'])
        miny = Math.min(miny, tile['y'])
        maxy = Math.max(maxy, tile['y'])
    }
    console.log(miny, minx, maxy, maxx);

    // not working
    // newtiles = getOutlineTiles(tiles);
    newtiles = getBBoxTiles(tiles);

    // console.log('newtiles length:', newtiles.length);
    // dedupe
    newtiles = dedupeArray(newtiles);
    // console.log('newtiles length:', newtiles.length);
    
    // add fill tiles to boundary tiles
    tiles.concat(newtiles);

    return newtiles;
    return tiles;
}

// get all tiles in the bbox that contains the tileset
function getBBoxTiles(tiles) {
    // console.log('tiles:', tiles)
    var range = findTileRange(tiles);
    console.log('tile range:', range)
    min = range[0];
    max = range[1];
    var bboxtiles = [];
    for (var x = min.x; x <= max.x; x++) {
        for (var y = min.y; y <= max.y; y++) {
            for (var z = min.z; z <= max.z; z++) {
                bboxtiles.push({x:x, y:y, z:z})
            }
        }

    }
    return bboxtiles;
    // console.log(bboxtiles)
// debugger
}

// this tried to just download the tiles on the feature and then fill in - too complex
function getOutlineTiles(tiles) {
    newtiles = [];
    for (t in tiles) {
        tile = tiles[t];
        // console.log('tile:', tile)
        // find furthest tiles from this tile on x and y axes
        // todo: check across the dateline, maybe with some kind of mod(360) -
        // if a closer value is found, use that instead and warp across the antimeridian
        x = tile['x'];
        lessx = 2097152;
        morex = -1;
        y = tile['y'];
        lessy = 2097152;
        morey = -1;
        for (t2 in tiles) {
            if (parseInt(tiles[t2]['x']) == parseInt(tile['x']) ) {
                // check on y axis
                lessy = Math.min(lessy, tiles[t2]['y']);
                morey = Math.max(morey, tiles[t2]['y']);
            }
            if (parseInt(tiles[t2]['y']) == parseInt(tile['y'])) {
                // check on x axis
                lessx = Math.min(lessx, tiles[t2]['x']);
                morex = Math.max(morex, tiles[t2]['x']);
            }
        }

        // console.log(lessx, lessy, morex, morey)
        // if a tile is found which is not directly adjacent, add all the tiles between the two
        // not sure how this works anymore
        if ((lessy + 2) < tile.y) {
            // console.log(1, lessy, '+ 2 <', tile.y)
            r = range(lessy+1, tile.y);
            for (i in r) {
                newtiles.push({'x':tile.x, 'y':r[i], 'z':zoom});
            }
        }
        if ((morey - 2) > tile.y) {
            // console.log(2, morey, '- 2 >', tile.y)
            r = range(tile.y, morey-1);
            for (i in r) {
                newtiles.push({'x':tile.x, 'y':r[i], 'z':zoom});
            }
        }
        if ((lessx + 2) < tile.x) {
            // console.log(3)
            r = range(lessx+1, tile.x);
            for (i in r) {
                newtiles.push({'x':r[i], 'y':tile.y, 'z':zoom});
            }
        }
        if ((morex - 2) > tile.x) {
            // console.log(4)
            r = range(tile.x, morex-1);
            for (i in r) {
                newtiles.push({'x':r[i], 'y':tile.y, 'z':zoom});
            }
        }
    }
    return newtiles
}

function findTileRange(tiles) {
    var min = {x: Infinity, y: Infinity, z: Infinity};
    var max = {x:-Infinity, y: -Infinity, z: -Infinity};
    for (t in tiles) {
      mt = tiles[t];

      min.x = Math.min(min.x, mt.x);
      min.y = Math.min(min.y, mt.y);
      min.z = Math.min(min.z, mt.z);
      max.x = Math.max(max.x, mt.x);
      max.y = Math.max(max.y, mt.y);
      max.z = Math.max(max.z, mt.z);
    }
    return [min, max];
}

// grab vector tiles from Mapzen datasource
function grabVectorTiles(tiles, api_key) {

    // console.log('grab vector:', tiles);
    var receivedTiles = [];
    for (tile of tiles) {
        // console.log(tile)
    // http://tile.mapzen.com/mapzen/vector/v1/{layers}/{z}/{x}/{y}.{format}?api_key={api_key}
        var source = 'http://tile.mapzen.com/mapzen/vector/v1/water/';
        var address = tile.z+'/'+tile.x+'/'+tile.y;
        var filetype = ".json"
        var name = tile.z+'-'+tile.x+'-'+tile.y+filetype;
        var auth = '?api_key='+api_key;
        var url = source+address+filetype+auth;
        // console.log(url)
        getHttp(url, 'json', function(err, res){
            if (err) {
                console.error(err)
            } else {
                receivedTiles.push({name: this.name, file: res});
                // console.log('response received:', res);
                if (receivedTiles.length === tiles.length) {
                    zipFiles(receivedTiles, "json");
                }
            }
        }.bind({name:name}));
    }
}

// grab terrain tiles from Mapzen
function grabTerrainTiles(tiles, api_key) {
    console.log('grab terrain')
    // console.log('grab vector:', tiles)
    var receivedTiles = [];
    for (tile of tiles) {
        // console.log(tile)
    // https://tile.mapzen.com/mapzen/terrain/v1/terrarium/{z}/{x}/{y}.{format}?api_key={api_key}
        var source = 'http://tile.mapzen.com/mapzen/terrain/v1/terrarium/';
        var address = tile.z+'/'+tile.x+'/'+tile.y;
        var filetype = ".png"
        var name = tile.z+'-'+tile.x+'-'+tile.y+filetype;
        var auth = '?api_key='+api_key;
        var url = source+address+filetype+auth;
        console.log('url:', url)
        getHttp(url, 'png', function(err, res){
            if (err) {
                console.error(err)
            } else {
                receivedTiles.push({name: this.name, file: res});
                // console.log('response received:', res);
                if (receivedTiles.length === tiles.length) {
                    // saveAs(new Blob([res], {type:"image/png"}),name);
                    zipFiles(receivedTiles, "png");
                }
            }
        }.bind({name:name}));
    }
}

// grab terrain geotiffs from Mapzen
function grabTerrainTiffs(tiles, api_key) {
    console.log('grab terrain tiffs')
    // console.log('grab vector:', tiles)
    var receivedTiles = [];
    for (tile of tiles) {
        // console.log(tile)
    // https://tile.mapzen.com/mapzen/terrain/v1/terrarium/{z}/{x}/{y}.{format}?api_key={api_key}
        var source = 'http://tile.mapzen.com/mapzen/terrain/v1/geotiff/';
        var address = tile.z+'/'+tile.x+'/'+tile.y;
        var filetype = ".tif"
        var name = tile.z+'-'+tile.x+'-'+tile.y+filetype;
        var auth = '?api_key='+api_key;
        var url = source+address+filetype+auth;
        console.log('url:', url)
        getHttp(url, 'tif', function(err, res){
            if (err) {
                console.error(err)
            } else {
                receivedTiles.push({name: this.name, file: res});
                // console.log('response received:', res);
                if (receivedTiles.length === tiles.length) {
                    // saveAs(new Blob([res], {type:"image/tif"}),name);
                    zipFiles(receivedTiles, "tif");
                }
            }
        }.bind({name:name}));
    }
}

// export VBOs from Tangram
function grabVBOs(tiles) {

    console.log("Beginning VBO export");

    var num = tiles.length;
    // console.log("Loading", num, "tiles");

    // find tile range, for offset calculation
    var [min, max] = findTileRange(tiles);

    // prepare a list of vbos
    vbos = [];
    vbosProcessed = 0;

    function waitForVerts(callback, coords, offset, name) {
        // console.log('waiting for verts. callback:', callback)
      var coords = coords;
      var name = name;
      // have to use a timeout because there's no callback in Tangram for this
      setTimeout(function () {
        // console.log('coords:', coords)
        // console.log('typeof scene.tile_manager.tiles[coords]:',typeof scene.tile_manager.tiles[coords]);

        // wait for tile to load
        // todo: determine which of these are necessary
        // also todo: trigger this based on a loadCoordinate callback instead

        // coords should look like mapzen/16/19294/24642/16
        if (typeof scene.tile_manager.tiles[coords] != "undefined") {

          if ( scene.tile_manager.tiles[coords].loaded != false) {
            if ( Object.keys(scene.tile_manager.tiles[coords].meshes).length != 0) {

              // if (typeof scene.tile_manager.tiles[coords].meshes.polygons != "undefined" || typeof scene.tile_manager.tiles[coords].meshes.lines != "undefined") {

              //   if (typeof scene.tile_manager.tiles[coords].meshes.polygons.vertex_data != "undefined" || typeof scene.tile_manager.tiles[coords].meshes.lines.vertex_data != "undefined") {
              //       callback(coords, offset, name);
              //       return;
              //   }
              // }
              callback(coords, offset, name);
              return;

            } else {
              // no verts in this tile to convert
              console.log('no verts in', coords);
              callback(coords, offset, name);
              return;
            }
          }
        }
        // if not ready, wait a sec and try again
        waitForVerts(callback, coords, offset, name);
      }, 1000);
    }

    function waitForWorkers(callback) {
        console.log('waiting for workers')
      setTimeout(function () {
        // check for workers
        if (typeof scene.workers != "undefined") {
          // check that the workers are registered in the scene
          if (typeof scene.workers[scene.next_worker] != "undefined") {
            // check that the scene is instantiated and ready to go
            if (typeof scene.center_meters != "undefined") {
            console.log('workers ready')
              callback();
              return;
            }
          }
        }
        // if not ready, wait a sec and try again
        waitForWorkers(callback);
      }, 1000);
    }

    function waitForScene(callback) {
        console.log('waiting for scene')
      setTimeout(function () {
        if (scene.initialized) {
            console.log('scene ready to go')
            callback();
            return;
        }
        // if not ready, wait a sec and try again
        waitForScene(callback);
      }, 250);
    }

    function waitForVBOs(callback) {
        console.log('waiting for vbos')
      setTimeout(function () {
        // console.log('vbosProcessed:', vbosProcessed)
        if (vbosProcessed == tiles.length) {
            callback();
            return;
        }
        // if not ready, wait a sec and try again
        waitForVBOs(callback);
      }, 1000);
    }

    function loadTiles() {
      for (t in tiles) {
        document.title = t+" of "+tiles.length+" loaded - "+(((parseInt(t) + 1)/tiles.length)*100).toFixed(2)+ "%";

        // todo: determine whether this is working
        scene.tile_manager.loadCoordinate(tiles[t]);
      }
      console.log("%d tiles loaded", tiles.length);
    }

    function tile_to_meters(zoom) {
        return 40075016.68557849 / Math.pow(2, zoom)
    }

    function processTiles() {
      var zoom;
      for (t in tiles) {
        mt = tiles[t];
        if (Object.keys(scene.config.sources).length > 1) {
          console.error("This scene has data from multiple sources:", Object.keys(scene.config.sources), "Only scenes with a single source are supported for export.");
          return false;
        }
        source = Object.keys(scene.config.sources)
        coords = source+"/"+mt.z+"/"+mt.x+"/"+mt.y+"/"+mt.z;
        name = mt.x+"-"+mt.y+"-"+mt.z;
        zoom = mt.z;

        // calculate offset relative to the extents of the tile batch -
        // the top-left tile is 0,0 - one tile over is 1,0 - one tile down is 0,1
        // this will lay the tiles out in space correctly relative to each other
        var offset = {x: mt.x - min.x, y: mt.y - min.y};
        // multiply the offset by the local tile coordinate range for vertex position offset
        offset.x *= 4096;
        offset.y *= 4096;

        // console.log('wait for verts!')
        // wait for tile to load, then process it
        waitForVerts(processVerts, coords, offset, name);
      }
    }

    maximum_range = 4096; // tile-space coordinate maximum
    conversion_factor = tile_to_meters(zoom) / maximum_range;

    function processVerts(coords, offset, name) {
      document.title = (vbosProcessed + 1)+" of "+tiles.length+" processed - "+(((vbosProcessed + 1)/tiles.length)*100).toFixed(2)+ "%";

      meshes = scene.tile_manager.tiles[coords].meshes;
      allverts = "";
      for (m in meshes) {
        mesh = meshes[m];
        if (typeof(mesh) != "undefined") { // check for empty tiles
          verts = [];
          vbo = new Int16Array(mesh.vertex_data.buffer);
          var stride = mesh.vertex_layout.stride / Int16Array.BYTES_PER_ELEMENT;
          var count = mesh.vertex_count;

          // use count instead of vbo.length - the vbo is size before population, and resized in chunks as needed, and might have old tile data in it from the last tile the worker worked on
          for (var i=0; i < count; i++) {
            // for every [stride] elements, copy the first three elements x, y, and z, adding the offset to the x and y to lay all the tiles out in the same world space - use the conversion factor so the z is to the same scale as the x & y
            verts[i] = [(vbo[i*stride] += offset.x) * conversion_factor, (vbo[i*stride+1] -= offset.y) * conversion_factor, vbo[i*stride+2]];
          }

          // multiply each entry by master scaling factor
          var masterScale = .17;
          for (var i=0; i < verts.length; i++) {
            for (var j=0; j < 3; j++) {
              verts[i][j] *= masterScale;
            }
          }

          // convert each entry into a string
          for (var i=0; i < verts.length; i++) {
              verts[i] = verts[i].join(' ');
          }
          // make it one long string
          verts = verts.join('\n');

          // add mesh verts to master tile verts list
          allverts = allverts + "\n" + verts;
        }
      }
      if (allverts.length > 0) {
        // add it to file list for zipping
        vbos.push({name: name, verts: allverts});
      }
      // } else {
      //   console.log('empty tile, skipping', coords);
      // }
      vbosProcessed++;
    }

    // zip with zip.js
    function zipVBOBlobs() {
      filenames = [];
      zip.workerScriptsPath = "/lib/";

      if (vbos.length == 0) { console.log("No files to zip!\nDone!"); return; }
      console.log('zipping %d files...', vbos.length);
      zip.createWriter(new zip.BlobWriter("application/zip"), function(writer) {
        console.log("Creating zip...");
        var f = 0;
        function nextFile(f) {
          fblob = new Blob([vbos[f].verts], { type: "text/plain" });
          // check for existing filename
          filename = vbos[f].name+".vbo";
          if (filenames.indexOf(filename) == -1) { // if file doesn't already exist:
            filenames.push(filename);
            writer.add(filename, new zip.BlobReader(fblob), function() {
              // callback
              f++;
              if (f < vbos.length) {
                nextFile(f);
              } else close();
            });
          } else {
            console.log(filename, "is a duplicate, skipping");
            f++;
            if (f < vbos.length) {
              nextFile(f);
            } else close();
          }
        }
        function close() {
            // close the writer
          writer.close(function(blob) {
            // save with FileSaver.js
            saveAs(blob, "example.zip");
            console.log("Done!");
            document.title = oldTitle;
          });
        }
        nextFile(f);
      }, onerror);
    }

    waitForWorkers(loadTiles);

    waitForScene(processTiles);

    waitForVBOs(zipVBOBlobs);

}

// zip with zip.js
// expects array of files and a type string, eg "vbo" or "png"
function zipFiles(files, type) {
    console.log('zipping files:', files)
    filenames = [];
    zip.workerScriptsPath = "/lib/";

    if (files.length == 0) { console.log("No files to zip!\nDone!"); return; }

    console.log('zipping %d files...', files.length);

    zip.createWriter(new zip.BlobWriter("application/zip"), function(writer) {
        console.log("Creating zip...");
        var f = 0;
        function nextFile(f) {
            // check for existing filename
            filename = files[f].name;
            console.log(files[f])
            if (filenames.indexOf(filename) == -1) { // if file doesn't already exist:
                filenames.push(filename);

                if (type === "json") {
                    writer.add(filename, new zip.TextReader(files[f].file), function() {
                        // callback
                        f++;
                        if (f < files.length) {
                            nextFile(f);
                        } else close();
                    });
                } else if (type === "png" || type === "tif") {

                    fblob = new Blob([files[f].file], { type: "image/"+type });
                    writer.add(filename, new zip.BlobReader(fblob), function() {
                        // callback
                        f++;
                        if (f < files.length) {
                            nextFile(f);
                        } else close();
                    });
                }

            } else {
                console.log(filename, "is a duplicate, skipping");
                f++;
                if (f < files.length) {
                    nextFile(f);
                } else close();
            }
        }
        function close() {
                // close the writer
            writer.close(function(blob) {
                // save with FileSaver.js
                saveAs(blob, "example.zip");
                console.log("Done!");
                document.title = oldTitle;
            });
        }
        nextFile(f);
    }, onerror);
}
