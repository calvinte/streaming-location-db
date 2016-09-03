var loggingEnabled = true;
exports.Logger = function Logger(id) {
    var prefix = id + ':';

    return function(component, msg) {
        if (loggingEnabled) {
            console.log(prefix, component, msg);
        }
    }
}

