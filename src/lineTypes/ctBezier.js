var d3 = require('d3');
var geolib = require('geolib');
var _ = require('underscore');

module.exports = function ctBezier(points) {
    var i, point = null, skippedPoints = null;

    var anchorRequired = false;
    var anchorTangent = null, pointTangent = null, deltaT = null, cumulativeDeltaT = 0;
    var sqPointDistance = null, cumulativeAnchorDistance = null, distanceMultiplier = null;
    var radianThreshold = null;

    var skippedPointsGroup = null ;

    var spliceIdx, spliceBiasCeil = true, handles = new Array(2);
    var minX, maxX, minY, maxY;

    var prevAnchor, prevPoint, anchors;
    var path = d3.path();
    var origPath = null;

    if (points.lastAnchor) {
        prevAnchor = points.lastAnchor.coordinates;
        anchors = [points.lastAnchor];
    } else {
        prevAnchor = points[0].coordinates;
        anchors = [points[0]];
    }

    path.moveTo.apply(path, locationsToVectorPosition(prevAnchor));

    if (drawOriginalPath) {
        origPath = d3.path();
        origPath.moveTo.apply(origPath, locationsToVectorPosition(prevAnchor));
    }

    minX = maxX = prevAnchor[0];
    minY = maxY = prevAnchor[1];
    prevPoint = prevAnchor;

    for (i = points.lastAnchor ? 0 : 1; i < points.length; i++) {
        point = points[i].coordinates;

        anchorRequired = i === points.length - 1; // Last point?
        anchorTangent = Math.atan2(point[1] - prevAnchor[1], point[0] - prevAnchor[0]);

        if (!anchorRequired) {
            sqPointDistance = getSqDist(point, prevPoint);
            cumulativeAnchorDistance += sqPointDistance;

            if (cumulativeAnchorDistance > sqDistanceEdges[0]) {
                pointTangent = Math.atan2(point[1] - prevPoint[1], point[0] - prevPoint[0]);
                deltaT = Math.abs(anchorTangent - pointTangent);
                cumulativeDeltaT += deltaT;

                distanceMultiplier = Math.max(cumulativeAnchorDistance - sqDistanceEdges[0], sqDistanceEdges[0]) / sqDistanceEdges[1];
                radianThreshold = radianEdges[0] + deltaRadianEdges * distanceMultiplier;

                if (Math.abs(cumulativeDeltaT) > radianThreshold) {
                    // Delta angle exceeds minimum, draw an anchor.
                    anchorRequired = true;
                }
            }
        }

        minX = Math.min(point[0], minX);
        maxX = Math.max(point[0], maxX);
        minY = Math.min(point[1], minY);
        maxY = Math.max(point[1], maxY);

        if (drawOriginalPath) {
            origPath.lineTo.apply(origPath, locationsToVectorPosition(point));
        }

        if (skippedPoints === null && anchorRequired) {
            // Draw new point, straight line
            anchors.push(points[i]);
            prevAnchor = point;

            path.lineTo.apply(path, locationsToVectorPosition(point));
        } else if (anchorRequired) {
            if (skippedPoints.length === 1) {
                // qudratic curve to makes nice curves, but they dont serve to
                // reduce file size..
                //path.quadraticCurveTo.apply(path, locationsToVectorPosition(skippedPoints[0], point));
                path.lineTo.apply(path, locationsToVectorPosition(skippedPoints[0]));
                path.lineTo.apply(path, locationsToVectorPosition(point));
            } else {
                if (spliceBiasCeil) {
                    spliceIdx = Math.ceil(skippedPoints.length / 2);
                    spliceBiasCeil = false;
                } else {
                    spliceIdx = Math.floor(skippedPoints.length / 2);
                    spliceBiasCeil = true;
                }

                handles[0] = computeHandle(skippedPoints.slice(0, spliceIdx), anchorTangent, prevAnchor, cumulativeAnchorDistance);
                handles[1] = computeHandle(skippedPoints.slice(spliceIdx, skippedPoints.length), anchorTangent, point, cumulativeAnchorDistance);

                path.bezierCurveTo.apply(path, locationsToVectorPosition(handles[0], handles[1], point));
            }

            // Draw new point, average skipped points as bezier
            anchors.push(points[i]);
            prevAnchor = point;

            skippedPoints = spliceIdx = handles[0] = handles[1] = null;
        } else if (skippedPoints === null) {
            // Too close; we have skipped one point.
            skippedPoints = [point];
        } else {
            // Too close; we have skipped many points.
            skippedPoints.push(point);
        }

        if (anchorRequired) {
            cumulativeDeltaT = 0;
            cumulativeAnchorDistance = 0;
        }

        prevPoint = point;
        point = anchorRequired = anchorTangent = pointTangent = deltaT = spliceIdx = spliceBiasCeil = null;
    }

    return {
        anchors: anchors,
        bounds: locationsToVectorPosition([minX, minY], [maxX, maxY]),
        origPath: drawOriginalPath ? '<path d="' + origPath.toString() + '" fill="none" stroke="red" stroke-width="0.00005" />' : null,
        path: '<path d="' + path.toString() + '" fill="none" stroke="black" stroke-width="0.00005" />'
    };
}

var svgDecimalPrecision = 5;
function locationsToVectorPosition() {
    var i, j, locations = Array(arguments.length * 2);

    for (i = j = 0; i < arguments.length; i++) {
        if (arguments[i].longitude && arguments[i].latitude) {
            locations[j++] = parseFloat(arguments[i].longitude).toFixed(svgDecimalPrecision);
            locations[j++] = parseFloat(arguments[i].latitude).toFixed(svgDecimalPrecision);
        } else if (typeof arguments[i][0] === 'number' && typeof arguments[i][1] === 'number') {
            locations[j++] = (arguments[i][0]).toFixed(svgDecimalPrecision);
            locations[j++] = (arguments[i][1]).toFixed(svgDecimalPrecision);
        } else {
            LocationMgrLogger('locationsToVectorPosition', 'err, unexpected input')
            locations[j++] = 0;
            locations[j++] = 0;
        }
    }

    return locations;
}

var radianEdges = [
    Math.PI,
    90 / 180 * Math.PI,
];
var deltaRadianEdges = radianEdges[0] - radianEdges[1];

var sqDistanceEdges = [
    Math.pow(0.0001, 2), // ~11.06 meters
    Math.pow(0.01, 2), // ~1105.74 meters
];

var drawOriginalPath = true;

function computeHandle(skippedPointsGroup, anchorTangent, anchor, cumulativeAnchorDistance) {
    var avgCenter, geoCenter;
    var centersTangent, centersDistance;
    var handleDistance = null;
    var bounds, boundsRatio;

    var avgCenter = geolibToJson(geolib.getCenter(skippedPointsGroup));
    var geoCenter = geolibToJson(geolib.getCenterOfBounds(skippedPointsGroup));

    skippedPointsGroup = _.map(skippedPointsGroup, function(point) {
        return rotate(anchor[0], anchor[1], point[0], point[1], anchorTangent);
    });

    bounds = geolib.getBounds(skippedPointsGroup);
    boundsRatio = (bounds.maxLng - bounds.minLng)/(bounds.maxLat - bounds.minLat);

    if (boundsRatio) {
        if (boundsRatio < 1) {
            boundsRatio = 1/boundsRatio;
        }

        centersDistance = getSqDist(avgCenter, geoCenter);
        centersTangent = 0.5 * (anchorTangent/2 + Math.atan2(anchor[1] - geoCenter[1], anchor[0] - geoCenter[0]));
        handleDistance = Math.sqrt(Math.min(centersDistance * boundsRatio, cumulativeAnchorDistance/2));
        return [
            avgCenter[0] + handleDistance * Math.sin(centersTangent),
            avgCenter[1] + handleDistance * Math.cos(centersTangent)
        ];
    } else {
        return avgCenter;
    }
}

function rotate(cx, cy, x, y, radians) {
    var cos = Math.cos(radians);
    var sin = Math.sin(radians);
    return [
        (cos * (x - cx)) + (sin * (y - cy)) + cx,
        (cos * (y - cy)) - (sin * (x - cx)) + cy
    ]
}

function geolibToJson(geolibObj) {
    return [geolibObj.longitude, geolibObj.latitude]
}

function getSqDist(p1, p2) {
    var dx = p1[0] - p2[0],
    dy = p1[1] - p2[1];

    return dx * dx + dy * dy;
};

