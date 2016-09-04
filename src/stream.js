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
    exports.streams[streamPrefix] = this.bus;

    StreamLogger('create', streamPrefix);
    return this;
}

exports.Stream.prototype = {
    end: function() {
        delete exports.streams[this.prefix];
        this.bus.end.apply(this.bus, arguments);
        StreamLogger('bus', 'end');
    },
    error: function() {
        this.bus.error.apply(this.bus, arguments);
        StreamLogger('bus', 'error');
    },
    plug: function() {
        // @TODO not really suported, gotta think about this
        return null;
        this.bus.plug.apply(this.bus, arguments);
        StreamLogger('bus', 'plug');
    },
    push: function() {
        this.bus.push.apply(this.bus, arguments);
        StreamLogger('bus', 'push');
    },
};

exports.compose = function composeMessage(prefix, obj) {
    return prefix + JSON.stringify(obj);
};

