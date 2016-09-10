'use strict';

var d3 = require('d3');
var lineUtil = require('./_util');

// @see https://gist.github.com/adammiller/826148
function distanceFromLineToPoint(line, point) {
    var slope, yOffset;

    slope = (line[1][1] - line[0][1]) / (line[1][0] - line[0][0]);
    yOffset = line[0][1] - (slope * line[0][0]);

    return Math.min(
        Math.abs(point[1] - (slope * point[0]) - yOffset) / Math.sqrt(Math.pow(slope, 2) + 1),
        Math.sqrt(lineUtil.getSqDist(point, line[0])),
        Math.sqrt(lineUtil.getSqDist(point, line[1]))
    );
}

var tolerance = 0.0001; // ~11.06 meters
function douglasPeucker(points) {
    var returnPoints, line, distance, maxDistance, maxDistanceIndex, i, point;

    if (points.length <= 2) {
        return [points[0]];
    }

    returnPoints = [];
    // make line from start to end 
    line = [points[0].coordinates, points[points.length - 1].coordinates];

    // find the largest distance from intermediate poitns to this line
    maxDistance = 0;
    maxDistanceIndex = 0;
    for (i = 1; i <= points.length - 2; i++) {
        point = points[i].coordinates;
        distance = distanceFromLineToPoint(line, point);

        if (distance > maxDistance) {
            maxDistance = distance;
            maxDistanceIndex = i;
        }
    }

    // check if the max distance is greater than our tollerance allows 
    if (maxDistance >= tolerance) {
        point = points[maxDistanceIndex].coordinates;
        // include this point in the output 
        returnPoints = returnPoints.concat(douglasPeucker(points.slice(0, maxDistanceIndex + 1)));
        // returnPoints.push(points[maxDistanceIndex]);
        returnPoints = returnPoints.concat(douglasPeucker(points.slice(maxDistanceIndex, points.length)));
    } else {
        // ditching this point
        point = points[maxDistanceIndex].coordinates;
        returnPoints = [points[0]];
    }

    return returnPoints;
}


module.exports = function simplifyPath(locations, color) {
    var i, anchors, minX, maxX, minY, maxY, prevAnchor, path;

    path = d3.path();

    if (locations.lastAnchor) {
        prevAnchor = locations.lastAnchor.coordinates;
        anchors = [locations.lastAnchor];
    } else {
        prevAnchor = locations[0].coordinates;
        anchors = [locations[0]];
    }

    path.moveTo.apply(path, lineUtil.locationsToVectorPosition(prevAnchor));
    minX = maxX = prevAnchor[0];
    minY = maxY = prevAnchor[1];


    anchors = douglasPeucker(locations);
    // always have to push the very last point on so it doesn't get left off
    anchors.push(locations[locations.length - 1]);

    for (i = locations.lastAnchor ? 0 : 1; i < anchors.length; i++) {
        minX = Math.min(anchors[i].coordinates[0], minX);
        maxX = Math.max(anchors[i].coordinates[0], maxX);
        minY = Math.min(anchors[i].coordinates[1], minY);
        maxY = Math.max(anchors[i].coordinates[1], maxY);
        path.lineTo.apply(path, lineUtil.locationsToVectorPosition(anchors[i].coordinates));
    }

    return {
        anchors: anchors,
        bounds: lineUtil.locationsToVectorPosition([minX, minY], [maxX, maxY]),
        path: lineUtil.pathToSvg(path, color)
    };
};

