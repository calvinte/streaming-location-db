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
// SELECT filename, target, lineStyle, array_length(locations, 1), FROM pathref;
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
    exports.pgStatus = exports.pgConnectionStatusList[0];
    var config = {
        database: 'streaming_location_svg',
        host: 'localhost',
        password: '',
        port: 5432,
        user: '',
    };
    var client = new pg.Pool(config);
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
            `, function(err, res) {
                if (err) {
                    psqlLogger('connection', 'err');
                    exports.pgStatus = exports.pgConnectionStatusList[4];
                    cb(err);
                    return;
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
    })
};

exports.insertAnchors = function insertAnchors(targetPathAnchors, cb) {
    var row, i, j, targetId, lineStyle;
    var rows = _.flatten(_.map(targetPathAnchors, anchorsToInsertArr), true);
    if (!rows.length) {
        cb(null);
        return;
    }

    exports.pg.query(format(`
        INSERT INTO locations(${_.keys(locationMgr.location.prototype).join(',')}) VALUES %L RETURNING _id
    `, rows), function(err, res) {
        if (err) {
            psqlLogger('insert', 'err');
            cb(err);
            return;
        } else {
            psqlLogger('insert', 'success' + ':' + res.rowCount);

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
                INSERT INTO pathref(${_.keys(locationMgr.pathref.prototype).join(',')}) VALUES %L
            `, _.flatten(_.map(targetPathAnchors, function(paths, targetId) {
                return _.map(paths, function(anchors, lineStyle) {
                    return [
                        locationFs.activeStreamFilename,
                        '{' + _.map(anchors, function(anchor) {
                            return anchor._id;
                        }).join(',') + '}',
                        targetId,
                        lineStyle
                    ];
                })}), true)), function(err, res) {

                if (err) {
                    psqlLogger('insert', 'err');
                    cb(err);
                } else {
                    cb(null, res);
                }
            });
        }
    });

    function anchorsToInsertArr(paths, targetId) {
        return _.flatten(_.map(paths, function(anchors, lineStyle) {
            return _.map(anchors, function(location) {
                var coordString = location.coordinates.join(' ');
                if (location.coordinates.length === 2) {
                    coordString += ' -999';
                }

                location = _.extend(locationMgr.location.prototype, location);
                location.coordinates = `POINTZ(${coordString})`;
                return _.map(locationMgr.location.prototype, function(n_ll, key) {
                    return location[key];
                });
            });
        }), true);
    }
};

exports.updateAnchorsFilename = function updateAnchorsFilename(filename, targetId, cb) {
    exports.pg.query(format(`
        UPDATE pathref SET filename = '%s' WHERE target = '%s' AND filename = '%s'
    `, filename, targetId, locationFs.activeStreamFilename), function(err, res) {
        if (!err) {
            cb(null, res);
        } else {
            cb(err);
        }
    });
};

