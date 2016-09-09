var d3 = require('d3');
var geolib = require('geolib');
var _ = require('underscore');

var lineUtil = require('./_util.js');
module.exports = function raw(points, color) {
    var i, point = null, skippedPoints = null;

    var minX, maxX, minY, maxY;

    var prevAnchor, anchors;
    var path = d3.path();

    if (points.lastAnchor) {
        prevAnchor = points.lastAnchor.coordinates;
        anchors = [points.lastAnchor];
    } else {
        prevAnchor = points[0].coordinates;
        anchors = [points[0]];
    }

    path.moveTo.apply(path, lineUtil.locationsToVectorPosition(prevAnchor));

    minX = maxX = prevAnchor[0];
    minY = maxY = prevAnchor[1];

    for (i = points.lastAnchor ? 0 : 1; i < points.length; i++) {
        point = points[i].coordinates;

        minX = Math.min(point[0], minX);
        maxX = Math.max(point[0], maxX);
        minY = Math.min(point[1], minY);
        maxY = Math.max(point[1], maxY);

        // Draw new point, straight line
        anchors.push(points[i]);
        prevAnchor = point;

        path.lineTo.apply(path, lineUtil.locationsToVectorPosition(point));
    }

    return {
        anchors: anchors,
        bounds: lineUtil.locationsToVectorPosition([minX, minY], [maxX, maxY]),
        path: '<path d="' + path.toString() + '" fill="none" stroke="' + color + '" stroke-width="0.00005" />'
    };
}

