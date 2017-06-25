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

var DEFAULT_UDP_PORT = 7090;
var BROADCAST_UDP_PORT = 7092;

var txSocket;
var rxSocketReports;
var rxSocketBrodacast;
var pollTimer;
var states = {};
var stateChangeListeners = {};
var currentStateValues = {};

// unloading
adapter.on('unload', function (callback) {
    try {
        if (pollTimer) {
            clearInterval(pollTimer);
        }
        
        if (txSocket) {
            txSocket.close();
        }
        
        if (rxSocketReports) {
            rxSocketReports.close();
        }
        
        if (rxSocketBrodacast) {
            rxSocketBrodacast.close();
        }
    } catch (e) {
        adapter.log.warn('Error while closing: ' + e);
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
    if (adapter.config.host == '0.0.0.0' || adapter.config.host == '127.0.0.1') {
        adapter.log.warn('Can\'n start adapter for invalid IP address: ' + adapter.config.host);
        return;
    }
    
    txSocket = dgram.createSocket('udp4');
    
    rxSocketReports = dgram.createSocket('udp4');
    rxSocketReports.on('listening', function () {
        var address = rxSocketReports.address();
        adapter.log.debug('UDP server listening on ' + address.address + ":" + address.port);
    });
    rxSocketReports.on('message', function (message, remote) {
        adapter.log.debug('UDP datagram from ' + remote.address + ':' + remote.port + ': "' + message + '"');
        try {
            var msg = message.toString().trim();
            if (msg.length === 0) {
                return;
            }

            if (msg[0] == '"') {
                msg = '{ ' + msg + ' }';
            }

            handleMessage(JSON.parse(msg));
        } catch (e) {
            adapter.log.warn('Error handling message: ' + e);
        }
    });
    rxSocketReports.bind(DEFAULT_UDP_PORT, '0.0.0.0');
    
    rxSocketBrodacast = dgram.createSocket('udp4');
    rxSocketBrodacast.on('listening', function () {
        rxSocketBrodacast.setBroadcast(true);
        rxSocketBrodacast.setMulticastLoopback(true);
        var address = rxSocketBrodacast.address();
        adapter.log.debug('UDP broadcast server listening on ' + address.address + ":" + address.port);
    });
    rxSocketBrodacast.on('message', function (message, remote) {
        adapter.log.debug('UDP broadcast datagram from ' + remote.address + ':' + remote.port + ': "' + message + '"');
        try {
            restartPollTimer(); // reset the timer so we don't send requests too often
            requestReports();
        } catch (e) {
            adapter.log.warn('Error handling message: ' + e);
        }
    });
    rxSocketBrodacast.bind(BROADCAST_UDP_PORT, '0.0.0.0');
    
    adapter.getStatesOf(function (err, data) {
        
        for (var i = 0; i < data.length; i++) {
            if (data[i].native.udpKey) {
                states[data[i].native.udpKey] = data[i];
            }
        }

        start();
    });
}

function start() {
    adapter.subscribeStates('*');
    sendUdpDatagram('i');
    sendUdpDatagram('report 1');
    requestReports();
    restartPollTimer();
}

function requestReports() {
    sendUdpDatagram('report 2');
    sendUdpDatagram('report 3');
}

function restartPollTimer() {
    if (pollTimer) {
        clearInterval(pollTimer);
    }

    var pollInterval = parseInt(adapter.config.pollInterval);
    if (pollInterval > 0) {
        pollTimer = setInterval(requestReports, 1000 * Math.max(pollInterval, 5));
    }
}

function handleMessage(message) {
    for (var key in message) {
        if (states[key]) {
            try {
                updateState(states[key], message[key]);
            } catch (e) {
                adapter.log.warn("Couldn't update state " + key + ": " + e);
            }
        } else {
            adapter.log.debug('Unknown value received: ' + key + '=' + message[key]);
        }

    }
}

function updateState(stateData, value) {
    if (stateData.common.type == 'number') {
        value = parseFloat(value);
    }
    if (stateData.native.udpMultiplier) {
        value *= parseFloat(stateData.native.udpMultiplier);
    }
    setStateAck(stateData._id, value);
}

function sendUdpDatagram(message) {
    if (txSocket) {
        txSocket.send(message, 0, message.length, DEFAULT_UDP_PORT, adapter.config.host, function (err, bytes) {
            if (err) {
                adapter.log.warn('UDP send error for ' + adapter.config.host + ':' + DEFAULT_UDP_PORT + ': ' + err);
                return;
            }
            
            adapter.log.debug('Sent "' + message + '" to ' + adapter.config.host + ':' + DEFAULT_UDP_PORT);
        });
    }
}

function setStateAck(id, value) {
    currentStateValues[adapter.namespace + '.' + id] = value;
    adapter.setState(id, {val: value, ack: true});
}
