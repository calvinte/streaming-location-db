'use strict';

var d3 = require('d3');
var geolib = require('geolib');
var _ = require('underscore');
var lineUtil = require('./_util');

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

function computeHandle(anchor, midpoint, maxDistance, direction, convex) {
    var deltaX, deltaY, mag, midX, midY, ret;

    if (convex) {
        maxDistance *= -1;
    }

    // Normalized/unit vector.
    deltaX = midpoint[0] - anchor[0];
    deltaY = midpoint[1] - anchor[1];
    mag = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    deltaX /= mag;
    deltaY /= mag;

    midX = (anchor[0] + midpoint[0]) / 2;
    midY = (anchor[1] + midpoint[1]) / 2;

    if (direction > 0) {
        ret = [
            midX + maxDistance * deltaY,
            midY - maxDistance * deltaX
        ];
    } else {
        ret = [
            midX - maxDistance * deltaY,
            midY + maxDistance * deltaX
        ];
    }

    return ret;
}

var tolerance = 0.001; // 110.57 meters
function douglasPeuckerBezier(points) {
    var returnPoints, line, distance, maxDistance, maxDistanceIndex, i, point, midpointTangent, endpointTangent, convex;

    if (points.length <= 2) {
        return [points[0]];
    }

    returnPoints = [];
    line = [points[0].coordinates, points[points.length - 1].coordinates];

    maxDistance = 0;
    maxDistanceIndex = 0;
    for (i = 0; i < points.length; i++) {
        point = points[i].coordinates;
        distance = distanceFromLineToPoint(line, point);

        if (distance > maxDistance) {
            // Determine point that is furthest from the line.
            maxDistance = distance;
            maxDistanceIndex = i;
        }
    }

    if (maxDistance > tolerance) {
        // Distance is beyond accepted tolerance, cut set in half and recurse.
        point = points[maxDistanceIndex].coordinates;
        returnPoints = returnPoints.concat(douglasPeuckerBezier(points.slice(0, maxDistanceIndex + 1)));
        returnPoints = returnPoints.concat(douglasPeuckerBezier(points.slice(maxDistanceIndex, points.length)));
    } else {
        // Distance is within accepted tolerance, detail beyond here will not
        // be persisted in the databse. Compute curve that closely matches the
        // points which will be removed. This curve is stored with the fs-SVG.
        point = points[maxDistanceIndex].coordinates;
        endpointTangent = Math.atan2(line[1][1] - line[0][1], line[1][0] - line[0][0]);
        midpointTangent = Math.atan2(point[1] - line[0][1], point[0] - line[0][0]);
        if (endpointTangent < 0) {
            if (midpointTangent < 0) {
                convex = endpointTangent + Math.PI < midpointTangent + Math.PI;
            } else {
                convex = endpointTangent + Math.PI < midpointTangent;
            }
        } else {
            convex = endpointTangent < midpointTangent;
        }

        returnPoints = [{
            point: points[points.length - 1],
            handle1: computeHandle(points[0].coordinates, point, maxDistance, 1, convex),
            handle2: computeHandle(points[points.length - 1].coordinates, point, maxDistance, -1, convex),
        }];
    }

    return returnPoints;
}


module.exports = function simplifyPath(locations, color) {
    var i, anchors, minX, maxX, minY, maxY, prevAnchor, path, point;

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

    anchors = douglasPeuckerBezier(locations);
    anchors.push(locations[locations.length - 1]);

    for (i = 0; i < anchors.length; i++) {
        point = anchors[i];
        if (point.handle1 && point.handle2) {
            minX = Math.min(point.point.coordinates[0], point.handle1[0], point.handle2[0], minX);
            maxX = Math.max(point.point.coordinates[0], point.handle1[0], point.handle2[0], maxX);
            minY = Math.min(point.point.coordinates[1], point.handle1[1], point.handle2[1], minY);
            maxY = Math.max(point.point.coordinates[1], point.handle1[1], point.handle2[1], maxY);

            path.bezierCurveTo.apply(path, lineUtil.locationsToVectorPosition(point.handle1, point.handle2, point.point.coordinates));
            anchors[i] = point.point;
        } else {
            minX = Math.min(point.coordinates[0], minX);
            maxX = Math.max(point.coordinates[0], maxX);
            minY = Math.min(point.coordinates[1], minY);
            maxY = Math.max(point.coordinates[1], maxY);
            path.lineTo.apply(path, lineUtil.locationsToVectorPosition(point.coordinates));
        }
    }

    return {
        anchors: anchors,
        bounds: lineUtil.locationsToVectorPosition([minX, minY], [maxX, maxY]),
        path: lineUtil.pathToSvg(path, color)
    };
};

