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

    this.stream = new Bacon.Bus();
    this.prefix = streamPrefix;
    exports.streams[streamPrefix] = this.stream;

    StreamLogger('create', streamPrefix);
    return this;
}

exports.Stream.prototype = {
    end: function() {
        delete exports.streams[this.prefix];
        this.stream.end.apply(this.stream, arguments);
        StreamLogger('bus', 'end');
    },
    error: function() {
        this.stream.error.apply(this.stream, arguments);
        StreamLogger('bus', 'error');
    },
    plug: function() {
        this.stream.plug.apply(this.stream, arguments);
        StreamLogger('bus', 'plug');
    },
    push: function() {
        this.stream.push.apply(this.stream, arguments);
        StreamLogger('bus', 'push');
    },
};

