"use strict"

var async = require('async');
var fs = require('fs');
var d3 = require('d3');
var geolib = require('geolib');
var pg = require('pg').native;
var _ = require('underscore');

var LocationMgrLogger = require('./logger').Logger('locationMgr');
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
// CREATE EXTENSION Postgis;
// CREATE EXTENSION "uuid-ossp";
exports.pg = null;
connectPsql();

exports.svgDir = './.svg_db';
setupSvgFs();

exports.queue = async.queue(handleValue);
exports.queue.pause();

exports.stream = new StreamMgr.Stream();
exports.stream.bus.onValue(function(value) {
    exports.queue.push(value);
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

var readyListeners = [];
exports.whenReady = function(fn) {
    if (exports.pgStatus === pgConnectionStatusList[3] && exports.svgDirStatus === fsSetupStatusList[2]) {
        fn(null);
    } else {
        readyListeners.push(fn);
    }
};

exports.computeActiveStreamSvg = function computeActiveStreamSvg() {
    var streamsToUpdate = activeStreams;
    var targetId, stream, pathDetails, fd;

    activeStreams = {};

    for (targetId in streamsToUpdate) {
        stream = streamsToUpdate[targetId];
        fd = streamsToUpdate[targetId].fileDescriptor;
        pathDetails = locationStreamToBezier(stream);
        //console.log(pathDetails);

        createActiveStream(targetId);
        // @TODO persist path & locaitons
    }
    stream = targetId = null;
};
var throttledComputeActiveStreamSvg = _.throttle(exports.computeActiveStreamSvg, Math.pow(2, 14));

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
                        location GEOGRAPHY(POINTZ, 4326) NOT NULL,
                        heading REAL,
                        speed REAL,
                        accuracy REAL
                    )
                `, function(err, res) {
                    if (err) {
                        exports.pgStatus = pgConnectionStatusList[4];
                        done();
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

function createActiveStream(targetId) {
    var stream = fs.createWriteStream(getTargetActiveFilename(targetId));
    stream.on('close', handleWriteStreamClose);
    stream.on('drain', handleWriteStreamDrain);
    stream.on('error', handleWriteStreamError);
    stream.on('finish', handleWriteStreamFinish);
    stream.on('pipe', handleWriteStreamPipe);
    stream.on('unpipe', handleWriteStreamUnpipe);
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
        cb(null);
        return;
    }

    fs.access(path, fs.F_OK, function(err) {
        if (err) {
            LocationMgrLogger('svg', 'mkdir');
            fs.mkdir(path, function(err) {
                if (err) {
                    cb(err);
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
                cb(err);
                return;
            }

            fs.fstat(fd, function(err, stats) {
                if (err) {
                    cb(err);
                    return;
                }

                activeStreams[targetId] = [];
                activeStreams[targetId].fileDescriptor = fd;
                activeStreams[targetId].fileSize = stats.size;

                cb(null);
            });
        });
    }
};

function getSqDist(p1, p2) {
    var dx = p1[0] - p2[0],
    dy = p1[1] - p2[1];

    return dx * dx + dy * dy;
}

function handleValue(value, cb) {
    var jsonValue;
    try {
        jsonValue = JSON.parse(value);
    } catch(e) {
        LocationMgrLogger('value', 'err');
        return;
    }

    if (typeof jsonValue.targetId === 'string') {
        getTargetWriteStream(jsonValue.targetId, function(err) {
            if (err) {
                LocationMgrLogger('value', 'err');
                cb(err);
            } else {
                activeStreams[jsonValue.targetId].push(jsonValue.location);
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
    LocationMgrLogger('write', 'close');
};

function handleWriteStreamDrain(event) {
    LocationMgrLogger('write', 'drain');
};

function handleWriteStreamError(event) {
    LocationMgrLogger('write', 'err');
};

function handleWriteStreamFinish(event) {
    LocationMgrLogger('write', 'finish');
};

function handleWriteStreamPipe(src) {
    LocationMgrLogger('write', 'pipe');
};

function handleWriteStreamUnpipe(src) {
    LocationMgrLogger('write', 'unpipe');
};

var sqLineToleranceDegrees = Math.pow(0.001, 2); // ~110.57^2 meters
function locationStreamToBezier(points) {
    if (points.length < 2) {
        return points;
    }

    var i, isLastPoint, point = null, skippedPoints = null, sqDistance = null;
    var spliceIdx, spliceBiasCeil = true, handles = new Array(2);

    var prevPoint = points[0].coordinates;
    var anchors = [prevPoint];
    var path = d3.path();
    path._x0 = prevPoint[0];
    path._y0 = prevPoint[1];

    for (i = 1; i < points.length; i++) {
        point = points[i].coordinates;
        isLastPoint = i === points.length - 1;

        if (!isLastPoint) {
            sqDistance = getSqDist(point, prevPoint);
        } else {
            sqDistance = null;
        }

        if (skippedPoints === null && (isLastPoint || sqDistance > sqLineToleranceDegrees)) {
            // Draw new point, straight line
            anchors.push(point);
            prevPoint = point;
            path.moveTo(point[0], point[1]);
        } else if (isLastPoint || sqDistance > sqLineToleranceDegrees) {
            // Draw new point, average skipped points as bezier
            if (skippedPoints.length === 1) {
                path.quadraticCurveTo(skippedPoints[0][0], skippedPoints[0][1], point[0], point[1]);
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
                path.moveTo(point[0], point[1]);
                path.bezierCurveTo(handles[0].longitude, handles[0].latitude, handles[1].longitude, handles[1].latitude, point[0], point[1]);
            }

            anchors.push(point);
            skippedPoints = spliceIdx = handles[0] = handles[1] = null;
        } else if (skippedPoints === null) {
            // Too close; we have skipped one point.
            skippedPoints = [point];
        } else {
            // Too close; we have skipped many points.
            skippedPoints.push(point);
        }
    }

    return {
        path: path.toString(),
        anchors: anchors
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
    LocationMgrLogger('svg', 'fs');
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

