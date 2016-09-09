'use strict'

var async = require('async');
var d3 = require('d3');
var geolib = require('geolib');
var _ = require('underscore');

var locationPg = require('./postgres');
var locationFS = require('./filesystem');

var LocationMgrLogger = require('./logger').Logger('location');
var SocketHelper = require('socket-helper');
var StreamMgr = SocketHelper.Stream;

exports.queue = async.queue(handleIncomingMessage);
exports.queue.pause();

locationPg.connectPsql(processQueue);

locationFS.setupSvgFs(processQueue);

exports.stream = new StreamMgr.Stream();
exports.stream.start();

// @TODO exports.stream.offClientClose
exports.stream.onClientClose(function(clientSocketIndex) {
    var targetId;
    for (targetId in clientTargetMap[clientSocketIndex]) {
        if (activeStreams[targetId] && activeStreams[targetId].writeStream) {
            activeStreams[targetId].writeStream.end(svgCloseStr);
            activeStreams[targetId].fileSize += svgCloseStr.length;
        }
        LocationMgrLogger('streaming', 'end:' + targetId);
        activeStreams[targetId].push = handleDeadStreamMessage;
    }
});

exports.stream.onValue(function(message) {
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
    this.locations = options.locations || exports.pathref.prototype.locations;
    this.target = options.target || exports.pathref.prototype.target;
};

exports.pathref.prototype = {
    'filename': null,
    'locations': null,
    'target': null,
};

var readyListeners = [];
exports.whenReady = function(fn) {
    if (locationPg.pgStatus === locationPg.pgConnectionStatusList[3] && locationFS.svgDirStatus === locationFS.fsSetupStatusList[2]) {
        fn(null);
    } else {
        readyListeners.push(fn);
    }
};

var activeStreamTargetPersistedLocationIdMap = {};
var computeActiveStreamSvgCount = -1;

var svgCloseStr = '</svg>';
var svgParts = ['<svg version="1.1" baseProfile="full" ', 'viewBox="', null, ' ', null, ' ', null, ' ', null, '" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">', svgCloseStr];
exports.autoComputeSvg = true;
exports.computeActiveStreamSvg = function computeActiveStreamSvg(cb) {
    var targetPathAnchors = {};
    var targetId, stream, pathDetails, width, height, lastAnchor, bounds;
    var computeActiveStreamSvgIdx = ++computeActiveStreamSvgCount;
    var writeStr, writeStatus = true;

    for (targetId in activeStreams) {
        stream = activeStreams[targetId];

        if (!stream.writeStream || stream.length === 0) {
            continue;
        }

        lastAnchor = _.clone(_.last(stream));
        pathDetails = locationStreamToBezier(stream);
        targetPathAnchors[targetId] = pathDetails.anchors;

        bounds = _.clone(pathDetails.bounds);
        if (stream.bounds) {
            bounds[0] = Math.min(bounds[0], stream.bounds[0]);
            bounds[1] = Math.min(bounds[1], stream.bounds[1]);
            bounds[2] = Math.max(bounds[2], stream.bounds[2]);
            bounds[3] = Math.max(bounds[3], stream.bounds[3]);
        }
        stream.bounds = bounds;

        if (stream.fileSize === 0) {
            writeStatus = false;
            stream.viewBox = computeViewBox(bounds);
            writeStr = svgParts[0] + stream.viewBox + svgParts[9];
            while (!writeStatus) {
                writeStatus = stream.writeStream.write(writeStr);
            }

            stream.fileSize += writeStr.length;
            stream.writtenBounds = bounds;
        }

        if (pathDetails.origPath) {
            stream.writeStream.write(pathDetails.origPath);
            stream.fileSize += pathDetails.origPath.length;
        }

        if (exports.autoComputeSvg) {
            stream.writeStream.write(pathDetails.path);
        } else {
            stream.writeStream.end(pathDetails.path + svgCloseStr);
        }
        stream.fileSize += pathDetails.path.length;

        if (!locationPg.pg || locationPg.pgStatus !== locationPg.pgConnectionStatusList[3]) {
            LocationMgrLogger('psql', 'err');
            return;
        }

        stream.lastAnchor = lastAnchor;
        activeStreams[targetId].splice(0, stream.length);

        targetId = stream = pathDetails = width = height, lastAnchor = null;
    }

    locationPg.insertAnchors(targetPathAnchors, cb);
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

var viewBoxLength = 43; // ex: `179.999999 179.999999 179.999999 179.999999`
var viewboxDecimals = 6;
function computeViewBox(bounds) {
    var i, viewBox = svgParts[1] + bounds[0] + svgParts[3] + bounds[1] + svgParts[5] + (bounds[2] - bounds[0]).toFixed(viewboxDecimals) + svgParts[7] + (bounds[3] - bounds[1]).toFixed(viewboxDecimals);
    for (i = viewBox.length; i < viewBoxLength; i++) {
        viewBox += ' ';
    }

    return viewBox;
}

function getSqDist(p1, p2) {
    var dx = p1[0] - p2[0],
    dy = p1[1] - p2[1];

    return dx * dx + dy * dy;
};

function handleDeadStreamMessage(location) {
    LocationMgrLogger('phantom stream', 'err');
};

var activeStreams = {};
var clientTargetMap = {};
exports.targetLastSeen = {};
var i = -1;
function handleIncomingMessage(message, cb) {
    var parsedMessage = message.parse(true);
    var targetId = parsedMessage.targetId;
    if (typeof targetId === 'string') {
        clientTargetMap[message.clientSocketIndex] = clientTargetMap[message.clientSocketIndex] || {};
        clientTargetMap[message.clientSocketIndex][targetId] = true;
        exports.targetLastSeen[targetId] = new Date();

        if (activeStreams[targetId] instanceof Array) {
            activeStreams[targetId].push(parsedMessage.location);
            throttledComputeActiveStreamSvg();
            cb(null);
        } else {
            LocationMgrLogger('streaming', 'start:' + targetId);
            activeStreams[targetId] = [];
            locationFS.getTargetWriteStream(targetId, function(err, details) {
                if (err) {
                    LocationMgrLogger('value', 'err');
                    cb(err);
                } else {
                    throttledComputeActiveStreamSvg();

                    activeStreams[targetId].fileDescriptor = details.fd;
                    activeStreams[targetId].fileSize = details.size;
                    activeStreams[targetId].targetId = targetId;
                    activeStreams[targetId].writeStream = locationFS.createActiveStream(details.file, details.fd, details.size - svgCloseStr.length);
                    activeStreams[targetId].writeStream.on('close', handleWriteStreamClose);
                    activeStreams[targetId].writeStream.on('drain', handleWriteStreamDrain);
                    activeStreams[targetId].writeStream.on('error', handleWriteStreamError);
                    activeStreams[targetId].writeStream.on('finish', handleWriteStreamFinish);
                    activeStreams[targetId].writeStream.on('pupe', handleWriteStreamPipe);
                    activeStreams[targetId].writeStream.on('unpipe', handleWriteStreamUnpipe);
                    cb(null);
                }
            });
        }
    } else {
        LocationMgrLogger('value', 'err');
        cb('target id not found');
    }
};

function handleWriteStreamClose(event) {
    //LocationMgrLogger('write', 'close');
};

function handleWriteStreamDrain(event) {
    //LocationMgrLogger('write', 'drain');
};

function handleWriteStreamError(event) {
    //LocationMgrLogger('write', 'err');
};

function handleWriteStreamFinish() {
    var activeFilename = this.path, newFilename;
    var targetId = new RegExp(locationFS.svgDir + '/(.+?)/', 'g').exec(activeFilename)[1];
    var stream = activeStreams[targetId];
    delete activeStreams[targetId];

    if (stream.bounds !== stream.writtenBounds) {
        locationFS.writeSegment(activeFilename, computeViewBox(stream.bounds), svgParts[0].length, rename);
    } else {
        rename();
    }

    function rename(err) {
        if (err) {
            LocationMgrLogger('archive', 'fs err');
            return;
        }

        newFilename = locationFS.archiveSVG(activeFilename, targetId, function(err) {
            if (err) {
                LocationMgrLogger('archive', 'fs err');
                return;
            }

            locationPg.updateAnchorsFilename(newFilename, targetId, function(err, res) {
                if (err) {
                    LocationMgrLogger('archive', 'pg err');
                } else {
                    LocationMgrLogger('archive', 'success:' + res.rowCount);
                }
            });
        });
    };
};

function handleWriteStreamPipe(src) {
    LocationMgrLogger('write', 'pipe');
};

function handleWriteStreamUnpipe(src) {
    LocationMgrLogger('write', 'unpipe');
};

var svgDecimalPrecision = 5;
function locationsToVectorPosition() {
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

var radianEdges = [
    Math.PI,
    90 / 180 * Math.PI,
];
var deltaRadianEdges = radianEdges[0] - radianEdges[1];

var sqDistanceEdges = [
    Math.pow(0.0001, 2), // ~11.06 meters
    Math.pow(0.01, 2), // ~1105.74 meters
];

var drawOriginalPath = true;
function locationStreamToBezier(points) {
    var i, point = null, skippedPoints = null;

    var anchorRequired = false;
    var anchorTangent = null, pointTangent = null, deltaT = null, cumulativeDeltaT = 0;
    var sqPointDistance = null, cumulativeAnchorDistance = null, distanceMultiplier = null;
    var radianThreshold = null;

    var skippedPointsGroup = null ;

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
        anchorTangent = Math.atan2(point[1] - prevAnchor[1], point[0] - prevAnchor[0]);

        if (!anchorRequired) {
            sqPointDistance = getSqDist(point, prevPoint);
            cumulativeAnchorDistance += sqPointDistance;

            if (cumulativeAnchorDistance > sqDistanceEdges[0]) {
                pointTangent = Math.atan2(point[1] - prevPoint[1], point[0] - prevPoint[0]);
                deltaT = Math.abs(anchorTangent - pointTangent);
                cumulativeDeltaT += deltaT;

                distanceMultiplier = Math.max(cumulativeAnchorDistance - sqDistanceEdges[0], sqDistanceEdges[0]) / sqDistanceEdges[1];
                radianThreshold = radianEdges[0] + deltaRadianEdges * distanceMultiplier;

                if (Math.abs(cumulativeDeltaT) > radianThreshold) {
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
            if (skippedPoints.length === 1) {
                // qudratic curve to makes nice curves, but they dont serve to
                // reduce file size..
                //path.quadraticCurveTo.apply(path, locationsToVectorPosition(skippedPoints[0], point));
                path.lineTo.apply(path, locationsToVectorPosition(skippedPoints[0]));
                path.lineTo.apply(path, locationsToVectorPosition(point));
            } else {
                if (spliceBiasCeil) {
                    spliceIdx = Math.ceil(skippedPoints.length / 2);
                    spliceBiasCeil = false;
                } else {
                    spliceIdx = Math.floor(skippedPoints.length / 2);
                    spliceBiasCeil = true;
                }

                handles[0] = computeHandle(skippedPoints.slice(0, spliceIdx), anchorTangent, prevAnchor, cumulativeAnchorDistance);
                handles[1] = computeHandle(skippedPoints.slice(spliceIdx, skippedPoints.length), anchorTangent, point, cumulativeAnchorDistance);

                path.bezierCurveTo.apply(path, locationsToVectorPosition(handles[0], handles[1], point));
            }

            // Draw new point, average skipped points as bezier
            anchors.push(points[i]);
            prevAnchor = point;

            skippedPoints = spliceIdx = handles[0] = handles[1] = null;
        } else if (skippedPoints === null) {
            // Too close; we have skipped one point.
            skippedPoints = [point];
        } else {
            // Too close; we have skipped many points.
            skippedPoints.push(point);
        }

        if (anchorRequired) {
            cumulativeDeltaT = 0;
            cumulativeAnchorDistance = 0;
        }

        prevPoint = point;
        point = anchorRequired = anchorTangent = pointTangent = deltaT = spliceIdx = spliceBiasCeil = null;
    }

    return {
        anchors: anchors,
        bounds: locationsToVectorPosition([minX, minY], [maxX, maxY]),
        origPath: drawOriginalPath ? '<path d="' + origPath.toString() + '" fill="none" stroke="red" stroke-width="0.00005" />' : null,
        path: '<path d="' + path.toString() + '" fill="none" stroke="black" stroke-width="0.00005" />'
    };
}

function computeHandle(skippedPointsGroup, anchorTangent, anchor, cumulativeAnchorDistance) {
    var avgCenter, geoCenter;
    var centersTangent, centersDistance;
    var handleDistance = null;
    var bounds, boundsRatio;

    var avgCenter = geolibToJson(geolib.getCenter(skippedPointsGroup));
    var geoCenter = geolibToJson(geolib.getCenterOfBounds(skippedPointsGroup));

    skippedPointsGroup = _.map(skippedPointsGroup, function(point) {
        return rotate(anchor[0], anchor[1], point[0], point[1], anchorTangent);
    });

    bounds = geolib.getBounds(skippedPointsGroup);
    boundsRatio = (bounds.maxLng - bounds.minLng)/(bounds.maxLat - bounds.minLat);

    if (boundsRatio) {
        if (boundsRatio < 1) {
            boundsRatio = 1/boundsRatio;
        }

        centersDistance = getSqDist(avgCenter, geoCenter);
        centersTangent = 0.5 * (anchorTangent/2 + Math.atan2(anchor[1] - geoCenter[1], anchor[0] - geoCenter[0]));
        handleDistance = Math.sqrt(Math.min(centersDistance * boundsRatio, cumulativeAnchorDistance/2));
        return [
            avgCenter[0] + handleDistance * Math.sin(centersTangent),
            avgCenter[1] + handleDistance * Math.cos(centersTangent)
        ];
    } else {
        return avgCenter;
    }
}

function rotate(cx, cy, x, y, radians) {
    var cos = Math.cos(radians);
    var sin = Math.sin(radians);
    return [
        (cos * (x - cx)) + (sin * (y - cy)) + cx,
        (cos * (y - cy)) - (sin * (x - cx)) + cy
    ]
}

function geolibToJson(geolibObj) {
    return [geolibObj.longitude, geolibObj.latitude]
}

function locationToLatLng(location) {
    if (!(location && location.coordinates && location.coordinates.length > 1)) {
        return null;
    }

    return location.coordinates.slice(0, 2);
};

function processQueue(err) {
    if (err !== null) {
        LocationMgrLogger('processQueue', 'err')
    }

    if (locationPg.pgStatus === locationPg.pgConnectionStatusList[3] && locationFS.svgDirStatus === locationFS.fsSetupStatusList[2]) {
        LocationMgrLogger('processQueue', 'READY')

        // PG and FS ready!
        setTimeout(function() {
            readyListeners.forEach(function(fn) {
                fn(null);
            });

            readyListeners = [];
            exports.queue.resume();
        }, 10);
    } else if (locationPg.pgStatus === locationPg.pgConnectionStatusList[4]) {
        // PG failed.
        LocationMgrLogger('processQueue', 'PGFAIL')
        readyListeners.forEach(function(fn) {
            fn(locationPg.pgStatus);
        });
        readyListeners = [];
    } else if (locationFS.svgDirStatus === locationFS.fsSetupStatusList[3]) {
        // FS failed.
        LocationMgrLogger('processQueue', 'FSFAIL')
        readyListeners.forEach(function(fn) {
            fn(locationFS.svgDirStatus);
        });
        readyListeners = [];
    }
};

