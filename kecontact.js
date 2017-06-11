/* jshint -W097 */ // no "use strict" warnings
/* jshint -W061 */ // no "eval" warnings
/* jslint node: true */
"use strict";

// always required: utils
var utils = require(__dirname + '/lib/utils');

// other dependencies:
var dgram = require('dgram');
var os = require('os');

// create the adapter object
var adapter = utils.adapter('kecontact');

var UDP_PORT = 7090;
var udpSocket;
var broadcastRxSockets = [];
var pollTimer;
var stateChangeListeners = {};
var currentStateValues = {};

// unloading
adapter.on('unload', function (callback) {
    if (pollTimer) {
        clearInterval(pollTimer);
    }

    if (udpSocket) {
        udpSocket.close();
    }

    for (var index in broadcastRxSockets) {
        broadcastRxSockets[index].close();
    }

    callback();
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning: state can be null if it was deleted!
    if (!id || !state || state.ack) {
        return;
    }
    
    adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
    if (!stateChangeListeners.hasOwnProperty(id)) {
        adapter.log.error('Unsupported state change: ' + id);
        return;
    }
    
    stateChangeListeners[id](currentStateValues[id], state.val);
});

// startup
adapter.on('ready', function () {
    main();
});

function main() {
    udpSocket = createUdpSocket('0.0.0.0', false, start);

    var netIfs = os.networkInterfaces();
    for (var name in netIfs) {
        var netIf = netIfs[name];
        for (var index in netIf) {
            if (netIf[index].family == 'IPv4') {
                broadcastRxSockets.push(createUdpSocket(netIf[index].address, true));
            }
        }
    }
}

function start() {
    adapter.subscribeStates('*');
    sendUdpDatagram('i');
    sendUdpDatagram('report 1');
    requestReports();
    var pollInterval = parseInt(adapter.config.pollInterval);
    if (pollInterval > 0) {
        pollTimer = setInterval(requestReports, 1000 * pollInterval);
    }
}

function requestReports() {
    sendUdpDatagram('report 2');
    sendUdpDatagram('report 3');
}

function handleMessage(message) {
}

function createUdpSocket(address, broadcast, callback) {
    var socket = dgram.createSocket('udp4');
    
    socket.on('listening', function () {
        var address = socket.address();
        adapter.log.debug('UDP Client listening on ' + address.address + ':' + address.port);
        if (broadcast) {
            socket.setBroadcast(true);
        }
        
        if (callback) {
            callback();
        }
    });
    
    socket.on('error', function (err) {
        adapter.log.warn('UDP socket error: ' + err);
        socket.close();
    });
    
    socket.on('message', function (message, remote) {
        adapter.log.debug('UDP datagram from ' + remote.address + ':' + remote.port + ': "' + message + '"');
        try {
            handleMessage(JSON.parse(message.toString()));
        } catch (e) {
            adapter.log.warn('Error handling message: ' + e);
        }
    });
    
    socket.bind(UDP_PORT, address);
    return socket;
}

function sendUdpDatagram(message) {
    if (udpSocket) {
        udpSocket.send(message, 0, message.length, UDP_PORT, adapter.config.host, function (err, bytes) {
            if (err) {
                throw err;
            }
            
            adapter.log.debug('Sent "' + message + '"');
        });
    }
}

function setStateAck(id, value) {
    currentStateValues[adapter.namespace + '.' + id] = value;
    adapter.setState(id, {val: value, ack: true});
}
