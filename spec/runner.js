var assert = require('assert');
var Socket = require('../src/socket');
describe('WebSocket', function() {
    var server;

    describe('StartServer', function() {
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

    describe('CheckStatus', function() {
        it('should open and close a webSocket connection', function(done) {
            Socket.checkStatus(function(err) {
                assert.equal(null, err);
                done();
            });
        });
    });

    describe('StopServer', function() {
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

