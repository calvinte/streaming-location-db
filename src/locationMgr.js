var StreamMgr = require('./stream');
var pg = require('pg').native;
var fs = require('fs');
var async = require('async');
var LocationMgrLogger = require('./logger').Logger('locationMgr');

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
exports.pg = null;
connectPsql();

exports.svgDir = './.svg_db';
setupSvgFs();

exports.queue = async.queue(handleValue);
exports.queue.pause();

exports.stream = new StreamMgr.Stream();
exports.stream.bus.onValue(function(value) {
    if (exports.queue.length === 0 && exports.pgStatus === pgConnectionStatusList[3] && exports.svgDirStatus === fsSetupStatusList[2]) {
        handleValue(value);
    } else {
        exports.queue.push(value);
        LocationMgrLogger('value', 'queue');
    }
});

exports.location = function(options) {
    this.accuracy = options.accuracy || exports.location.prototype.accuracy;
    this.bearing = options.bearing || exports.location.prototype.bearing;
    this.location = options.location || exports.location.prototype.location;
    this.speed = options.speed || exports.location.prototype.speed;
    this.time = options.time || exports.location.prototype.time;
};

exports.location.prototype = {
    'accuracy': null,
    'bearing': null,
    'location': null,
    'speed': null,
    'time': null,
};

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
                        bearing REAL,
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
                        done();
                    }
                });
            } else {
                exports.pg = client;
                exports.pgStatus = pgConnectionStatusList[3];
                done();
            }
        })
    });
};

function handleValue() {
    // @TODO
    LocationMgrLogger('value', 'handle');
};

var activeStreams = {};
function mkSvgDir(objId, cb) {
    LocationMgrLogger('svg', 'mkdir');
    if (activeStreams[objId] instanceof Array) {
        cb(null);
        return;
    }

    fs.access(exports.svgDir + '/' + objId, fs.F_OK, function(err) {
        if (err) {
            fs.mkdir(exports.svgDir, function(err) {
                if (err) {
                    cb(err);
                } else {
                    activeStreams[objId] = [];
                    cb(null);
                }
            });
        } else {
            activeStreams[objId] = [];
            cb(null);
        }
    });
};

function processQueue() {
    if (exports.pgStatus === pgConnectionStatusList[3] && exports.svgDirStatus === fsSetupStatusList[2]) {
        // PG and FS ready!
    } else if (exports.pgStatus === pgConnectionStatusList[4]) {
        // PG failed.
        LocationMgrLogger('processQueue', 'PGFAIL')
    } else if (exports.svgDirStatus === fsSetupStatusList[3]) {
        // FS failed.
        LocationMgrLogger('processQueue', 'FSFAIL')
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
                }
            });
        } else {
            exports.svgDirStatus = fsSetupStatusList[2];
        }
    });
};

