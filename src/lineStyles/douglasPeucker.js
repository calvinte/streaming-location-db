var d3 = require('d3');
var lineUtil = require('./_util');

// @see https://gist.github.com/adammiller/826148
var tolerance = 0.0001; // ~11.06 meters
module.exports = function simplifyPath(locations, color) {
    var i, anchors, minX, maxX, minY, maxY, prevAnchor;
    var points, point, path = d3.path();

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
    anchors.push(locations[locations.length - 1 ]);

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

var Vector = function (x, y) {
    this.x = x;
    this.y = y;

};
var Line = function (p1, p2) {
    this.p1 = p1;
    this.p2 = p2;

    this.distanceToPoint = function (point) {
        // slope
        var m = (this.p2[1] - this.p1[1]) / (this.p2[0] - this.p1[0]),
        // y offset
        b = this.p1[1] - (m * this.p1[0]),
        d = [];
        // distance to the linear equation
        d.push(Math.abs(point[1] - (m * point[0]) - b) / Math.sqrt(Math.pow(m, 2) + 1));
        // distance to p1
        d.push(Math.sqrt(Math.pow((point[0] - this.p1[0]), 2) + Math.pow((point[1] - this.p1[1]), 2)));
        // distance to p2
        d.push(Math.sqrt(Math.pow((point[0] - this.p2[0]), 2) + Math.pow((point[1] - this.p2[1]), 2)));
        // return the smallest distance
        return d.sort(function (a, b) {
            return (a - b); //causes an array to be sorted numerically and ascending
        })[0];
    };
};

function douglasPeucker(points) {
    if (points.length <= 2) {
        return [points[0]];
    }

    /*
    for (i = 0; i < locations.length; i++) {
    point = locations[i].coordinates;
    points[i] = point;
    path.lineTo.apply(path, lineUtil.locationsToVectorPosition(point));
    }
    */




    var returnPoints = [];
    // make line from start to end 
    var line = new Line(points[0].coordinates, points[points.length - 1].coordinates);

    // find the largest distance from intermediate poitns to this line
    var maxDistance = 0;
    var maxDistanceIndex = 0;
    var p;
    for (var i = 1; i <= points.length - 2; i++) {
        var point = points[i].coordinates;
        var distance = line.distanceToPoint(point);

        if (distance > maxDistance) {
            maxDistance = distance;
            maxDistanceIndex = i;
        }
    }

    // check if the max distance is greater than our tollerance allows 
    if (maxDistance >= tolerance) {
        p = points[maxDistanceIndex].coordinates;
        line.distanceToPoint(p, true);
        // include this point in the output 
        returnPoints = returnPoints.concat(douglasPeucker(points.slice(0, maxDistanceIndex + 1)));
        // returnPoints.push(points[maxDistanceIndex]);
        returnPoints = returnPoints.concat(douglasPeucker(points.slice(maxDistanceIndex, points.length)));
    } else {
        // ditching this point
        p = points[maxDistanceIndex].coordinates;
        line.distanceToPoint(p, true);
        returnPoints = [points[0]];
    }

    return returnPoints;
};


