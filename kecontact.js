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
var adapter = utils.Adapter('kecontact');

var DEFAULT_UDP_PORT = 7090;
var BROADCAST_UDP_PORT = 7092;

var txSocket;
var rxSocketReports;
var rxSocketBrodacast;
var pollTimer;
var sendDelayTimer;
var states = {};          // contains all actual state values
var stateChangeListeners = {};
var currentStateValues = {}; // contains all actual state vaues
var sendQueue = [];

var phaseCount          = 0;      // Number of phaes vehicle is charging
var autoTimer           = null;   // interval object
var photovoltaicsActive = false;  // is photovoltaics automatic active?
var maxPowerActive      = false;  // is limiter für maximum power active?
var wallboxIncluded     = true;   // amperage of wallbox include in energy meters 1, 2 or 3?
var amperageDelta       = 500;    // default for step of amperage
var underusage          = 0;      // maximum regard use to reach minimal charge power for vehicle
var minChargeSeconds    = 0;      // minimum of charge time even when surplus is not sufficient
var voltage             = 230;    // calculate with european standard voltage of 230V

var stateWallboxEnabled      = "enableUser";                  /*Enable User*/
var stateWallboxCurrent      = "currentUser";                 /*Current User*/
var stateWallboxPhase1       = "i1";                          /*Current 1*/
var stateWallboxPhase2       = "i2";                          /*Current 2*/
var stateWallboxPhase3       = "i3";                          /*Current 3*/
var stateWallboxPlug         = "plug";                        /*Plug status */
var stateWallboxState        = "state";                       /*State of charging session */
var stateWallboxPower        = "p";                           /*Power*/
var stateWallboxChargeAmount = "ePres";                       /*ePres - amount of charged energy in Wh */
var statePlugTimestamp       = "statistics.plugTimestamp";    /*Timestamp when vehicled was plugged to wallbox*/
var stateChargeTimestamp     = "statistics.chargeTimestamp";  /*Timestamp when charging (re)started */
var stateWallboxDisabled     = "automatic.pauseWallbox";      /*switch to generally disable charging of wallbox, e.g. because of night storage heater */
var statePvAutomatic         = "automatic.photovoltaics";     /*switch to charge vehicle in regard to surplus of photovoltaics (false= charge with max available power) */
var stateLastChargeStart     = "statistics.lastChargeStart";  /*Timestamp when *last* charging session was started*/
var stateLastChargeFinish    = "statistics.lastChargeFinish"; /*Timestamp when *last* charging session was finished*/
var stateLastChargeAmount    = "statistics.lastChargeAmount"; /*Energy charging in *last* session in kWh*/

//unloading
adapter.on('unload', function (callback) {
    try {
        if (pollTimer) {
            clearInterval(pollTimer);
        }
        
        if (sendDelayTimer) {
            clearInterval(sendDelayTimer);
        }
        
        disableTimer();
        
        if (txSocket) {
            txSocket.close();
        }
        
        if (rxSocketReports) {
            rxSocketReports.close();
        }
        
        if (rxSocketBrodacast) {
            rxSocketBrodacast.close();
        }
        
        if (adapter.config.stateRegard)
        	adapter.unsubscribeForeignStates(adapter.config.stateRegard);
        if (adapter.config.stateSurplus)
        	adapter.unsubscribeForeignStates(adapter.config.stateSurplus);
        if (adapter.config.energyMeter1)
        	adapter.unsubscribeForeignStates(adapter.config.energyMeter1);
        if (adapter.config.energyMeter2)
        	adapter.unsubscribeForeignStates(adapter.config.energyMeter2);
        if (adapter.config.energyMeter3)
        	adapter.unsubscribeForeignStates(adapter.config.energyMeter3);

    } catch (e) {
    	if (adapter.log)   // got an exception "TypeError: Cannot read property 'warn' of undefined"
    		adapter.log.warn('Error while closing: ' + e);
    }

    callback();
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning: state can be null if it was deleted!
    if (!id || !state) {
    	return;
    }
    adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
    // save state changes of foreign adapters - this is done even if value has not changed but acknowledged
    if (id.startsWith(adapter.namespace + '.')) {
    	// if vehicle is (un)plugged check if schedule has to be disabled/enabled
    	if (id == adapter.namespace + '.' + stateWallboxPlug) {
    		adapter.log.info('Call wegen id = '  + id);
    		checkWallboxPower();
    	}
    } else {
		setStateInternal(id, state.val);
    } 
    
    if (state.ack) {
        return;
    }
    
    if (!stateChangeListeners.hasOwnProperty(id)) {
        adapter.log.error('Unsupported state change: ' + id);
        return;
    }
    
    stateChangeListeners[id](getStateInternal(id), state.val);
});

// startup
adapter.on('ready', function () {
    main();
});

function main() {
    if (! checkConfig()) {
    	adapter.log.error('start of adapter not possible due to config errors');
    	return;
    }
    
    txSocket = dgram.createSocket('udp4');
    
    rxSocketReports = dgram.createSocket('udp4');
    rxSocketReports.on('listening', function () {
        var address = rxSocketReports.address();
        adapter.log.debug('UDP server listening on ' + address.address + ":" + address.port);
    });
    rxSocketReports.on('message', handleWallboxMessage);
    rxSocketReports.bind(DEFAULT_UDP_PORT, '0.0.0.0');
    
    rxSocketBrodacast = dgram.createSocket('udp4');
    rxSocketBrodacast.on('listening', function () {
        rxSocketBrodacast.setBroadcast(true);
        rxSocketBrodacast.setMulticastLoopback(true);
        var address = rxSocketBrodacast.address();
        adapter.log.debug('UDP broadcast server listening on ' + address.address + ":" + address.port);
    });
    rxSocketBrodacast.on('message', handleWallboxBroadcast);
    rxSocketBrodacast.bind(BROADCAST_UDP_PORT, '0.0.0.0');
    
    adapter.getStatesOf(function (err, data) {
        for (var i = 0; i < data.length; i++) {
            if (data[i].native.udpKey) {
                states[data[i].native.udpKey] = data[i];
            }
        }
        // save all state value into internal store 
    	adapter.getStates('*', function (err, obj) {
    		if (err) {
    			adapter.log.error('error reading states: ' + err);
    		} else {
    			if (obj) {
    				for (var i in obj) {
    					if (! obj.hasOwnProperty(i)) continue;
    					if (obj[i] !== null) {
    						if (typeof obj[i] == 'object') {
    							setStateInternal(i, obj[i].val);
    						} else {
    							adapter.log.error('unexpected state value: ' + obj[i]);
    						}
    					}
    		        }
    			} else {
    				adapter.log.error("not states found");
    			}
    		}
    		adapter.log.info('initialer call');
    		checkWallboxPower();
    	});
        start();
    });
}

function start() {
    adapter.subscribeStates('*');
    
    stateChangeListeners[adapter.namespace + '.enableUser'] = function (oldValue, newValue) {
        sendUdpDatagram('ena ' + (newValue ? 1 : 0), true);
    };
    stateChangeListeners[adapter.namespace + '.currentUser'] = function (oldValue, newValue) {
        sendUdpDatagram('curr ' + parseInt(newValue), true);
    };
    stateChangeListeners[adapter.namespace + '.output'] = function (oldValue, newValue) {
        sendUdpDatagram('output ' + (newValue ? 1 : 0), true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateWallboxDisabled] = function (oldValue, newValue) {
        adapter.log.info('change pause status of wallbox from ' + oldValue + ' to ' + newValue);
      	checkWallboxPower();
    };
    stateChangeListeners[adapter.namespace + '.' + statePvAutomatic] = function (oldValue, newValue) {
        adapter.log.info('change of photovoltaics automatic from ' + oldValue + ' to ' + newValue);
       	checkWallboxPower();
    };

    sendUdpDatagram('i');
    sendUdpDatagram('report 1');
    requestReports();
    restartPollTimer();
}

// check if config data is fine for adapter start
function checkConfig() {
	var everythingFine = true;
    if (adapter.config.host == '0.0.0.0' || adapter.config.host == '127.0.0.1') {
        adapter.log.warn('Can\'t start adapter for invalid IP address: ' + adapter.config.host);
        everythingFine = false;
    }
    if (adapter.config.stateRegard) {
    	photovoltaicsActive = true;
    	everythingFine = addForeignState(adapter.config.stateRegard) & everythingFine;
    }
    if (adapter.config.stateSurplus) {
    	photovoltaicsActive = true;
    	everythingFine = addForeignState(adapter.config.stateSurplus) & everythingFine;
    }
    if (photovoltaicsActive) {
    	if (! adapter.config.delta || adapter.config.delta <= 50) {
    		adapter.log.info('amperage delta not speficied or too low, using default value of ' + amperageDelta);
    	} else {
    		amperageDelta = adapter.config.delta;
    	}
    	if (adapter.config.underusage !== 0) {
    		underusage = adapter.config.underusage;
    	}
    	if (! adapter.config.minTime || adapter.config.minTime <= 0) {
    		adapter.log.info('minimum charge time not speficied or too low, using default value of ' + minChargeSeconds);
    	} else {
    		minChargeSeconds = adapter.config.minTime;
    	}
    }
    if (adapter.config.maxPower) {
    	maxPowerActive = true;
    	if (adapter.config.maxPower <= 0) {
    		adapter.log.warn('max. power negative or zero - power limitation deactivated');
    		maxPowerActive = false;
    	}
    }
    if (maxPowerActive) {
        if (adapter.config.stateEnergyMeter1) {
        	everythingFine = addForeignState(adapter.config.stateEnergyMeter1) & everythingFine;
        }
        if (adapter.config.stateEnergyMeter2) {
        	everythingFine = addForeignState(adapter.config.stateEnergyMeter2) & everythingFine;
        }
        if (adapter.config.stateEnergyMeter3) {
        	everythingFine = addForeignState(adapter.config.stateEnergyMeter3) & everythingFine;
        }
        if (adapter.config.wallboxNotIncluded) {
        	wallboxIncluded = false;
        } else {
        	wallboxIncluded = true;
        }
        if (everythingFine) {
        	if (! (adapter.config.stateEnergyMeter1 || adapter.config.stateEnergyMeter2 || adapter.config.stateEnergyMeter1)) {
        		adapter.log.error('no energy meters defined - power limitation deactivated');
        		maxPowerActive = false;
        	}
        }
    }
	return everythingFine;
}

// subscribe a foreign state to save vaues in "currentStateValues"
function addForeignState(id) {
	adapter.getForeignState(id, function (err, obj) {
		if (err) {
			adapter.log.error('error subscribing ' + id + ': ' + err);
		} else {
			if (obj) {
				adapter.log.debug('subscribe state ' + id + ' - current value: ' + obj.val);
				setStateInternal(id, obj.val);
				adapter.subscribeForeignStates(id); // there's no return value (success, ...)
				adapter.subscribeForeignStates({id: id, change: "ne"}); // condition is not working
			}
			else {
				adapter.log.error('state ' + id + ' not found!');
			}
		}
	});
    return true;
}

// handle incomming message from wallbox
function handleWallboxMessage(message, remote) {
    adapter.log.debug('UDP datagram from ' + remote.address + ':' + remote.port + ': "' + message + '"');
    try {
        var msg = message.toString().trim();
        if (msg.length === 0) {
            return;
        }
        
        if (msg.startsWith('TCH-OK')) {
            //adapter.log.info('Received ' + message);
            restartPollTimer(); // reset the timer so we don't send requests too often
            requestReports();
            return;
        }

        if (msg[0] == '"') {
            msg = '{ ' + msg + ' }';
        }

        handleMessage(JSON.parse(msg));
    } catch (e) {
        adapter.log.warn('Error handling message: ' + e);
    }
}

// handle incomming broadcast message from wallbox
function handleWallboxBroadcast(message, remote) {
    adapter.log.debug('UDP broadcast datagram from ' + remote.address + ':' + remote.port + ': "' + message + '"');
    try {
        restartPollTimer(); // reset the timer so we don't send requests too often
        requestReports();
        
        var msg = message.toString().trim();
        handleMessage(JSON.parse(msg));
    } catch (e) {
        adapter.log.warn('Error handling message: ' + e);
    }
}

// get minimum current for wallbox
function getMinCurrent() {
	return 6000;
}

// get maximum current for wallbox (hardware defined by dip switch)
function getMaxCurrent() {
	return getStateInternal("currentHardware"/*Maximum Current Hardware*/);
}

function switchWallbox(enabled) {
	if (enabled != getStateInternal(stateWallboxEnabled)) {
		adapter.log.debug("switched charging to " + (enabled ? "enabled" : "disabled"));
	}
	adapter.setState(stateWallboxEnabled, enabled);
	if (! enabled) {
		setStateAck(stateChargeTimestamp, null);
	}
}

function regulateWallbox(milliAmpere) {
	if (milliAmpere != getStateInternal(stateWallboxCurrent)) {
		adapter.log.debug("regulate wallbox to " + milliAmpere + "mA");
	}
    adapter.setState(stateWallboxCurrent, milliAmpere);
}

function getSurplusWithoutWallbox() {
	return getStateDefault0(adapter.config.stateSurplus) 
	     - getStateDefault0(adapter.config.stateRegard)
	     + (getStateDefault0(stateWallboxPower) / 1000);
}

function getTotalPower() {
    var result = getStateDefault0(adapter.config.stateEnergyMeter1)
               + getStateDefault0(adapter.config.stateEnergyMeter2)
               + getStateDefault0(adapter.config.stateEnergyMeter3);
    if (wallboxIncluded) {
        result -= (getStateDefault0(stateWallboxPower) / 1000);
    }
    return result;
}

function getTotalPowerAvailable() {
    // Wenn keine Leistungsbegrenzung eingestelt ist, dann max. liefern
    if (maxPowerActive && (adapter.config.maxPower > 0)) {
        return adapter.config.maxPower - getTotalPower();
    }
    return 999999;  // return default maximum
}

function getChargingPhaseCount() {
    var retVal = phaseCount;

    // Number of phaes can only be calculated if vehicle is charging
    if (isVehicleCharging()) {
        var tempCount = 0;
        if (getStateInternal(stateWallboxPhase1).val > 100) {
        	tempCount ++;
        }
        if (getStateInternal(stateWallboxPhase2).val > 100) {
        	tempCount ++;
        }
        if (getStateInternal(stateWallboxPhase3).val > 100) {
        	tempCount ++;
        }
        if (tempCount > 0) {
            // save phase count and write info message if changed
        	if (phaseCount != tempCount)
        		adapter.log.info("wallbox is charging with " + tempCount + " phases");
        	phaseCount = tempCount;
        	retVal     = tempCount;
        } else {
        	adapter.log.warn("wallbox is charging but no phases where recognized");
        }
    }
    // if no phaes where detected then calculate with one phase
    if (retVal <= 0) {
    	retVal = 1;
    }
    return retVal;
}

function isVehicleCharging() {
	return getStateInternal(stateWallboxPower) > 100000;
}

function checkWallboxPower() {
    // 0 unplugged
    // 1 plugged on charging station 
    // 3 plugged on charging station plug locked
    // 5 plugged on charging station             plugged on EV
    // 7 plugged on charging station plug locked plugged on EV
    // For wallboxes with fixed cable values of 0 and 1 not used
	// Charging only possible with value of 7

	var wasVehiclePlugged = ! (getStateInternal(statePlugTimestamp) === null || getStateInternal(statePlugTimestamp) === undefined);
	var isVehiclePlugged  = getStateInternal(stateWallboxPlug) >= 5;
	if (isVehiclePlugged && ! wasVehiclePlugged) {
		adapter.log.info('vehicle plugged to wallbox');
		setStateAck(statePlugTimestamp, new Date());
		setStateAck(stateChargeTimestamp, null);
	} else if (! isVehiclePlugged && wasVehiclePlugged) {
		adapter.log.info('vehicle unplugged from wallbox');
		setStateAck(stateLastChargeStart, getStateInternal(statePlugTimestamp));
		setStateAck(stateLastChargeFinish, new Date());
		setStateAck(stateLastChargeAmount, getStateInternal(stateWallboxChargeAmount) / 1000);
		setStateAck(statePlugTimestamp, null);
		setStateAck(stateChargeTimestamp, null);
	} 
	
    var curr    = 0;      // in mA
    var tempMax = getMaxCurrent();
	var phases  = getChargingPhaseCount();
	
    // "repair" state: VIS boolean control sets value to 0/1 instead of false/true
    if (typeof getStateInternal(statePvAutomatic) != "boolean") {
        setStateAck(statePvAutomatic, getStateInternal(statePvAutomatic) == 1);
    }

	adapter.log.debug('Available surplus: ' + getSurplusWithoutWallbox());
	adapter.log.debug('Available max power: ' + getTotalPowerAvailable());
	
    // first of all check maximum power allowed
	if (maxPowerActive) {
		 // Always calculate with three phases for safety reasons
		var maxAmperage = Math.round(getTotalPowerAvailable() / voltage / 3 * 1000 / amperageDelta) * amperageDelta;
		if (maxAmperage < tempMax) {
			tempMax = maxAmperage;
		}
	}
	
	// lock wallbox if requested or available amperage below minimum
	if (getStateInternal(stateWallboxDisabled) || tempMax < getMinCurrent()) {
		curr = 0;
	} else {
		// if vehicle is currently charging and was not the check before, then save timestamp
		if (getStateInternal(stateChargeTimestamp) === null && isVehicleCharging()) {
			adapter.log.info("vehicle starts/continues to charge");
			setStateAck(stateChargeTimestamp, new Date());
		}
        if (isVehiclePlugged && photovoltaicsActive && getStateInternal(statePvAutomatic)) {
            var available = getSurplusWithoutWallbox();
            curr = Math.round(available / voltage * 1000 / amperageDelta / phases) * amperageDelta;
            if (curr < getMinCurrent()) {
                if (getStateInternal(stateChargeTimestamp) !== null) {
                    // if vehicle is actually charging or is allowed to do so then check limits for power off
                    curr = Math.round((available + underusage) / voltage * 1000 / amperageDelta / phases) * amperageDelta;
                    if (curr >= getMinCurrent()) {
                        adapter.log.info("tolerated under-usage of charge power, continuing charging session");
                        curr = getMinCurrent();
                    } else {
                        if (minChargeSeconds > 0) {
                            if ((new Date().getTime() - getStateInternal(stateChargeTimestamp).getTime()) / 1000 < minChargeSeconds) {
                            	adapter.log.info("minimum charge time not reached, continuing charging session");
                                curr = getMinCurrent();
                            }
                        }
                    }
                }
            } else {
            	adapter.log.info("dynamic adaption of charging to " + curr + " mA");
            }
        } else {
            curr = tempMax;   // no automatic active or vehicle not plugged to wallbox? Charging with maximum power possible
            adapter.log.info("wallbox is running with maximum power of " + curr + " mA");
        }
	}
	
    if (curr < getMinCurrent()) {
        // deactivate wallbox and set max power to minimum for safety reasons
        switchWallbox(false);
        regulateWallbox(getMinCurrent());
    } else {
        if (curr > tempMax) {
            curr = tempMax;
        }
        adapter.log.debug("wallbox set to charging maximum of " + curr + " mA");
        regulateWallbox(curr);
        switchWallbox(true);
    }
	
	
	if (isVehiclePlugged || maxPowerActive)
		checkTimer();
	else
		disableTimer();
}

function disableTimer() {
	if (autoTimer) {
		clearInterval(autoTimer);
	}
}

function checkTimer() {
	disableTimer();
	adapter.log.info('call über timer');
	autoTimer = setInterval(checkWallboxPower, 30 * 1000); 
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
        } else if (key != 'ID') {
            adapter.log.debug('Unknown value received: ' + key + '=' + message[key]);
        }

    }
}

function updateState(stateData, value) {
    if (stateData.common.type == 'number') {
        value = parseFloat(value);
        if (stateData.native.udpMultiplier) {
            value *= parseFloat(stateData.native.udpMultiplier);
        }
    } else if (stateData.common.type == 'boolean') {
        value = parseInt(value) !== 0;
    }
    setStateAck(stateData._id, value);
}

function sendUdpDatagram(message, highPriority) {
    if (highPriority) {
        sendQueue.unshift(message);
    } else {
        sendQueue.push(message);
    }
    if (!sendDelayTimer) {
        sendNextQueueDatagram();
        sendDelayTimer = setInterval(sendNextQueueDatagram, 300);
    }
}

function sendNextQueueDatagram() {
    if (sendQueue.length === 0) {
        clearInterval(sendDelayTimer);
        sendDelayTimer = null;
        return;
    }
    var message = sendQueue.shift();
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

function getStateInternal(id) {
	var obj = id;
	if (! obj.startsWith(adapter.namespace + '.'))
		obj = adapter.namespace + '.' + id;
	return currentStateValues[obj];
}

function getStateDefault0(id) {
	var value = getStateInternal(id);
	if (value)
		return value;
	return 0;
}

function setStateInternal(id, value) {
	var obj = id;
	if (! obj.startsWith(adapter.namespace + '.'))
		obj = adapter.namespace + '.' + id;
	adapter.log.debug('update state ' + obj + ' with value:' + value);
    currentStateValues[obj] = value;
}

function setStateAck(id, value) {
    setStateInternal(id, value);
    adapter.setState(id, {val: value, ack: true});
}
