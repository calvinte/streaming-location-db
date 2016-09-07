'use strict'

var async = require('async');
var format = require('pg-format');
var pg = require('pg').native;
var _ = require('underscore');

var locationMgr = require('./location');
var locationFs = require('./filesystem');
var psqlLogger = require('./logger').Logger('psql');

// CREATE DATABASE streaming_location_svg;
// \c streaming_location_svg;
// CREATE EXTENSION Postgis;
// CREATE EXTENSION "uuid-ossp";
//
// again later..
// SELECT filename, target, array_length(locations, 1) FROM pathref;

exports.pgConnectionStatusList = [
    'NEW',
    'CONNECTING',
    'SETUP',
    'DONE',
    'FAIL',
];

exports.pgStatus = exports.pgConnectionStatusList[0];

exports.connectPsql = function connectPsql(cb) {
    exports.pgStatus = exports.pgConnectionStatusList[0];
    pg.connect({
        database: 'streaming_location_svg',
        host: 'localhost',
        password: '',
        poolIdleTimeout: 60000,
        poolSize: 43,
        port: 5432,
        user: '',
    }, function(err, client, done) {
        exports.pgStatus = exports.pgConnectionStatusList[1];

        client.query(`
            SELECT column_name, data_type
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE table_name = 'locations'
        `, function(err, res) {
            if (err) {
                psqlLogger('connection', 'err');
                exports.pgStatus = exports.pgConnectionStatusList[4];
                cb(err);
                done(err)
                return;
            }

            if (res.rowCount === 0) {
                exports.pgStatus = exports.pgConnectionStatusList[2];
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
                        target CHARACTER(24),
                        locations UUID[]
                    );
                    CREATE INDEX svg_path ON pathref (target, filename);
                `, function(err, res) {
                    if (err) {
                        psqlLogger('connection', 'err');
                        exports.pgStatus = exports.pgConnectionStatusList[4];
                        cb(err);
                        done(err);
                        return;
                    } else {
                        exports.pg = client;
                        exports.pgStatus = exports.pgConnectionStatusList[3];
                        cb(null);
                        done(null);
                    }
                });
            } else {
                exports.pg = client;
                exports.pgStatus = exports.pgConnectionStatusList[3];
                cb(null, res);
                done();
            }
        })
    });
};

exports.insertAnchors = function insertAnchors(targetPathAnchors, cb) {
    var row, i, j, targetId;
    var rows = _.flatten(_.map(targetPathAnchors, anchorsToInsertArr), true);
    if (!rows.length) {
        cb(null);
        return;
    }

    pgQueue(function(pgqueueCb) {
        exports.pg.query(format(`
            INSERT INTO locations(${_.keys(locationMgr.location.prototype).join(',')}) VALUES %L RETURNING _id
        `, rows), function(err, res) {
            if (err) {
                psqlLogger('insert', 'err');
                pgqueueCb();
                cb(err);
                return;
            } else {
                psqlLogger('insert', 'success' + ':' + res.rowCount);

                j = -1;
                for (targetId in targetPathAnchors) {
                    for (i in targetPathAnchors[targetId]) {
                        row = res.rows[++j];
                        targetPathAnchors[targetId][i]._id = row['_id']
                    }
                }

                exports.pg.query(format(`
                    INSERT INTO pathref(${_.keys(locationMgr.pathref.prototype).join(',')}) VALUES %L
                `, _.map(targetPathAnchors, function(anchors, targetId) {
                    return [
                        locationFs.activeStreamFilename,
                        '{' + _.map(anchors, function(anchor) {
                            return anchor._id;
                        }).join(',') + '}',
                        targetId
                    ];
                })), function(err, res) {
                    pgqueueCb();

                    if (err) {
                        psqlLogger('insert', 'err');
                        cb(err);
                    } else {
                        cb(null, res);
                    }
                });
            }
        });
    });

    function anchorsToInsertArr(anchors, targetId) {
        return _.map(anchors, function(location) {
            var coordString = location.coordinates.join(' ');
            if (location.coordinates.length === 2) {
                coordString += ' -999';
            }

            location = _.extend(locationMgr.location.prototype, location);
            location.coordinates = `POINTZ(${coordString})`;
            return _.toArray(location);
        });
    }
};

exports.updateAnchorsFilename = function updateAnchorsFilename(filename, targetId, cb) {
    pgQueue(function(pgqueueCb) {
        exports.pg.query(format(`
            UPDATE pathref SET filename = '%s' WHERE target = '%s' AND filename = '%s'
        `, filename, targetId, locationFs.activeStreamFilename), function(err, res) {
            pgqueueCb();

            if (!err) {
                cb(null, res);
            } else {
                cb(err);
            }
        });
    });
};

var _pgQueue = async.queue(pgRunner);
function pgQueue(fn) {
    _pgQueue.push(fn);
}

function pgRunner(fn, cb) {
    // @TODO investigate https://github.com/brianc/node-postgres/issues/1060
    // [Error: Unable to set non-blocking to true]
    // seems to occur less often if I put some time between queries (?)
    // ...this is a temp. solution.
    setTimeout(function() {
        fn(cb);
    }, 10);
}

