var async = require('async');
var fs = require('fs');
var pg = require('pg').native;
var _ = require('underscore');

var LocationMgrLogger = require('./logger').Logger('locationMgr');
var simplify = require('simplify-path');
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
    var targetId, stream, path;

    activeStreams = {};

    for (targetId in streamsToUpdate) {
        stream = streamsToUpdate[targetId];
        path = simplify(_.chain(stream).map(locationToLatLng).compact().value());
        // @TODO persist path as SVG, also persist start/end location in psql
    }
    stream = targetId = locationShard = null;
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

function handleValue(value, cb) {
    var jsonValue;
    try {
        jsonValue = JSON.parse(value);
    } catch(e) {
        LocationMgrLogger('value', 'err');
        return;
    }

    if (typeof jsonValue.targetId === 'string') {
        mkSvgDir(jsonValue.targetId, function(err) {
            if (err) {
                LocationMgrLogger('value', 'err');
                cb(err);
            } else {
                activeStreams[jsonValue.targetId].push(jsonValue.location);
                throttledComputeActiveStreamSvg();
                LocationMgrLogger('value', 'pushed');
                cb(null);
            }
        });
    } else {
        LocationMgrLogger('value', 'err');
    }
};

var activeStreams = {};
function mkSvgDir(targetId, cb) {
    if (activeStreams[targetId] instanceof Array) {
        cb(null);
        return;
    }

    fs.access(exports.svgDir + '/' + targetId, fs.F_OK, function(err) {
        if (err) {
            LocationMgrLogger('svg', 'mkdir');
            fs.mkdir(exports.svgDir + '/' + targetId, function(err) {
                if (err) {
                    cb(err);
                } else {
                    activeStreams[targetId] = [];
                    cb(null);
                }
            });
        } else {
            activeStreams[targetId] = [];
            cb(null);
        }
    });
};

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

