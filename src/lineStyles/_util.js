exports.lineStylesLogger = require('../logger').Logger('lineStyles');
exports.svgDecimalPrecision = 5;

exports.getSqDist = function getSqDist(p1, p2) {
    var dx = p1[0] - p2[0],
    dy = p1[1] - p2[1];

    return dx * dx + dy * dy;
}

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
            exports.lineStylesLogger('locationsToVectorPosition', 'err, unexpected input')
            locations[j++] = 0;
            locations[j++] = 0;
        }
    }

    return locations;
};

exports.pathToSvg = function pathToSvg(path, color) {
    return '<path d="' + path.toString() + '" fill="none" stroke="' + color + '" stroke-width="0.00005" />';
};

