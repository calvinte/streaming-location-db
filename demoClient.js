var SocketHelper = require('socket-helper');
var Message = SocketHelper.Message;
var WebSocket = require('ws');
var workerCenterLocation = [-122.441642 + (0.025 * Math.random()), 37.754688 + (0.025 * Math.random())];
var i, targetIdLen = 24, targetCount = 500;
var targetIds = new Array(targetCount);
for (i = 0; i < targetCount; i++) {
    targetIds[i] = Array(targetIdLen+1).join((((i+1)/(targetCount*7)).toString(36)+'00000000000000000').slice(2, 18)).slice(0, targetIdLen)
}

var decameter = 0.0001;
var intervalLength = 25;
var client = new WebSocket('ws://localhost:3002');
var messageCount = -1;
client.on('open', function() {
    var startTime = Date.now();
    targetIds.forEach(function(targetId, i) {
        var radius = (i/targetCount) * decameter * 50 + decameter * 200;
        var distancePerSecond = (i/targetCount) * decameter / 2 + decameter;
        setInterval(function() {
            var radiusWiggly = radius + Math.random() * decameter / 10;
            var distance = (new Date().getTime() - startTime) / 1000 * distancePerSecond;
            var rad = distance / radiusWiggly * Math.PI;
            var message = new Message({
                location: {
                    time: new Date(),
                    coordinates: [workerCenterLocation[0] + Math.cos(rad) * radiusWiggly, workerCenterLocation[1] + Math.sin(rad) * radiusWiggly]
                },
                targetId: targetId
            }, '0000');

            ++messageCount;

            client.send(message.encode(true));

        }, intervalLength);
    });
});
setInterval(function() {
    console.log('sent ' + messageCount + ' locations');
}, 1000);

