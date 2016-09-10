'use strict';

var fs = require('fs');
var locationMgr = require('./location');
var fsLogger = require('./logger').Logger('fs');

exports.fsSetupStatusList = [
    'NEW',
    'SETUP',
    'DONE',
    'FAIL',
];

exports.svgDir = './.svg_db';
exports.setupSvgFs = function setupSvgFs(cb) {
    exports.svgDirStatus = exports.fsSetupStatusList[0];
    fs.access(exports.svgDir, fs.F_OK, function (err) {
        if (err) {
            exports.svgDirStatus = exports.fsSetupStatusList[1];
            fs.mkdir(exports.svgDir, function (err) {
                if (err) {
                    exports.svgDirStatus = exports.fsSetupStatusList[3];
                    fsLogger('mkdir', 'err');
                    cb(err);
                } else {
                    exports.svgDirStatus = exports.fsSetupStatusList[2];
                    fsLogger('mkdir', 'success');
                    cb(null);
                }
            });
        } else {
            exports.svgDirStatus = exports.fsSetupStatusList[2];
            fsLogger('access', 'success');
            cb(null);
        }
    });
};

exports.createActiveStream = function createActiveStream(file, fd, fileSize) {
    var writer = fs.createWriteStream(file, {fd: fd, start: Math.max(0, fileSize)});
    return writer;
}

function getTargetPath(targetId) {
    return exports.svgDir + '/' + targetId;
}

exports.activeStreamFilename = '_active.svg';
function getTargetActiveFilename(targetId, path) {
    if (!path) {
        path = getTargetPath(targetId);
    }

    return path + '/' + exports.activeStreamFilename;
}

exports.getTargetWriteStream = function getTargetWriteStream(targetId, cb) {
    var path, file;
    path = getTargetPath(targetId);
    file = getTargetActiveFilename(targetId, path);

    function getFile() {
        fs.open(file, 'w', function (err, fd) {
            if (err) {
                cb(err, null);
                return;
            }

            fs.fstat(fd, function (err, stats) {
                if (err) {
                    cb(err, null);
                    return;
                }

                cb(null, {
                    file: file,
                    fd: fd,
                    size: stats.size
                });
            });
        });
    }

    fs.access(path, fs.F_OK, function (err) {
        if (err) {
            fs.mkdir(path, function (err) {
                if (err) {
                    cb(err, null);
                } else {
                    getFile();
                }
            });
        } else {
            getFile();
        }
    });
};

exports.writeSegment = function writeSegment(path, segment, position, cb) {
    fs.open(path, 'r+', function (err, fd) {
        if (err) {
            fsLogger('archive', 'err');
            return;
        }

        fs.write(fd, segment, position, null, cb);
    });
};

exports.archiveSVG = function (activePath, targetId, cb) {
    var filename, filepath;
    filename = locationMgr.targetLastSeen[targetId].getTime() + '.svg';
    filepath = activePath.replace('/_active.svg', '/' + filename);

    fs.rename(activePath, filepath, cb);
    return filename;
};

