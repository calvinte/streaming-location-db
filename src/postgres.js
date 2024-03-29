'use strict';

var async = require('async');
var format = require('pg-format');
var pg = require('pg').native;
var _ = require('underscore');

var locationMgr = require('./location');
var model = require('./model');
var locationFs = require('./filesystem');
var psqlLogger = require('./logger').Logger('psql');

// CREATE DATABASE streaming_locations;
// \c streaming_locations;
// CREATE EXTENSION Postgis;
// CREATE EXTENSION "uuid-ossp";
//
// again later..
// SELECT filename, target, lineStyle, SUM(array_length(locations, 1)) FROM pathref GROUP BY filename, target, lineStyle;
//
// fresh state:
// rm -rf .svg_db
// DROP TABLE locations;DROP TABLE pathref;

exports.pgConnectionStatusList = [
    'NEW',
    'CONNECTING',
    'SETUP',
    'DONE',
    'FAIL',
];

exports.pgStatus = exports.pgConnectionStatusList[0];

exports.connectPsql = function connectPsql(cb) {
    var config, client;
    exports.pgStatus = exports.pgConnectionStatusList[0];
    config = {
        database: 'streaming_locations',
        host: 'localhost',
        password: '',
        port: 5432,
        user: '',
    };
    client = new pg.Pool(config);
    exports.pgStatus = exports.pgConnectionStatusList[1];

    client.query(`
        SELECT column_name, data_type
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE table_name = 'locations'
    `, function (err, res) {
        if (err) {
            psqlLogger('connection', 'err');
            exports.pgStatus = exports.pgConnectionStatusList[4];
            cb(err);
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
                    filename CHARACTER(17) NOT NULL,
                    target CHARACTER(24) NOT NULL,
                    locations UUID[],
                    lineStyle CHARACTER(24) NOT NULL
                );
                CREATE INDEX svg_path ON pathref (target, filename);
            `, function (err) {
                if (err) {
                    psqlLogger('connection', 'err');
                    exports.pgStatus = exports.pgConnectionStatusList[4];
                    cb(err);
                } else {
                    psqlLogger('create table', 'success');
                    exports.pg = client;
                    exports.pgStatus = exports.pgConnectionStatusList[3];
                    cb(null);
                }
            });
        } else {
            psqlLogger('connection', 'success');
            exports.pg = client;
            exports.pgStatus = exports.pgConnectionStatusList[3];
            cb(null, res);
        }
    });
};

exports.insertAnchors = function insertAnchors(targetPathAnchors, cb) {
   var row, i, j, targetId, lineStyle, rows;

    function anchorsToInsertArr(paths, targetId) {
        return _.flatten(_.map(paths, function (anchors, lineStyle) {
            return _.map(anchors, function (location) {
                var coordString = location.coordinates.join(' ');
                if (location.coordinates.length === 2) {
                    coordString += ' -999';
                }

                location = _.extend(model.location.prototype, location);
                location.coordinates = `POINTZ(${coordString})`;
                return _.map(model.location.prototype, function (n_ll, key) {
                    return location[key];
                });
            });
        }), true);
    }

    rows = _.flatten(_.map(targetPathAnchors, anchorsToInsertArr), true);
    if (!rows.length) {
        cb(null);
        return;
    }

    exports.pg.query(format(`
        INSERT INTO locations(${_.keys(model.location.prototype).join(',')}) VALUES %L RETURNING _id
    `, rows), function (err, res) {
        if (err) {
            // @TODO: duplicate key value violates unique constraint "locations_pkey"
            // Happens when under high load. Try:
            // node server.js &;
            // ... when ready ...
            // node demoClient.js
            psqlLogger('insert', 'err');
            cb(err);
        } else {
            psqlLogger('insert', 'locations' + ':' + res.rowCount);

            j = -1;
            for (targetId in targetPathAnchors) {
                for (lineStyle in targetPathAnchors[targetId]) {
                    for (i in targetPathAnchors[targetId][lineStyle]) {
                        row = res.rows[++j];
                        targetPathAnchors[targetId][lineStyle][i]._id = row['_id']
                    }
                }
            }

            exports.pg.query(format(`
                INSERT INTO pathref(${_.keys(model.pathref.prototype).join(',')}) VALUES %L
            `, _.flatten(_.map(targetPathAnchors, function (paths, targetId) {
                return _.map(paths, function (anchors, lineStyle) {
                    return [
                        locationFs.activeStreamFilename,
                        '{' + _.map(anchors, function (anchor) {
                            return anchor._id;
                        }).join(',') + '}',
                        targetId,
                        lineStyle
                    ];
                })}), true)), function (err, res) {

                if (err) {
                    psqlLogger('insert', 'err');
                    cb(err);
                } else {
                    psqlLogger('insert', 'pathref' + ':' + res.rowCount);
                    cb(null, res);
                }
            });
        }
    });
};

exports.updateAnchorsFilename = function updateAnchorsFilename(filename, targetId, cb) {
    exports.pg.query(format(`
        UPDATE pathref SET filename = '%s' WHERE target = '%s' AND filename = '%s'
    `, filename, targetId, locationFs.activeStreamFilename), function (err, res) {
        if (res && res.rowCount > 0 && !err) {
            cb(null, res);
        } else {
            cb(err || 'NO ROWS?');
        }
    });
};

