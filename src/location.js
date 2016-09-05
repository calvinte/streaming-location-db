"use strict"

var async = require('async');
var d3 = require('d3');
var fs = require('fs');
var format = require('pg-format');
var geolib = require('geolib');
var pg = require('pg').native;
var _ = require('underscore');

var LocationMgrLogger = require('./logger').Logger('location');
var StreamMgr = require('./stream');

var pgConnectionStatusList = [
    'NEW',
    'CONNECTING',
    'SETUP',
    'DONE',
    'FAIL',
];

var fsSetupStatusList = [
    'NEW',
    'SETUP',
    'DONE',
    'FAIL',
];

// CREATE DATABASE streaming_location_svg;
// \c streaming_location_svg;
// CREATE EXTENSION Postgis;
// CREATE EXTENSION "uuid-ossp";
exports.pg = null;
connectPsql();

exports.svgDir = './.svg_db';
setupSvgFs();

exports.queue = async.queue(handleIncomingMessage);
exports.queue.pause();

exports.stream = new StreamMgr.Stream();
// @TODO exports.stream.offClientClose
exports.stream.onClientClose(function(clientSocketIndex) {
    var targetId;
    for (targetId in clientTargetMap[clientSocketIndex]) {
        if (activeStreams[targetId] && activeStreams[targetId].writeStream) {
            activeStreams[targetId].writeStream.end(svgCloseStr);
            activeStreams[targetId].fileSize += svgCloseStr.length;
        }
        activeStreams[targetId] = null;
    }
});

exports.stream.bus.onValue(function(message) {
    exports.queue.push(message);
});

exports.location = function(options) {
    this.accuracy = options.accuracy || exports.location.prototype.accuracy;
    this.heading = options.heading || exports.location.prototype.heading;
    this.coordinates = options.coordinates || exports.location.prototype.coordinates;
    this.speed = options.speed || exports.location.prototype.speed;
    this.time = options.time || exports.location.prototype.time;
};

exports.location.prototype = {
    'accuracy': null,
    'heading': null,
    'coordinates': null,
    'speed': null,
    'time': null,
};

exports.pathref = function(options) {
    this.file = options.file || exports.pathref.prototype.file;
    this.location = options.location || exports.pathref.prototype.location;
    this.target = options.target || exports.pathref.prototype.target;
};

exports.pathref.prototype = {
    'filename': null,
    'location': null,
    'target': null,
};

var readyListeners = [];
exports.whenReady = function(fn) {
    if (exports.pgStatus === pgConnectionStatusList[3] && exports.svgDirStatus === fsSetupStatusList[2]) {
        fn(null);
    } else {
        readyListeners.push(fn);
    }
};

var svgCloseStr = '</svg>';
var activeStreamTargetPersistedLocationIdMap = {};
var computeActiveStreamSvgCount = -1;
exports.autoComputeSvg = true;
exports.computeActiveStreamSvg = function computeActiveStreamSvg(cb) {
    var targetPathAnchors = {};
    var targetId, stream, pathDetails, width, height, lastAnchor;
    var row, i, j, query;
    var computeActiveStreamSvgIdx = ++computeActiveStreamSvgCount;

    for (targetId in activeStreams) {
        stream = activeStreams[targetId];

        if (!stream.writeStream || stream.length === 0) {
            continue;
        }

        lastAnchor = _.clone(_.last(stream));
        pathDetails = locationStreamToBezier(stream);

        width = pathDetails.bounds[2] - pathDetails.bounds[0];
        height = pathDetails.bounds[3] - pathDetails.bounds[1];
        targetPathAnchors[targetId] = pathDetails.anchors;
        if (stream.fileSize === 0) {
            stream.writeStream.write('<svg version="1.1" baseProfile="full" viewBox="' + pathDetails.bounds[0] + ' ' + pathDetails.bounds[1] + ' ' + width + ' ' + height + '" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">');
        }

        if (pathDetails.origPath) {
            stream.writeStream.write(pathDetails.origPath);
            stream.fileSize += pathDetails.origPath.length;
        }

        stream.writeStream.write(pathDetails.path);
        stream.fileSize += pathDetails.path.length;

        if (!exports.pg || exports.pgStatus !== pgConnectionStatusList[3]) {
            LocationMgrLogger('psql', 'err');
            return;
        }

        stream.lastAnchor = lastAnchor;
        activeStreams[targetId].splice(0, stream.length);

        targetId = stream = pathDetails = width = height, lastAnchor = null;
    }

    exports.pg.query(format(`
        INSERT INTO locations(${_.keys(exports.location.prototype).join(',')}) VALUES %L RETURNING _id
    `, _.flatten(_.map(targetPathAnchors, anchorsToInsertArr), true)), function(err, res) {
        if (err) {
            LocationMgrLogger('psql', 'err');
        } else {
            LocationMgrLogger('psql', 'success' + ':' + res.rowCount);

            j = -1;
            for (targetId in targetPathAnchors) {
                for (i in targetPathAnchors[targetId]) {
                    row = res.rows[++j];
                    targetPathAnchors[targetId][i]._id = row['_id']
                }
            }

            exports.pg.query(format(`
                INSERT INTO pathref(${_.keys(exports.pathref.prototype).join(',')}) VALUES %L
            `, _.flatten(_.map(targetPathAnchors, function(anchors, targetId) {
                return _.map(anchors, function(anchor) {
                    return [
                        activeStreamFilename,
                        anchor._id,
                        targetId
                    ];
                });
            }), true)), function(err, res) {
                cb(err);
            });
        }
    });

    function anchorsToInsertArr(anchors, targetId) {
        return _.map(anchors, function(location) {
            var coordString = location.coordinates.join(' ');
            if (location.coordinates.length === 2) {
                coordString += ' -999';
            }

            location.coordinates = `POINTZ(${coordString})`;
            return _.toArray(location);
        });
    }
};

var activeStreamComputationInProgress = false;
var throttledComputeActiveStreamSvg = _.throttle(function() {
    if (!exports.autoComputeSvg) {
        return;
    }

    if (activeStreamComputationInProgress) {
        throttledComputeActiveStreamSvg();
        return;
    }

    activeStreamComputationInProgress = true;
    exports.computeActiveStreamSvg(function() {
        activeStreamComputationInProgress = false;
    });
}, Math.pow(2, 14));

function connectPsql() {
    LocationMgrLogger('psql', 'connect');
    exports.pgStatus = pgConnectionStatusList[0];
    pg.connect({
        database: 'streaming_location_svg',
        host: 'localhost',
        password: '',
        poolIdleTimeout: 60000,
        poolSize: 43,
        port: 5432,
        user: '',
    }, function(err, client, done) {
        exports.pgStatus = pgConnectionStatusList[1];

        client.query(`
            SELECT column_name, data_type
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE table_name = 'locations'
        `, function(err, res) {
            if (err) {
                exports.pgStatus = pgConnectionStatusList[4];
                done()
                return;
            }

            if (res.rowCount === 0) {
                exports.pgStatus = pgConnectionStatusList[2];
                client.query(`
                    CREATE TABLE locations(
                        _id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                        time TIMESTAMPTZ NOT NULL,
                        coordinates GEOGRAPHY(POINTZ, 4326) NOT NULL,
                        heading REAL,
                        speed REAL,
                        accuracy REAL
                    );
                    CREATE TABLE pathref(
                        _id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                        filename CHARACTER(17),
                        location UUID,
                        target CHARACTER(24)
                    );
                `, function(err, res) {
                    if (err) {
                        exports.pgStatus = pgConnectionStatusList[4];
                        done(err);
                        return;
                    } else {
                        exports.pg = client;
                        exports.pgStatus = pgConnectionStatusList[3];
                        processQueue();
                        done();
                    }
                });
            } else {
                exports.pg = client;
                exports.pgStatus = pgConnectionStatusList[3];
                processQueue();
                done();
            }
        })
    });
};

function createActiveStream(file, fd, fileSize) {
    var writer = fs.createWriteStream(file, {fd: fd, start: Math.max(0, fileSize - svgCloseStr.length)});
    writer.on('close', handleWriteStreamClose);
    writer.on('drain', handleWriteStreamDrain);
    writer.on('error', handleWriteStreamError);
    writer.on('finish', handleWriteStreamFinish);
    writer.on('pipe', handleWriteStreamPipe);
    writer.on('unpipe', handleWriteStreamUnpipe);
    return writer;
};

function getTargetActiveFilename(targetId, path) {
    if (!path) {
        path = getTargetPath(targetId);
    }

    return path + '/' + activeStreamFilename;
};

var activeStreamFilename = '_active.svg';
function getTargetPath(targetId) {
    return exports.svgDir + '/' + targetId;
};

var activeStreams = {};
function getTargetWriteStream(targetId, cb) {
    var path = getTargetPath(targetId);
    var file = getTargetActiveFilename(targetId, path);

    if (activeStreams[targetId] instanceof Array) {
        cb(null, activeStreams[targetId]);
        return;
    }

    activeStreams[targetId] = [];

    fs.access(path, fs.F_OK, function(err) {
        if (err) {
            LocationMgrLogger('fs', 'make target directory');
            fs.mkdir(path, function(err) {
                if (err) {
                    cb(err, null);
                } else {
                    getFile();
                }
            });
        } else {
            getFile();
        }
    });

    function getFile() {
        fs.open(file, 'w', function(err, fd) {
            if (err) {
                cb(err, null);
                return;
            }

            fs.fstat(fd, function(err, stats) {
                if (err) {
                    cb(err, null);
                    return;
                }

                activeStreams[targetId].fileDescriptor = fd;
                activeStreams[targetId].fileSize = stats.size;
                activeStreams[targetId].writeStream = createActiveStream(file, fd, stats.size);

                cb(null, activeStreams[targetId]);
            });
        });
    }
};

function getSqDist(p1, p2) {
    var dx = p1[0] - p2[0],
    dy = p1[1] - p2[1];

    return dx * dx + dy * dy;
};

var clientTargetMap = {};
var targetLastSeen = {};
function handleIncomingMessage(message, cb) {
    var parsedMessage = message.parse();
    if (typeof parsedMessage.targetId === 'string') {
        clientTargetMap[message.clientSocketIndex] = clientTargetMap[message.clientSocketIndex] || {};
        clientTargetMap[message.clientSocketIndex][parsedMessage.targetId] = true;
        targetLastSeen[parsedMessage.targetId] = new Date();

        getTargetWriteStream(parsedMessage.targetId, function(err, activeStream) {
            if (err) {
                LocationMgrLogger('value', 'err');
                cb(err);
            } else {
                activeStream.push(parsedMessage.location);
                throttledComputeActiveStreamSvg();
                cb(null);
            }
        });
    } else {
        LocationMgrLogger('value', 'err');
        cb('target id not found');
    }
};

function handleWriteStreamClose(event) {
    //LocationMgrLogger('write', 'close');
};

function handleWriteStreamDrain(event) {
    LocationMgrLogger('write', 'drain');
};

function handleWriteStreamError(event) {
    LocationMgrLogger('write', 'err');
};

function handleWriteStreamFinish(event) {
    var activePath = this.path;
    var targetId = new RegExp(exports.svgDir + '/(.+?)/', 'g').exec(activePath)[1];
    var filename = targetLastSeen[targetId].getTime() + '.svg';
    var filepath = activePath.replace('/_active.svg', '/' + filename);

    fs.rename(activePath, filepath, function(err) {
        if (err) {
            LocationMgrLogger('fs', 'archive err');
            return;
        }

        exports.pg.query(format(`
            UPDATE pathref SET filename = '%s' WHERE target = '%s' AND filename = '%s'
        `, filename, targetId, activeStreamFilename), function(err, res) {
            LocationMgrLogger('fs', 'archive success');
        });
    });
};

function handleWriteStreamPipe(src) {
    LocationMgrLogger('write', 'pipe');
};

function handleWriteStreamUnpipe(src) {
    LocationMgrLogger('write', 'unpipe');
};

var svgDecimalPrecision = 3;
function locationsToVectorPosition() {
    var _args = arguments;
    var i, j, locations = Array(arguments.length * 2);

    for (i = j = 0; i < arguments.length; i++) {
        if (arguments[i].longitude && arguments[i].latitude) {
            locations[j++] = parseFloat(arguments[i].longitude).toFixed(svgDecimalPrecision);
            locations[j++] = parseFloat(arguments[i].latitude).toFixed(svgDecimalPrecision);
        } else if (typeof arguments[i][0] === 'number' && typeof arguments[i][1] === 'number') {
            locations[j++] = (arguments[i][0]).toFixed(svgDecimalPrecision);
            locations[j++] = (arguments[i][1]).toFixed(svgDecimalPrecision);
        } else {
            LocationMgrLogger('locationsToVectorPosition', 'err, unexpected input')
            locations[j++] = 0;
            locations[j++] = 0;
        }
    }

    return locations;
}

var minSegmentDegrees = 0.0001 // ~11.06 meters
var sqMinSegmentDegrees = Math.pow(minSegmentDegrees, 2);
var thresholdRad = 45 / 180 * Math.PI;
var drawOriginalPath = true;
function locationStreamToBezier(points) {
    var i, point = null, skippedPoints = null;
    var anchorRequired, sqAnchorDistance = null, anchorTangent = null, pointTangent;
    var spliceIdx, spliceBiasCeil = true, handles = new Array(2);
    var minX, maxX, minY, maxY;

    var prevAnchor, prevPoint, anchors;
    var path = d3.path();
    var origPath = null;

    if (points.lastAnchor) {
        prevAnchor = points.lastAnchor.coordinates;
        anchors = [points.lastAnchor];
    } else {
        prevAnchor = points[0].coordinates;
        anchors = [points[0]];
    }

    path.moveTo.apply(path, locationsToVectorPosition(prevAnchor));

    if (drawOriginalPath) {
        origPath = d3.path();
        origPath.moveTo.apply(origPath, locationsToVectorPosition(prevAnchor));
    }

    minX = maxX = prevAnchor[0];
    minY = maxY = prevAnchor[1];
    prevPoint = prevAnchor;

    for (i = points.lastAnchor ? 0 : 1; i < points.length; i++) {
        point = points[i].coordinates;

        anchorRequired = i === points.length - 1; // Last point?

        if (!anchorRequired) {
            sqAnchorDistance = getSqDist(point, prevAnchor);
            if (sqAnchorDistance > sqMinSegmentDegrees) {
                // Distance exceeds minimum.
                anchorTangent = Math.abs(Math.atan2(point[1] - prevAnchor[1], point[0] - prevAnchor[0]));
                pointTangent = Math.abs(Math.atan2(point[1] - prevPoint[1], point[0] - prevPoint[0]));
                if (Math.abs(anchorTangent - pointTangent) > thresholdRad) {
                    // Delta angle exceeds minimum, draw an anchor.
                    anchorRequired = true;
                }
            }
        }

        minX = Math.min(point[0], minX);
        maxX = Math.max(point[0], maxX);
        minY = Math.min(point[1], minY);
        maxY = Math.max(point[1], maxY);

        if (drawOriginalPath) {
            origPath.lineTo.apply(origPath, locationsToVectorPosition(point));
        }

        if (skippedPoints === null && anchorRequired) {
            // Draw new point, straight line
            anchors.push(points[i]);
            prevAnchor = point;

            path.lineTo.apply(path, locationsToVectorPosition(point));
        } else if (anchorRequired) {
            // Draw new point, average skipped points as bezier
            anchors.push(points[i]);
            prevAnchor = point;

            if (skippedPoints.length === 1) {
                path.quadraticCurveTo.apply(path, locationsToVectorPosition(skippedPoints[0], point));
            } else {
                if (spliceBiasCeil) {
                    spliceIdx = Math.ceil(skippedPoints.length / 2);
                    spliceBiasCeil = false;
                } else {
                    spliceIdx = Math.floor(skippedPoints.length / 2);
                    spliceBiasCeil = true;
                }

                handles[0] = geolib.getCenter(skippedPoints.slice(0, spliceIdx));
                handles[1] = geolib.getCenter(skippedPoints.slice(spliceIdx, skippedPoints.length));
                path.bezierCurveTo.apply(path, locationsToVectorPosition(handles[0], handles[1], point));
            }

            skippedPoints = spliceIdx = handles[0] = handles[1] = null;
        } else if (skippedPoints === null) {
            // Too close; we have skipped one point.
            skippedPoints = [point];
        } else {
            // Too close; we have skipped many points.
            skippedPoints.push(point);
        }

        prevPoint = point;
        point = anchorRequired = sqAnchorDistance = anchorTangent = pointTangent = spliceIdx = spliceBiasCeil = null;
    }

    var bounds = locationsToVectorPosition([minX, minY], [maxX, maxY]);

    return {
        anchors: anchors,
        bounds: bounds,
        origPath: drawOriginalPath ? '<path d="' + origPath.toString() + '" fill="none" stroke="red" stroke-width="' + minSegmentDegrees + '" />' : null,
        path: '<path d="' + path.toString() + '" fill="none" stroke="black" stroke-width="' + minSegmentDegrees + '" />'
    };
}

function locationToLatLng(location) {
    if (!(location && location.coordinates && location.coordinates.length > 1)) {
        return null;
    }

    return location.coordinates.slice(0, 2);
};

function processQueue() {
    if (exports.pgStatus === pgConnectionStatusList[3] && exports.svgDirStatus === fsSetupStatusList[2]) {
        LocationMgrLogger('processQueue', 'READY')

        // PG and FS ready!
        setTimeout(function() {
            readyListeners.forEach(function(fn) {
                fn(null);
            });

            readyListeners = [];
            exports.queue.resume();
        }, 10);
    } else if (exports.pgStatus === pgConnectionStatusList[4]) {
        // PG failed.
        LocationMgrLogger('processQueue', 'PGFAIL')
        readyListeners.forEach(function(fn) {
            fn(exports.pgStatus);
        });
        readyListeners = [];
    } else if (exports.svgDirStatus === fsSetupStatusList[3]) {
        // FS failed.
        LocationMgrLogger('processQueue', 'FSFAIL')
        readyListeners.forEach(function(fn) {
            fn(exports.svgDirStatus);
        });
        readyListeners = [];
    }
};

function setupSvgFs() {
    LocationMgrLogger('fs', 'setup');
    exports.svgDirStatus = fsSetupStatusList[0];
    fs.access(exports.svgDir, fs.F_OK, function(err) {
        if (err) {
            exports.svgDirStatus = fsSetupStatusList[1];
            fs.mkdir(exports.svgDir, function(err) {
                if (err) {
                    exports.svgDirStatus = fsSetupStatusList[3];
                } else {
                    exports.svgDirStatus = fsSetupStatusList[2];
                    processQueue();
                }
            });
        } else {
            exports.svgDirStatus = fsSetupStatusList[2];
            processQueue();
        }
    });
};

