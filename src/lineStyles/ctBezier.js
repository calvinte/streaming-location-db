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

function computeHandle(skippedPointsGroup, anchorTangent, anchor) {
    var avgCenter, geoCenter, centersTangent, centersDistance, handleDistance, bounds, boundsRatio, ret;

    avgCenter = lineUtil.geolibToJson(geolib.getCenter(skippedPointsGroup));
    geoCenter = lineUtil.geolibToJson(geolib.getCenterOfBounds(skippedPointsGroup));

    skippedPointsGroup = _.map(skippedPointsGroup, function (point) {
        return lineUtil.rotate(anchor[0], anchor[1], point[0], point[1], anchorTangent);
    });

    centersDistance = lineUtil.getSqDist(avgCenter, geoCenter);
    if (centersDistance) {
        bounds = geolib.getBounds(skippedPointsGroup);
        boundsRatio = (bounds.maxLng - bounds.minLng) / (bounds.maxLat - bounds.minLat);
    }

    if (centersDistance && boundsRatio) {
        if (boundsRatio < 1) {
            boundsRatio = 1 / boundsRatio;
        }
        centersTangent = anchorTangent + (Math.atan2(avgCenter[1] - geoCenter[1], avgCenter[0] - geoCenter[0]));
        handleDistance = Math.sqrt(centersDistance * Math.log(boundsRatio));
        ret = [
            avgCenter[0] + handleDistance * Math.sin(centersTangent),
            avgCenter[1] + handleDistance * Math.cos(centersTangent)
        ];
    } else {
        ret = geoCenter;
    }
    return ret;
}

var tolerance = 0.001;
function douglasPeucker(points) {
    var returnPoints, line, distance, maxDistance, maxDistanceIndex, i, point, lastPoint, anchorTangent, halfIdx, sliceHalfBiasCeil = false;

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
        // This group of points will be clipped.
        lastPoint = points[0].coordinates;
        point = points[points.length - 1].coordinates;
        anchorTangent = Math.atan2(point[1] - lastPoint[1], point[0] - lastPoint[0]);
        if (sliceHalfBiasCeil) {
            halfIdx = Math.ceil(points.length / 2);
            sliceHalfBiasCeil = false;
        } else {
            halfIdx = Math.floor(points.length / 2);
            sliceHalfBiasCeil = true;
        }

        returnPoints = [{
            point: points[points.length - 1],
            handle1: computeHandle(_.pluck(points.slice(0, halfIdx), 'coordinates'), anchorTangent, lastPoint),
            handle2: computeHandle(_.pluck(points.slice(halfIdx, points.length), 'coordinates'), anchorTangent, point)
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

    anchors = douglasPeucker(locations);
    // always have to push the very last point on so it doesn't get left off
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

