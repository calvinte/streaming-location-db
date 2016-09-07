"use strict"

var loggingEnabled = true;
var colWidth = 24;
exports.Logger = function Logger(id) {
    var prefix = id + ':';

    return function(component, msg) {
        var col, i, _col = '';
        if (loggingEnabled) {
            col = prefix + component;
            if ((i = colWidth - col.length) > 0) {
                while (i-- > 0) {
                    _col += ' ';
                }
            }

            console.log(_col + col, msg);
        }
    }
}

