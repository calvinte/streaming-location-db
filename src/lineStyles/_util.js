exports.svgDecimalPrecision = 5;
exports.locationsToVectorPosition = function locationsToVectorPosition() {
    var i, j, locations = Array(arguments.length * 2);

    for (i = j = 0; i < arguments.length; i++) {
        if (arguments[i].longitude && arguments[i].latitude) {
            locations[j++] = parseFloat(arguments[i].longitude).toFixed(exports.svgDecimalPrecision);
            locations[j++] = parseFloat(arguments[i].latitude).toFixed(exports.svgDecimalPrecision);
        } else if (typeof arguments[i][0] === 'number' && typeof arguments[i][1] === 'number') {
            locations[j++] = (arguments[i][0]).toFixed(exports.svgDecimalPrecision);
            locations[j++] = (arguments[i][1]).toFixed(exports.svgDecimalPrecision);
        } else {
            LocationMgrLogger('locationsToVectorPosition', 'err, unexpected input')
            locations[j++] = 0;
            locations[j++] = 0;
        }
    }

    return locations;
}

