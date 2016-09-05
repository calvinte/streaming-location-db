"use strict"

var WebSocket = require('ws');

var Message = require('./message');
var StreamMgr = require('./stream');
var SocketLogger = require('./logger').Logger('socket');
var locationStream = require('./location');

var server = null;

exports.port = 3002;
exports.clientSockets = [];
exports.checkStatus = function checkStatus(cb) {
    var stream = new StreamMgr.Stream();
    var client = new WebSocket('ws://localhost:' + exports.port);
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
        port: exports.port,
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
    var streamPrefix, clientSocketIndex = exports.clientSockets.indexOf(this);

    if (clientSocketIndex === -1) {
        SocketLogger('client', 'close', 'error, client not found');
        return null;
    }

    for (streamPrefix in socketStreamMap[clientSocketIndex]) {
        StreamMgr.streams[streamPrefix].closeClient(clientSocketIndex);
    }

    socketStreamMap[clientSocketIndex] = null
    exports.clientSockets[clientSocketIndex] = null;
    SocketLogger('client', 'close');
};

function handleClientError(err) {
    SocketLogger('client', 'error');
};

function handleClientException(exception) {
    SocketLogger('client', 'exception');
}

var socketStreamMap = {};
function handleClientMessage(message) {
    var stream, streamPrefix = message.substr(0, StreamMgr.streamPrefixLength);
    var clientSocketIndex;

    if (message.length > Message.maxLength) {
        handleClientException(null);
        return;
    }

    if (streamPrefix && (stream = StreamMgr.streams[streamPrefix])) {
        clientSocketIndex = exports.clientSockets.indexOf(this);

        socketStreamMap[clientSocketIndex] = socketStreamMap[clientSocketIndex] || {};
        socketStreamMap[clientSocketIndex][streamPrefix] = true;
        stream.clientSockets[clientSocketIndex] = true;

        stream.push(new Message(message, streamPrefix, clientSocketIndex));
    } else {
        handleClientException(message);
    }
};

function handleClientOpen(event) {
    SocketLogger('client', 'open');
};

function handleServerConnection(clientSocket) {
    exports.clientSockets.push(clientSocket);

    clientSocket.on('close', handleClientClose);
    clientSocket.on('error', handleClientError);
    clientSocket.on('open', handleClientOpen);
    clientSocket.on('message', handleClientMessage);
    SocketLogger('server', 'connection');
};

function handleServerError(event) {
    SocketLogger('server', 'error');
};

function handleServerHeaders(event) {
    SocketLogger('server', 'headers');
};


