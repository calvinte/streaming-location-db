"use strict"

var StreamMgr = require('./stream');
var SocketMgr = require('./socket');
module.exports = function(message, streamPrefix, clientSocketIndex) {
    this.streamPrefix = streamPrefix;
    this.clientSocketIndex = clientSocketIndex;
    this.message = message;
};
module.exports.prototype = {
    getStream: function() {
        return StreamMgr.streams[this.streamPrefix];
    },
    getSocket: function() {
        return SocketMgr.clientSockets[this.clientSocketIndex];
    },
    maxLength: Math.pow(2, 14),
    parse: function() {
        var parsed, value = this.message.substr(StreamMgr.streamPrefixLength, this.maxLength);

        try {
            parsed = JSON.parse(value);
        } catch(e) {
            LocationMgrLogger('value', 'err');
            return parsed = null;
        }

        return parsed;
    },
};

