var WebSocket = require('ws');
var StreamMgr = require('./stream');
var SocketLogger = require('./logger').Logger('socket');

var port = 3002;
var server = null;
var sockets = [];

exports.checkStatus = function checkStatus(cb) {
    var stream = new StreamMgr.Stream();

    var client = new WebSocket('ws://localhost:' + port);
    client.on('open', function() {
        client.send(stream.prefix + 'STATUSCHECK', function(err) {
            if (err) {
                cb(err);
                return;
            }

            // Timeout allows message to arrive before terminating the client.
            setTimeout(function() {
                stream.end();
                client.terminate();
                cb(null);
            }, 10);
        });
    });
};

exports.startServer = function startServer(cb) {
    if (server !== null) {
        cb(null);
        return this;
    }

    server = new WebSocket.Server({
        port: port,
    }, cb);

    server.on('connection', handleServerConnection);
    server.on('error', handleServerError);
    server.on('headers', handleServerHeaders);
    return this;
};

exports.stopServer = function stopServer(cb) {
    if (server === null) {
        cb('no server');
    }

    server.close(cb);
    server = null;
};

exports.getServer = function getServer() {
    return server;
};

function handleClientClose(event) {
    var socketIndex;

    socketIndex = sockets.indexOf(this);

    if (socketIndex === -1) {
        SocketLogger('client', 'close', 'error, client not found');
        return null;
    }

    sockets.splice(socketIndex, 1);
    SocketLogger('client', 'close');
};

function handleClientError(err) {
    SocketLogger('client', 'error');
};

function handleClientException(exception) {
    SocketLogger('client', 'exception');
}

function handleClientMessage(message) {
    var stream, streamPrefix = message.substr(0, StreamMgr.streamPrefixLength);

    if (stream = StreamMgr.streams[streamPrefix]) {
        stream.push(message);
        SocketLogger('client', 'message');
    } else {
        handleClientException(message);
    }
};

function handleClientOpen(event) {
    SocketLogger('client', 'open');
};

function handleServerConnection(socket) {
    sockets.push(socket);

    socket.on('close', handleClientClose);
    socket.on('error', handleClientError);
    socket.on('open', handleClientOpen);
    socket.on('message', handleClientMessage);
    SocketLogger('server', 'connection');
};

function handleServerError(event) {
    SocketLogger('server', 'error');
};

function handleServerHeaders(event) {
    SocketLogger('server', 'headers');
};


