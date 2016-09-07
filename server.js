var LocationMgr = require('./src/location');
var SocketHelper = require('socket-helper');
var Socket = SocketHelper.Socket;
LocationMgr.whenReady(function(err) {
    server = Socket.startServer(function(err) {
        server.checkStatus(function() {
            console.log('ready');
        });
    });
});

