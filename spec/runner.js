var assert = require('assert');
var async = require('async');
var _ = require('underscore');
var WebSocket = require('ws');

var SocketHelper = require('socket-helper');
var LocationMgr = require('../src/location');
var specLocations= require('./locations');
var Socket = SocketHelper.Socket;
var Stream = SocketHelper.Stream;
var Message = SocketHelper.Message;

LocationMgr.autoComputeSvg = false;

describe('Streaming Locations -> SVG', function() {
    var server;
    describe('Start WebSocket Server', function() {
        it('should initiate a webSocket server', function(done) {
            server = Socket.startServer(function(err) {
                assert.equal(null, err);
                done();
            });

            assert(server !== null);
            if (server === null) {
                done();
            }
        });
    });

    describe('LocationMgr Ready', function() {
        it('should prepare PSQL and create the SVG dir', function(done) {
            LocationMgr.whenReady(function(err) {
                assert.equal(null, err);
                done();
            });
        });
    });

    describe('Stream Locations', function() {
        it('should stream lat/lng pairs to the WebSocket Server', function(done) {
            var fast = LocationMgr.autoComputeSvg ? 1 : 100;
            this.timeout(400000/fast);
            var client = new WebSocket('ws://localhost:' + Socket.port);
            client.on('open', function() {
                async.parallel(_.map(specLocations, function(locations, targetId) {
                    return function(cb) {
                        async.series(_.map(locations, function(coordinates) {
                            return function(cb) {
                                var location = new LocationMgr.location({
                                    coordinates: coordinates,
                                    time: new Date()
                                });

                                var message = new Message({
                                    location: location,
                                    targetId: targetId
                                }, LocationMgr.stream.prefix);

                                client.send(message.encode(true), function(err) {
                                    setTimeout(function() {
                                        cb(err);
                                    }, 100/fast);
                                });
                            };
                        }), function(err) {
                            setTimeout(function() {
                                cb(err);
                            }, 4);
                        });
                    }
                }), function(err) {
                    assert.equal(null, err);

                    setTimeout(function() {
                        done();
                    }, 40);
                });
            });
        });
    });

    describe('Compute stream svg', function() {
        it('should create svgs for active streams', function(done) {
            if (LocationMgr.autoComputeSvg) {
                done();
                return;
            }

            LocationMgr.computeActiveStreamSvg(function(err) {
                assert.equal(null, err);

                setTimeout(function() {
                    done();
                }, 40);
            });
        });
    });
});

