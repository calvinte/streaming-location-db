var assert = require('assert');
var Socket = require('../src/socket');
var Stream = require('../src/stream');
var LocationMgr = require('../src/locationMgr');
var WebSocket = require('ws');

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

    describe('Check WebSocket Server Status', function() {
        it('should open and close a webSocket connection', function(done) {
            Socket.checkStatus(function(err) {
                assert.equal(null, err);
                done();
            });
        });
    });

    describe('Stream Location', function() {
        it('should stream a lat/lng pair to the WebSocket Server', function(done) {
            var client = new WebSocket('ws://localhost:' + Socket.port);
            var location = new LocationMgr.location({location: [-122.4135, 37.7858, 36], time: new Date()});
            var message = Stream.compose(LocationMgr.stream.prefix, {
                location: location,
                object: 'spec'
            });

            client.on('open', function() {
                client.send(message, function(err) {
                    assert.equal(null, err);

                    setTimeout(function() {
                        done();
                    }, 10);
                });
            });
        });
    });

    describe('Stop WebSocket Server', function() {
        it('should stop the webSocket server', function(done) {
            assert(server !== null);
            if (server === null) {
                done();
                return;
            }

            server.stopServer(function(err) {
                assert.equal(null, err);
                done();
            });
        });
    });
});

