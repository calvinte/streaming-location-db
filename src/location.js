'use strict'

var async = require('async');
var requireDir = require('require-dir');
var _ = require('underscore');

var locationPg = require('./postgres');
var locationFS = require('./filesystem');

var lineStyles = requireDir('./lineStyles');

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
    'lineStyle': null,
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
var activeLineStyles = [
    [lineStyles.raw, 'raw', 'red'],
    [lineStyles.ctBezier, 'ctBezier', 'black'],
];

exports.autoComputeSvg = true;
exports.computeActiveStreamSvg = function computeActiveStreamSvg(cb) {
    var targetPathAnchors = {};
    var targetId, stream, lastAnchor;
    var computeActiveStreamSvgIdx = ++computeActiveStreamSvgCount;
    var writeStr, writeStatus = true;

    for (targetId in activeStreams) {
        stream = activeStreams[targetId];

        if (!stream.writeStream || stream.length === 0) {
            continue;
        }

        targetPathAnchors[targetId] = {};
        lastAnchor = _.clone(_.last(stream));
        _.each(activeLineStyles, function(pathStyle, i) {
            var pathDetails, width, height, lastAnchor, bounds;
            var pathFn = pathStyle[0];
            var lineStyle = pathStyle[1];
            var pathColor = pathStyle[2];

            pathDetails = pathFn(stream, pathColor);

            targetPathAnchors[targetId][lineStyle] = pathDetails.anchors;

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

            if (exports.autoComputeSvg || i < activeLineStyles.length - 1) {
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
        });
        activeStreams[targetId].splice(0, stream.length);

        targetId = stream, lastAnchor = null;
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

