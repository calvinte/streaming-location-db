'use strict';

var async = require('async');
var requireDir = require('require-dir');
var _ = require('underscore');

var locationPg = require('./postgres');
var locationFS = require('./filesystem');
var lineStyles = requireDir('./lineStyles');

var locationMgrLogger = require('./logger').Logger('location');
var SocketHelper = require('socket-helper');
var StreamMgr = SocketHelper.Stream;

var activeStreams = {};
var clientTargetMap = {};

var svgCloseStr = '</svg>';
var svgParts = ['<svg version="1.1" baseProfile="full" ', 'viewBox="', null, ' ', null, ' ', null, ' ', null, '" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">', svgCloseStr];
var activeLineStyles = [
    ['raw', 'red'],
    ['ctBezier', 'black'],
    ['douglasPeucker', 'green'],
];

var viewBoxLength = 43; // ex: `179.999999 179.999999 179.999999 179.999999"`
var viewboxDecimals = 6;
function computeViewBox(bounds) {
    var i, viewBox = bounds[0] + svgParts[3] + bounds[1] + svgParts[5] + (bounds[2] - bounds[0]).toFixed(viewboxDecimals) + svgParts[7] + (bounds[3] - bounds[1]).toFixed(viewboxDecimals);
    for (i = viewBox.length; i < viewBoxLength; i++) {
        viewBox += ' ';
    }

    return viewBox;
}

exports.autoComputeSvg = true;
exports.computeActiveStreamSvg = function computeActiveStreamSvg(cb) {
    var targetId, stream, writeStr, targetPathAnchors = {}, writeStatus = true;

    function computePathStyle(pathStyle) {
        var pathDetails, bounds, lineStyle = pathStyle[0], pathColor = pathStyle[1];

        pathDetails = lineStyles[lineStyle](stream, pathColor);

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
            writeStr = svgParts[0] + svgParts[1] + stream.viewBox + svgParts[9];
            while (!writeStatus) {
                writeStatus = stream.writeStream.write(writeStr);
            }

            stream.fileSize += writeStr.length;
            stream.writtenBounds = bounds;
        }

        stream.writeStream.write(pathDetails.path);
        stream.fileSize += pathDetails.path.length;

        if (!locationPg.pg || locationPg.pgStatus !== locationPg.pgConnectionStatusList[3]) {
            locationMgrLogger('psql', 'err');
            return;
        }
    }

    for (targetId in activeStreams) {
        if (activeStreams.hasOwnProperty(targetId) && activeStreams[targetId].writeStream && activeStreams[targetId].length > 0) {
            stream = activeStreams[targetId];
            targetPathAnchors[targetId] = {};

            _.each(activeLineStyles, computePathStyle);

            stream.lastAnchor = _.clone(_.last(stream));
            activeStreams[targetId].splice(0, stream.length);

            targetId = stream = null;
        }
    }

    if (!exports.autoComputeSvg) {
        locationPg.insertAnchors(targetPathAnchors, function (err) {
            var _targetId;
            for (_targetId in activeStreams) {
                if (activeStreams.hasOwnProperty(_targetId)) {
                    activeStreams[_targetId].writeStream.end(svgCloseStr);
                }
            }

            if (err) {
                cb(err);
            } else {
                cb(null);
            }
        });
    } else {
        locationPg.insertAnchors(targetPathAnchors, cb);
    }
};

var activeStreamComputationInProgress = false;
var throttledComputeActiveStreamSvg = _.throttle(function () {
    if (!exports.autoComputeSvg) {
        return;
    }

    if (activeStreamComputationInProgress) {
        throttledComputeActiveStreamSvg();
        return;
    }

    activeStreamComputationInProgress = true;
    exports.computeActiveStreamSvg(function () {
        activeStreamComputationInProgress = false;
    });
}, Math.pow(2, 14));

exports.archiveInProgress = false;
var streamFinishCount = -1;
function handleWriteStreamFinish() {
    var targetId, activeFilename, newFilename, stream, streamFinishIndex;

    activeFilename = this.path;
    targetId = new RegExp(locationFS.svgDir + '/(.+?)/', 'g').exec(activeFilename)[1];

    stream = activeStreams[targetId];
    delete activeStreams[targetId];

    streamFinishIndex = ++streamFinishCount;
    exports.archiveInProgress = true;

    function rename(err) {
        if (err) {
            locationMgrLogger('archive', 'fs err');
            return;
        }

        newFilename = locationFS.archiveSVG(activeFilename, targetId, function (err) {
            if (err) {
                locationMgrLogger('archive', 'fs err');
                return;
            }

            locationPg.updateAnchorsFilename(newFilename, targetId, function (err, res) {
                if (streamFinishCount === streamFinishIndex) {
                    exports.archiveInProgress = false;
                }

                if (err) {
                    locationMgrLogger('archive', 'pg err');
                } else {
                    locationMgrLogger('archive', 'success:' + res.rowCount);
                }
            });
        });
    }

    if (stream.bounds !== stream.writtenBounds) {
        locationFS.writeSegment(activeFilename, computeViewBox(stream.bounds), svgParts[0].length + svgParts[1].length, rename);
    } else {
        rename();
    }
}

exports.targetLastSeen = {};
function handleIncomingMessage(message, cb) {
    var parsedMessage, targetId;
    parsedMessage = message.parse(true);
    targetId = parsedMessage.targetId;
    if (typeof targetId === 'string') {
        clientTargetMap[message.clientSocketIndex] = clientTargetMap[message.clientSocketIndex] || {};
        clientTargetMap[message.clientSocketIndex][targetId] = true;
        message = null;

        exports.targetLastSeen[targetId] = new Date();

        if (activeStreams[targetId] instanceof Array) {
            activeStreams[targetId].push(parsedMessage.location);
            targetId = parsedMessage = null;
            throttledComputeActiveStreamSvg();
            cb(null);
        } else {
            locationMgrLogger('streaming', 'start:' + targetId);
            activeStreams[targetId] = [parsedMessage.location];
            parsedMessage = null;

            locationFS.getTargetWriteStream(targetId, function (err, details) {
                if (err) {
                    locationMgrLogger('value', 'err');
                    cb(err);
                } else {
                    throttledComputeActiveStreamSvg();

                    activeStreams[targetId].fileDescriptor = details.fd;
                    activeStreams[targetId].fileSize = details.size;
                    activeStreams[targetId].targetId = targetId;
                    activeStreams[targetId].writeStream = locationFS.createActiveStream(details.file, details.fd, details.size - svgCloseStr.length);
                    activeStreams[targetId].writeStream.on('finish', handleWriteStreamFinish);
                    targetId = null;
                    cb(null);
                }
            });
        }
    } else {
        targetId = message = parsedMessage = null;
        locationMgrLogger('value', 'err');
        cb('target id not found');
    }
}

exports.queue = async.queue(handleIncomingMessage);
exports.queue.pause();

var readyListeners = [];
exports.whenReady = function (fn) {
    if (locationPg.pgStatus === locationPg.pgConnectionStatusList[3] && locationFS.svgDirStatus === locationFS.fsSetupStatusList[2]) {
        fn(null);
    } else {
        readyListeners.push(fn);
    }
};

function processQueue(err) {
    if (err !== null) {
        locationMgrLogger('processQueue', 'err');
    }

    if (locationPg.pgStatus === locationPg.pgConnectionStatusList[3] && locationFS.svgDirStatus === locationFS.fsSetupStatusList[2]) {
        locationMgrLogger('processQueue', 'READY');

        // PG and FS ready!
        setTimeout(function () {
            readyListeners.forEach(function (fn) {
                fn(null);
            });

            readyListeners = [];
            exports.queue.resume();
        }, 10);
    } else if (locationPg.pgStatus === locationPg.pgConnectionStatusList[4]) {
        // PG failed.
        locationMgrLogger('processQueue', 'PGFAIL');
        readyListeners.forEach(function (fn) {
            fn(locationPg.pgStatus);
        });
        readyListeners = [];
    } else if (locationFS.svgDirStatus === locationFS.fsSetupStatusList[3]) {
        // FS failed.
        locationMgrLogger('processQueue', 'FSFAIL');
        readyListeners.forEach(function (fn) {
            fn(locationFS.svgDirStatus);
        });
        readyListeners = [];
    }
}

locationPg.connectPsql(processQueue);
locationFS.setupSvgFs(processQueue);

function handleDeadStreamMessage() {
    locationMgrLogger('phantom stream', 'err');
}

exports.stream = new StreamMgr.Stream();
exports.stream.start();
exports.stream.onValue(function (message) {
    exports.queue.push(message);
});
exports.stream.onClientClose(function (clientSocketIndex) {
    var targetId;

    if (!exports.autoComputeSvg) {
        return;
    }

    for (targetId in clientTargetMap[clientSocketIndex]) {
        if (clientTargetMap[clientSocketIndex].hasOwnProperty(targetId)) {
            if (activeStreams[targetId] && activeStreams[targetId].writeStream) {
                // @TODO finish SVG. Currently we clip the last 0-16 seconds of
                // streaming information.
                activeStreams[targetId].fileSize += svgCloseStr.length;
                activeStreams[targetId].writeStream.end(svgCloseStr);
            }
            locationMgrLogger('streaming', 'end:' + targetId);
            activeStreams[targetId].push = handleDeadStreamMessage;
        }
    }
});

