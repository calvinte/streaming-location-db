'use strict';

// Key points along target path are recorded as locations.
exports.location = function (options) {
    this.accuracy = options.accuracy || exports.location.prototype.accuracy;
    this.heading = options.heading || exports.location.prototype.heading;
    this.coordinates = options.coordinates || exports.location.prototype.coordinates;
    this.speed = options.speed || exports.location.prototype.speed;
    this.time = options.time || exports.location.prototype.time;
};

exports.location.prototype = {
    'accuracy': null,
    'heading': null,
    'coordinates': null,
    'speed': null,
    'time': null,
};

// Locations are linked to files using pathref.
// Every 16s of streaming, a pathref will be written for a target.
// One svg file will have many pathrefs, each with many locations.
exports.pathref = function (options) {
    this.file = options.file || exports.pathref.prototype.file;
    this.locations = options.locations || exports.pathref.prototype.locations;
    this.target = options.target || exports.pathref.prototype.target;
    this.lineStyle = options.lineStyle || exports.pathref.prototype.lineStyle;
};

exports.pathref.prototype = {
    'filename': null,
    'locations': null,
    'target': null,
    'lineStyle': null,
};



