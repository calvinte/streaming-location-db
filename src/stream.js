"use strict"

var Socket = require('./socket');
var Bacon = require('baconjs');
var WebSocket = require('ws');
var StreamLogger = require('./logger').Logger('stream');

exports._streamCount = -1;
exports.streamPrefixLength = 4;
exports.streams = {};
exports.Stream = function Stream() {
    var streamIdx = ++exports._streamCount;
    var streamPrefix = '', deltaLength, i;

    if (streamIdx < Math.pow(10, exports.streamPrefixLength - 1)) {
        deltaLength = exports.streamPrefixLength - 1 - streamPrefix.length;
        for (i = 0; i < deltaLength; i++) {
            streamPrefix += '0';
        }
    }
    streamPrefix += streamIdx.toString();

    this.bus = new Bacon.Bus();
    this.prefix = streamPrefix;
    this.clientSockets = {};
    this.clientCloseListeners = [];

    exports.streams[streamPrefix] = this;

    StreamLogger('create', streamPrefix);
    return this;
}

exports.Stream.prototype = {
    closeClient: function(clientSocketIndex) {
        delete this.clientSockets[clientSocketIndex];
        this.clientCloseListeners.forEach(function(fn) {
            fn.call(this, clientSocketIndex);
        });
    },
    getSockets: function() {
        var i = -1, clientSocketIndex, sockets = Array(Object.getOwnPropertyNames(this.clientSockets).length);
        for (clientSocketIndex in this.clientSockets) {
            sockets[++i] = Socket.clientSockets[clientSocketIndex];
        }
        return sockets;
    },
    end: function() {
        delete exports.streams[this.prefix];
        this.bus.end.apply(this.bus, arguments);
        StreamLogger('bus', 'end');
    },
    error: function() {
        this.bus.error.apply(this.bus, arguments);
        StreamLogger('bus', 'error');
    },
    offClientClose: function(fn) {
        var fnIdx = this.clientCloseListeners.indexOf(fn);
        if (fnIdx > -1) {
            this.clientCloseListeners.splice(fnIdx, 1);
        }
    },
    onClientClose: function(fn) {
        this.clientCloseListeners.push(fn);
    },
    plug: function() {
        // @TODO not really suported, gotta think about this
        return null;
        this.bus.plug.apply(this.bus, arguments);
        StreamLogger('bus', 'plug');
    },
    push: function() {
        this.bus.push.apply(this.bus, arguments);
    },
};

exports.compose = function composeMessage(prefix, obj) {
    return prefix + JSON.stringify(obj);
};

