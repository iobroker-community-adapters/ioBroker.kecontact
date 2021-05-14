/* jshint -W097 */ // no "use strict" warnings
/* jshint -W061 */ // no "eval" warnings
/* jslint node: true */
"use strict";

// always required: utils
var utils = require('@iobroker/adapter-core');

// other dependencies:
var dgram = require('dgram');
var os = require('os');
const request = require('request');


// create the adapter object
var adapter = utils.Adapter('kecontact');

var DEFAULT_UDP_PORT = 7090;
var BROADCAST_UDP_PORT = 7092;

var txSocket;
var rxSocketReports;
var rxSocketBroadcast;
var sendDelayTimer = null;
var states = {};          // contains all actual state values
var stateChangeListeners = {};
var currentStateValues = {}; // contains all actual state values
var sendQueue = [];

//var ioBroker_Settings
var ioBrokerLanguage      = 'en';
const chargeTextAutomatic = {'en': 'PV automatic active', 'de': 'PV-optimierte Ladung'};
const chargeTextMax       = {'en': 'max. charging power', 'de': 'volle Ladeleistung'};

var isPassive            = true    // no automatic power regulation?
var lastDeviceData       = null;   // time of last check for device information
const intervalDeviceDataUpdate = 24 * 60 * 60 * 1000;  // check device data (e.g. firmware) every 24 hours => "report 1"
var lastChargingData = null;       // time of last check for charging information
const intervalChargingData = 10 * 60 * 1000;  // check charging information every 10 minutes
var forceChargingData    = false;  // when switching enableUser report is needed to acknowlegde switch
var timerForPower        = null;   // interval object for calculating timer
const intervalPowerUpdate = 30 * 1000;  // check current power (and calculate PV-automatics/power limitation every 30 seconds (report 3))
var loadChargingSessions = false;
var photovoltaicsActive  = false;  // is photovoltaics automatic active?
var maxPowerActive       = false;  // is limiter für maximum power active?
var wallboxIncluded      = true;   // amperage of wallbox include in energy meters 1, 2 or 3?
var amperageDelta        = 500;    // default for step of amperage
var underusage           = 0;      // maximum regard use to reach minimal charge power for vehicle
var minAmperage          = 6000;   // minimum amperage to start charging session
var minChargeSeconds     = 0;      // minimum of charge time even when surplus is not sufficient
var minRegardSeconds     = 0;      // maximum time to accept regard when charging
var voltage              = 230;    // calculate with european standard voltage of 230V
var pauseTime            = 0;      // time to wait until next PV automatics calculation
var lastFirmwareCheck    = null;
const firmwareUrl        = "https://www.keba.com/de/emobility/service-support/downloads/downloads";
const intervalFirmwareCheck = 24 * 60 * 60 * 1000;  // check firmware every 24 hours
const regexP30cSeries    = /<h3 class="headline tw-h3 ">(?:(?:\s|\n|\r)*?)Updates KeContact P30 a-\/b-\/c-\/e-series((?:.|\n|\r)*?)<H3/gi;
const regexP30xSeries    = /<h3 class="headline tw-h3 ">(?:(?:\s|\n|\r)*?)Updates KeContact P30 x-series((?:.|\n|\r)*?)<H3/gi;
const regexFirmware      = /<div class="mt-3">Firmware-Update\s+((?:.)*?)<\/div>/gi;
const regexCurrFirmware  = /P30 v\s+((?:.)*?)\s+\(/gi;

const stateWallboxEnabled      = "enableUser";                  /*Enable User*/
const stateWallboxCurrent      = "currentUser";                 /*Current User*/
const stateWallboxPhase1       = "i1";                          /*Current 1*/
const stateWallboxPhase2       = "i2";                          /*Current 2*/
const stateWallboxPhase3       = "i3";                          /*Current 3*/
const stateWallboxPlug         = "plug";                        /*Plug status */
const stateWallboxState        = "state";                       /*State of charging session */
const stateWallboxPower        = "p";                           /*Power*/
const stateWallboxChargeAmount = "ePres";                       /*ePres - amount of charged energy in Wh */
const stateWallboxDisplay      = "display";                    
const stateWallboxOutput       = "output";
const stateSetEnergy           = "setenergy";
const stateProduct             = "product";
const stateFirmware            = "firmware";                    /*current running version of firmware*/
const stateFirmwareAvailable   = "statistics.availableFirmware";/*current version of firmware available at keba.com*/
const stateSurplus             = "statistics.surplus";          /*current surplus for PV automatics*/
const stateMaxPower            = "statistics.maxPower";         /*maximum power for wallbox*/
const stateChargingPhases      = "statistics.chargingPhases";   /*number of phases with which vehicle is currently charging*/
const statePlugTimestamp       = "statistics.plugTimestamp";    /*Timestamp when vehicled was plugged to wallbox*/
const stateChargeTimestamp     = "statistics.chargeTimestamp";  /*Timestamp when charging (re)started */
const stateRegardTimestamp     = "statistics.regardTimestamp";  /*Timestamp when charging session was continued with regard */
const stateWallboxDisabled     = "automatic.pauseWallbox";      /*switch to generally disable charging of wallbox, e.g. because of night storage heater */
const statePvAutomatic         = "automatic.photovoltaics";     /*switch to charge vehicle in regard to surplus of photovoltaics (false= charge with max available power) */
const stateAddPower            = "automatic.addPower";          /*additional regard to run charging session*/
const stateLastChargeStart     = "statistics.lastChargeStart";  /*Timestamp when *last* charging session was started*/
const stateLastChargeFinish    = "statistics.lastChargeFinish"; /*Timestamp when *last* charging session was finished*/
const stateLastChargeAmount    = "statistics.lastChargeAmount"; /*Energy charging in *last* session in kWh*/

//unloading
adapter.on('unload', function (callback) {
    try {
        if (sendDelayTimer) {
            clearInterval(sendDelayTimer);
        }
        
        disablePowerTimer();
        
        if (txSocket) {
            txSocket.close();
        }
        
        if (rxSocketReports) {
            rxSocketReports.close();
        }
        
        if (rxSocketBroadcast) {
            rxSocketBroadcast.close();
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
    //adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
    // save state changes of foreign adapters - this is done even if value has not changed but acknowledged

    var oldValue = getStateInternal(id);
    var newValue = state.val;
    setStateInternal(id, newValue);
    
    // if vehicle is (un)plugged check if schedule has to be disabled/enabled
    if (id == adapter.namespace + '.' + stateWallboxPlug) {
        // call only if value has changed
        if (oldValue == false && newValue == true) {
            if (newValue == true)
                displayChargeMode();
            requestPowerReport;
        }
    }

    if (id == adapter.namespace + '.' + stateWallboxPower) {
        // calculation needs "p" from wallbox. Therefore always request "report 3" and checkWallboxPower when getting p value from UDP answer
        checkWallboxPower();
    }

    if (id == adapter.namespace + '.' + stateWallboxDisabled) {
        adapter.log.info('change pause status of wallbox from ' + oldValue + ' to ' + newValue);
        if (oldValue != newValue)
            requestReports();
    }

    if (id == adapter.namespace + '.' + statePvAutomatic) {
        adapter.log.info('change of photovoltaics automatic from ' + oldValue + ' to ' + newValue);
        if (oldValue != newValue) {
            displayChargeMode();
            requestReports();
        }
    }

    if (id == adapter.namespace + '.' + stateAddPower) {
		if (oldValue != newValue)
			adapter.log.info('change additional power from regard from ' + oldValue + ' to ' + newValue);
    }

    if (state.ack) {
        return;
    }
    
    if (!stateChangeListeners.hasOwnProperty(id)) {
        adapter.log.error('Unsupported state change: ' + id);
        return;
    }
    
    stateChangeListeners[id](oldValue, state.val);
    setStateAck(id, state.val)
});

// startup
adapter.on('ready', function () {
    if (! checkConfig()) {
    	adapter.log.error('start of adapter not possible due to config errors');
    	return;
    }
    if (loadChargingSessions) {
        //History Datenpunkte anlegen
        CreateHistory();
        // wait 5 seconds for History States creation
        setTimeout(main, 5000);
    } else {
        main();
    }
});

function main() {
    adapter.log.info("V7");
    txSocket = dgram.createSocket('udp4');
    
    rxSocketReports = dgram.createSocket('udp4');
    rxSocketReports.on('error', (err) => {
        adapter.log.error(`RxSocketReports Error:\n${err.stack}`);
        rxSocketReports.close();
      });
    rxSocketReports.on('listening', function () {
        var address = rxSocketReports.address();
        adapter.log.debug('UDP server listening on ' + address.address + ":" + address.port);
    });
    rxSocketReports.on('message', handleWallboxMessage);
    rxSocketReports.bind(DEFAULT_UDP_PORT);
    
    rxSocketBroadcast = dgram.createSocket('udp4');
    rxSocketBroadcast.on('error', (err) => {
        adapter.log.error(`RxSocketBroadcast Error:\n${err.stack}`);
        rxSocketBroadcast.close();
      });
    rxSocketBroadcast.on('listening', function () {
        rxSocketBroadcast.setBroadcast(true);
        rxSocketBroadcast.setMulticastLoopback(true);
        var address = rxSocketBroadcast.address();
        adapter.log.debug('UDP broadcast server listening on ' + address.address + ":" + address.port);
    });
    rxSocketBroadcast.on('message', handleWallboxBroadcast);
    rxSocketBroadcast.bind(BROADCAST_UDP_PORT);
    
    adapter.getForeignObject('system.config', function(err, ioBroker_Settings) {
    	if (err) {
    		adapter.log.error('Error while fetching system.config: ' + err);
    		return;
    	}

    	switch (ioBroker_Settings.common.language) {
    	case 'de':
    		ioBrokerLanguage = 'de';
    		break;
    	default:
    		ioBrokerLanguage = 'en';
    	}
    });
    
    adapter.getStatesOf(function (err, data) {
        for (var i = 0; i < data.length; i++) {
            if (data[i].native && data[i].native.udpKey) {
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
    		requestPowerReport();
    	});
        start();
    });
}

function start() {
    adapter.subscribeStates('*');
    
    stateChangeListeners[adapter.namespace + '.' + stateWallboxEnabled] = function (oldValue, newValue) {
        sendUdpDatagram('ena ' + (newValue ? 1 : 0), true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateWallboxCurrent] = function (oldValue, newValue) {
        //sendUdpDatagram('currtime ' + parseInt(newValue) + ' 1', true);
        sendUdpDatagram('curr ' + parseInt(newValue), true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateWallboxOutput] = function (oldValue, newValue) {
        sendUdpDatagram('output ' + (newValue ? 1 : 0), true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateWallboxDisplay] = function (oldValue, newValue) {
        sendUdpDatagram('display 0 0 0 0 ' + newValue.replace(/ /g, "$"), true);
    };
    stateChangeListeners[adapter.namespace + '.' + stateWallboxDisabled] = function (oldValue, newValue) {
        // no real action to do
    };
    stateChangeListeners[adapter.namespace + '.' + statePvAutomatic] = function (oldValue, newValue) {
        // no real action to do
    };
	stateChangeListeners[adapter.namespace + '.' + stateSetEnergy] = function (oldValue, newValue) {
        sendUdpDatagram('setenergy ' + parseInt(newValue * 10), true);
    };
	stateChangeListeners[adapter.namespace + '.' + stateAddPower] = function (oldValue, newValue) {
        // no real action to do
    };
    
    //sendUdpDatagram('i');   only needed for discovery
    requestReports();
}

// check if config data is fine for adapter start
function checkConfig() {
	var everythingFine = true;
    if (adapter.config.host == '0.0.0.0' || adapter.config.host == '127.0.0.1') {
        adapter.log.warn('Can\'t start adapter for invalid IP address: ' + adapter.config.host);
        everythingFine = false;
    }
    if (adapter.config.pollInterval >= intervalPowerUpdate) {
        intervalChargingData = getNumber(adapter.config.pollInterval);
    }
    if (adapter.config.loadChargingSessions == true) {
        loadChargingSessions = true;
    }
    if (adapter.config.passiveMode) {
    	isPassive = true;
    	adapter.log.info('starting charging station in passive mode');
    } else {
    	isPassive = false;
    	adapter.log.info('starting charging station in active mode');
    	if (adapter.config.stateRegard && adapter.config.stateRegard != "") {
    		photovoltaicsActive = true;
    		everythingFine = addForeignState(adapter.config.stateRegard) & everythingFine;
    	}
    	if (adapter.config.stateSurplus && adapter.config.stateSurplus != "") {
    		photovoltaicsActive = true;
    		everythingFine = addForeignState(adapter.config.stateSurplus) & everythingFine;
    	}
    	if (photovoltaicsActive) {
    		if (! adapter.config.delta || adapter.config.delta <= 50) {
    			adapter.log.info('amperage delta not speficied or too low, using default value of ' + amperageDelta);
    		} else {
    			amperageDelta = getNumber(adapter.config.delta);
    		}
    		if (! adapter.config.minAmperage || adapter.config.minAmperage < 6000) {
    			adapter.log.info('minimum amperage not speficied or too low, using default value of ' + minAmperage);
    		} else {
    			minAmperage = getNumber(adapter.config.minAmperage);
    		}
    		if (adapter.config.addPower !== 0) {
    			setStateAck(stateAddPower, getNumber(adapter.config.addPower));
    		}
    		if (adapter.config.underusage !== 0) {
    			underusage = getNumber(adapter.config.underusage);
    		}
    		if (! adapter.config.minTime || adapter.config.minTime < 0) {
    			adapter.log.info('minimum charge time not speficied or too low, using default value of ' + minChargeSeconds);
    		} else {
    			minChargeSeconds = getNumber(adapter.config.minTime);
    		}
    		if (! adapter.config.regardTime || adapter.config.regardTime < 0) {
    			adapter.log.info('minimum regard time not speficied or too low, using default value of ' + minRegardSeconds);
    		} else {
    			minRegardSeconds = getNumber(adapter.config.regardTime);
    		}
    	}
    	if (adapter.config.maxPower && (adapter.config.maxPower != 0)) {
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
    }
	return everythingFine;
}

// subscribe a foreign state to save values in "currentStateValues"
function addForeignState(id) {
    if (typeof id != "string")
    	return false;
    if (id == "" || id == " ")
    	return false;
	adapter.getForeignState(id, function (err, obj) {
		if (err) {
			adapter.log.error('error subscribing ' + id + ': ' + err);
		} else {
			if (obj) {
				adapter.log.debug('subscribe state ' + id + ' - current value: ' + obj.val);
				setStateInternal(id, obj.val);
				adapter.subscribeForeignStates(id); // there's no return value (success, ...)
				//adapter.subscribeForeignStates({id: id, change: "ne"}); // condition is not working
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
            adapter.log.debug('Received ' + message);
            return;
        }

        if (msg.startsWith('TCH-ERR')) {
            adapter.log.error('Error received from wallbox: ' + message);
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
        var msg = message.toString().trim();
        handleMessage(JSON.parse(msg));
    } catch (e) {
        adapter.log.warn('Error handling message: ' + e);
    }
}

// get minimum current for wallbox
function getMinCurrent() {
	return minAmperage;
}

// get maximum current for wallbox (hardware defined by dip switch)
function getMaxCurrent() {
	return getStateInternal("currentHardware"/*Maximum Current Hardware*/);
}

function switchWallbox(enabled) {
	if (enabled != getStateInternal(stateWallboxEnabled)) {
		adapter.log.debug("switched charging to " + (enabled ? "enabled" : "disabled"));
		if (enabled)
			displayChargeMode();
	}
	adapter.setState(stateWallboxEnabled, enabled);
	if (! enabled) {
		setStateAck(stateChargeTimestamp, null);
	}
}

function regulateWallbox(milliAmpere) {
	var oldValue = 0;
	if (getStateInternal(stateWallboxEnabled))
		oldValue = getStateInternal(stateWallboxCurrent);
	
	if (milliAmpere != oldValue) {
		adapter.log.debug("regulate wallbox from " + oldValue + " to " + milliAmpere + "mA");
        // block calculation for 5 seconds to give wallbox change to complete operation
        pauseTime = (new Date()).getTime() + 5000;  
        // change of currUser will be broadcasted automatically by wallbox, but only in "maxCurrent", therefore also "forceCharging" needed  
        //if ((milliAmpere == 0) || (oldValue == 0)) {
            // when wallbox is to be switched off or on,  force to get report 2 to update state enableUser
            forceChargingData = true;
            enablePowerTimer(3000); // re-request currect data after three seconds (otherwise it will come up only after up to 30 seconds)
        //}
	    sendUdpDatagram('currtime ' + milliAmpere + ' 1', true);
	}
	if (milliAmpere == 0) {
		setStateAck(stateChargeTimestamp, null);
	}
    //adapter.setState(stateWallboxCurrent, milliAmpere);
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
    var retVal = getStateDefault0(stateChargingPhases);

    // Number of phaes can only be calculated if vehicle is charging
    if (isVehicleCharging()) {
        var tempCount = 0;
        if (getStateDefault0(stateWallboxPhase1) > 250) {
        	tempCount ++;
        }
        if (getStateDefault0(stateWallboxPhase2) > 250) {
        	tempCount ++;
        }
        if (getStateDefault0(stateWallboxPhase3) > 250) {
        	tempCount ++;
        }
        if (tempCount > 0) {
            // save phase count and write info message if changed
        	if (retVal != tempCount)
        		adapter.log.info("wallbox is charging with " + tempCount + " phases");
        	setStateAck(stateChargingPhases, tempCount);
        	retVal = tempCount;
        } else {
        	adapter.log.warn("wallbox is charging but no phases where recognized");
        }
    }
    // if no phaes where detected then calculate with one phase
    if (retVal <= 0) {
        adapter.log.debug("Setting phase count to 1");
    	retVal = 1;
    }
    return retVal;
}

function isVehicleCharging() {
	return getStateInternal(stateWallboxPower) > 100000;
}

function displayChargeMode() {
	var text;
	if (getStateInternal(statePvAutomatic))
		text = chargeTextAutomatic[ioBrokerLanguage];
	else
		text = chargeTextMax[ioBrokerLanguage];
	adapter.setState(stateWallboxDisplay, text);
}

function getAmperage(power, phases) {
    var curr = Math.round(power / voltage * 1000 / amperageDelta / phases) * amperageDelta;
    adapter.log.debug("power: " + power + " / voltage: " + voltage + " * 1000 / delta: " + amperageDelta + " / phases: " + phases + " * delta = " + curr);
    return curr;
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
		if (! isPassive) {
			displayChargeMode();
		}
	} else if (! isVehiclePlugged && wasVehiclePlugged) {
		adapter.log.info('vehicle unplugged from wallbox');
		setStateAck(stateLastChargeStart, getStateInternal(statePlugTimestamp));
		setStateAck(stateLastChargeFinish, new Date());
		setStateAck(stateLastChargeAmount, getStateInternal(stateWallboxChargeAmount) / 1000);
		setStateAck(statePlugTimestamp, null);
		setStateAck(stateChargeTimestamp, null);
	} 
	if (isPassive)
		return;

    if (pauseTime > 0 && ((new Date()).getTime() < pauseTime)) {
        adapter.log.debug("wait a second because of last currTime command");
        enablePowerTimer(1000);   // wait 1 seconds to not proceed before pauseTime
    }
    forceChargingData = false;
    pauseTime = 0;
	
    var curr    = 0;      // in mA
    var tempMax = getMaxCurrent();
	var phases  = getChargingPhaseCount();
	var chargingToBeStarted = false;
	
    // "repair" state: VIS boolean control sets value to 0/1 instead of false/true
    if (typeof getStateInternal(statePvAutomatic) != "boolean") {
        setStateAck(statePvAutomatic, getStateInternal(statePvAutomatic) == 1);
    }

    // first of all check maximum power allowed
	if (maxPowerActive) {
		 // Always calculate with three phases for safety reasons
	    var maxPower = getTotalPowerAvailable();
	    setStateAck(stateMaxPower, Math.round(maxPower));
		adapter.log.debug('Available max power: ' + maxPower);
		var maxAmperage = getAmperage(maxPower, phases);
		if (maxAmperage < tempMax) {
			tempMax = maxAmperage;
		}
	}
	
	// lock wallbox if requested or available amperage below minimum
	if (getStateInternal(stateWallboxDisabled) || tempMax < getMinCurrent() ||
		(photovoltaicsActive && getStateInternal(statePvAutomatic) && ! isVehiclePlugged)) {
		curr = 0;
	} else {
		// if vehicle is currently charging and was not before, then save timestamp
		if (getStateInternal(stateChargeTimestamp) === null && isVehicleCharging()) {
			chargingToBeStarted = true;
		}
        if (isVehiclePlugged && photovoltaicsActive && getStateInternal(statePvAutomatic)) {
            var available = getSurplusWithoutWallbox();
            setStateAck(stateSurplus, Math.round(available));
        	adapter.log.debug('Available surplus: ' + available);
            curr = getAmperage(available, phases);
        	if (curr > tempMax) {
                curr = tempMax;
            }
            var addPower = getStateDefault0(stateAddPower);
            if (curr < getMinCurrent() && addPower > 0) {
            	// Reicht der Überschuss noch nicht, um zu laden, dann ggfs. zusätzlichen Netzbezug bis "addPower" zulassen
                adapter.log.debug("check with additional power of: " + addPower);
            	if (getAmperage(available + addPower, phases) >= getMinCurrent()) {
                    adapter.log.debug('Minimum amperage reached by addPower of ' + addPower);
            		curr = getMinCurrent();
            	}
            }
            if (curr < getMinCurrent()) {
                if (getStateInternal(stateChargeTimestamp) !== null) {
                    // if vehicle is currently charging or is allowed to do so then check limits for power off
                    if (addPower > 0) {
                        adapter.log.debug("check with additional power of: " + addPower + " and underUsage: " + underusage);
                        curr = getAmperage(available + addPower + underusage, phases);
                        if (curr >= getMinCurrent()) {
                            adapter.log.info("tolerated under-usage of charge power, continuing charging session");
                            curr = getMinCurrent();
                        }
                    }
                }
            }
            if (curr < getMinCurrent()) {
                var chargeDate = new Date(getStateInternal(stateChargeTimestamp));  // ensure that it is a correct date object
                if (chargeDate !== null) {
                    var aktDate = new Date();
                    if (minChargeSeconds > 0) {
                        if ((aktDate.getTime() - chargeDate.getTime()) / 1000 < minChargeSeconds) {
                            adapter.log.info("minimum charge time of " + minChargeSeconds + "sec not reached, continuing charging session");
                            curr = getMinCurrent();
                        }
                    }
                }
            }
            if (curr < getMinCurrent()) {
                if (minRegardSeconds > 0) {
                    var aktDate = new Date();
                    var regardDate = new Date(getStateInternal(stateRegardTimestamp));  // ensure that it is a correct date object
                    if (regardDate == null) {
                        setStateAck(stateRegardTimestamp, aktDate);
                        regardDate = aktDate;
                    }
                    if ((aktDate.getTime() - regardDate.getTime()) / 1000 < minRegardSeconds) {
                        adapter.log.info("minimum regard time of " + minRegardSeconds + "sec not reached, continuing charging session");
                        curr = getMinCurrent();
                    }
                }
            } else {
                setStateAck(stateRegardTimestamp, null);
            }
            if (curr >= getMinCurrent()) {
            	if (getStateInternal(stateWallboxCurrent) != curr || getStateInternal(stateWallboxEnabled) == false)
            		adapter.log.info("dynamic adaption of charging to " + curr + " mA");
            }
        } else {
            curr = tempMax;   // no automatic active or vehicle not plugged to wallbox? Charging with maximum power possible
        	if (getStateInternal(stateWallboxCurrent) != curr)
        		adapter.log.info("wallbox is running with maximum power of " + curr + " mA");
        }
	}
	
    if (curr < getMinCurrent()) {
    	adapter.log.debug("not enough power for charging ...");
        // deactivate wallbox and set max power to minimum for safety reasons
        //switchWallbox(false);
        //regulateWallbox(getMinCurrent());
    	if (getStateInternal(stateWallboxEnabled))
    		adapter.log.info("stop charging");
    	regulateWallbox(0);
        setStateAck(stateChargeTimestamp, null);
    } else {
    	if (chargingToBeStarted) {
    		adapter.log.info("vehicle (re)starts to charge");
    		setStateAck(stateChargeTimestamp, new Date());
    	}
        if (curr > tempMax) {
            curr = tempMax;
        }
        adapter.log.debug("wallbox set to charging maximum of " + curr + " mA");
        regulateWallbox(curr);
        //switchWallbox(true);
    }
}

function disablePowerTimer() {
	if (timerForPower) {
		clearInterval(timerForPower);
		timerForPower = null;
	}
}

function enablePowerTimer(time) {
	disablePowerTimer();
    if (! time)
        time = intervalPowerUpdate;
	timerForPower = setInterval(requestReports, time); 
}

function requestReports() {
    disablePowerTimer();
    requestDeviceDataReport();
    requestChargingDataReport();
    requestPowerReport();
}

function requestDeviceDataReport() {
    var newDate = new Date();
    if (lastDeviceData == null || newDate.getTime() - lastDeviceData.getTime() >= intervalDeviceDataUpdate) {
        sendUdpDatagram('report 1');
        loadChargingSessionsFromWallbox();
        lastDeviceData = newDate;
    }
}

function requestChargingDataReport() {
    var newDate = new Date();
    if (forceChargingData || lastChargingData == null || newDate.getTime() - lastChargingData.getTime() >= intervalChargingData) {
        sendUdpDatagram('report 2');
        lastChargingData = newDate;
    }
}

function requestPowerReport() {
    sendUdpDatagram('report 3');
    enablePowerTimer();
}

function loadChargingSessionsFromWallbox() {
    if (loadChargingSessions) {
        for (var i = 100; i <= 130; i++) {
            sendUdpDatagram('report ' + i);
        }
    }
}

function handleMessage(message) {
	// message auf ID Kennung für Session History prüfen
	if (message.ID >= 100 && message.ID <= 130) {
		adapter.log.debug('History ID received: ' + message.ID.substr(1));
		var sessionid = message.ID.substr(1);
		updateState(states[sessionid + '_json'], JSON.stringify([message]));
		for (var key in message){
			if (states[sessionid + '_' + key]) {
				try {
					updateState(states[sessionid + '_' + key], message[key]);
				} catch (e) {
					adapter.log.warn("Couldn't update state " + 'Session_' + sessionid + '.' + key + ": " + e);
				}
			} else if (key != 'ID'){
				adapter.log.debug('Unknown Session value received: ' + key + '=' + message[key]);
			}
		}
	} else {	
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
    checkFirmware();
}

function updateState(stateData, value) {
    if (stateData.common.type == 'number') {
        value = parseFloat(value);
        if (stateData.native.udpMultiplier) {
            value *= parseFloat(stateData.native.udpMultiplier);
			//Workaround for Javascript parseFloat round error for max. 2 digits after comma
			value = Math.round(value * 100) / 100;
			//
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

function getNumber(value) {
	if (value) {
        if (typeof value !== 'number') {
            value = parseFloat(value);
            if (value == NaN) {
                value = 0;
            } 
        }
        return value;
    }
	return 0;
}

function getStateDefault0(id) {
	return getNumber(getStateInternal(id));
}

function setStateInternal(id, value) {
	var obj = id;
	if (! obj.startsWith(adapter.namespace + '.'))
		obj = adapter.namespace + '.' + id;
	adapter.log.debug('update state ' + obj + ' with value:' + value);
    currentStateValues[obj] = value;
}

function setStateAck(id, value) {
	// State wird intern auch über "onStateChange" angepasst. Wenn es bereits hier gesetzt wird, klappt die Erkenung
	// von Wertänderungen nicht, weil der interne Wert bereits aktualisiert ist.
    //setStateInternal(id, value); 
    adapter.setState(id, {val: value, ack: true});
}

function checkFirmware() {
    var newDate = new Date();
    if (lastFirmwareCheck == null || (newDate.getTime() - lastFirmwareCheck.getTime() >= intervalFirmwareCheck)) {
        request.get(firmwareUrl, processFirmwarePage);
        lastFirmwareCheck = newDate;
    }
    return;
}

function processFirmwarePage(err, stat, body) {
    var prefix = "Keba firmware check: ";
    if (err) {
        adapter.log.warn(prefix + err);
    }
    else if (body) {
        var type = getStateInternal(stateProduct);
        var regexPattern;
        if (type.startsWith("KC-P30-E")) {
            regexPattern = regexP30cSeries;
        } else if (type.startsWith("KC-P30-X")) {
            regexPattern = regexP30xSeries;
        } else {
            adapter.log.error(prefix + "unknown wallbox type " + type);
            return;
        }
        var list;
        regexPattern.lastIndex = 0;
        if (list = regexPattern.exec(body)) {
            var block;
            regexFirmware.lastIndex = 0;
            if (block = regexFirmware.exec(list[1])) {
                setStateAck(stateFirmwareAvailable, block[1]);
                var currFirmware = getStateInternal(stateFirmware);
                var currFirmwareList;
                regexCurrFirmware.lastIndex = 0;
                if (currFirmwareList = regexCurrFirmware.exec(currFirmware)) {
                    currFirmwareList[1] = "V"+currFirmwareList[1];
                    if (block[1] == currFirmwareList[1]) {
                        adapter.log.info(prefix + "latest firmware installed");
                    } else {
                        adapter.log.warn(prefix + "current firmware " + currFirmwareList[1] + ", <a href='" + firmwareUrl + "'>new firmware " + block[1] + " available</a>");
                    }
                } else {
                    adapter.log.error(prefix + "current firmare unknown: " + currFirmware);
                }
            } else {
                adapter.log.warn(prefix + "no firmware found");
                adapter.log.debug(block);
            }
        } else {
            adapter.log.warn(prefix + "no section found");
            adapter.log.debug(body);
        }
    } else {
        adapter.log.warn(prefix + "empty page, status code " + stat.statusCode);
    }
    return true;
}

function CreateHistory() {
	// create Sessions Channel
	adapter.setObject('Sessions', 
			{
				type: 'channel',
				common: {
					name: 'Sessions Statistics'
					},
				native: {}
			});
// create Datapoints for 31 Sessions	
	for (var i = 0; i <= 30; i++){
	var session = ''
	if (i < 10) {
		session = '0'
	}
	
	adapter.setObject('Sessions.Session_' + session + i, 
			{
				type: 'channel',
				common: {
					name: 'Session_' +session + i + ' Statistics'
					},
				native: {}
			});
	
	adapter.setObject('Sessions.Session_' + session + i + '.json',
            {
                "type": "state",
                "common": {
                    "name":  "Raw json string from Wallbox",
                    "type":  "string",
                    "role":  "json",
                    "read":  true,
                    "write": false,
                    "desc":  "RAW_Json message",
                },
                "native": {
					"udpKey": session + i + "_json"
                }
            });
	
	adapter.setObject('Sessions.Session_' + session + i + '.sessionid',
            {
                "type": "state",
                "common": {
                    "name":  "SessionID of Charging Session",
                    "type":  "number",
                    "role":  "value",
                    "read":  true,
                    "write": false,
                    "desc":  "unique Session ID",
                },
                "native": {
					"udpKey": session + i + "_Session ID"
                }
            });
			
	adapter.setObject('Sessions.Session_' + session + i + '.currentHardware',
            {
                "type": "state",
                "common": {
                    "name":  "Maximum Current of Hardware",
                    "type":  "number",
                    "role":  "value",
                    "read":  true,
                    "write": false,
                    "desc":  "Maximum Current that can be supported by hardware",
					"unit":  "mA",
                },
                "native": {
					"udpKey": session + i + "_Curr HW"
                }
            });

	adapter.setObject('Sessions.Session_' + session + i + '.eStart',
            {
                "type": "state",
                "common": {
                    "name":  "Energy Counter Value at Start",
                    "type":  "number",
                    "role":  "value",
                    "read":  true,
                    "write": false,
                    "desc":  "Total Energy Consumption at beginning of Charging Session",
					"unit":  "Wh",
                },
                "native": {
					"udpKey": session + i + "_E start",
					"udpMultiplier": 0.1
                }
            });
			
	adapter.setObject('Sessions.Session_' + session + i + '.ePres',
            {
                "type": "state",
                "common": {
                    "name":  "Charged Energy in Current Session",
                    "type":  "number",
                    "role":  "value",
                    "read":  true,
                    "write": false,
                    "desc":  "Energy Transfered in Current Charging Session",
					"unit":  "Wh",
                },
                "native": {
					"udpKey": session + i + "_E pres",
					"udpMultiplier": 0.1
                }
            });
			
	adapter.setObject('Sessions.Session_' + session + i + '.started_s',
            {
                "type": "state",
                "common": {
                    "name":  "Time or Systemclock at Charging Start in Seconds",
                    "type":  "number",
                    "role":  "value",
                    "read":  true,
                    "write": false,
                    "desc":  "Systemclock since System Startup at Charging Start",
					"unit":  "s",
                },
                "native": {
					"udpKey": session + i + "_started[s]"
                }
            });
	
	adapter.setObject('Sessions.Session_' + session + i + '.ended_s',
            {
                "type": "state",
                "common": {
                    "name":  "Time or Systemclock at Charging End in Seconds",
                    "type":  "number",
                    "role":  "value",
                    "read":  true,
                    "write": false,
                    "desc":  "Systemclock since System Startup at Charging End",
					"unit":  "s",
                },
                "native": {
					"udpKey": session + i + "_ended[s]"
                }
            });
			
	adapter.setObject('Sessions.Session_' + session + i + '.started',
            {
                "type": "state",
                "common": {
                    "name":  "Time at Start of Charging",
                    "type":  "string",
                    "role":  "date",
                    "read":  true,
                    "write": false,
                    "desc":  "Time at Charging Session Start",
                },
                "native": {
					"udpKey": session + i + "_started"
                }
            });
	
	adapter.setObject('Sessions.Session_' + session + i + '.ended',
            {
                "type": "state",
                "common": {
                    "name":  "Time at End of Charging",
                    "type":  "string",
                    "role":  "date",
                    "read":  true,
                    "write": false,
                    "desc":  "Time at Charging Session End",
                },
                "native": {
					"udpKey": session + i + "_ended"
                }
            });
	
	adapter.setObject('Sessions.Session_' + session + i + '.reason',
            {
                "type": "state",
                "common": {
                    "name":  "Reason for End of Session",
                    "type":  "number",
                    "role":  "value",
                    "read":  true,
                    "write": false,
                    "desc":  "Reason for End of Charging Session",
                },
                "native": {
					"udpKey": session + i + "_reason"
                }
            });
	
	adapter.setObject('Sessions.Session_' + session + i + '.timeQ',
            {
                "type": "state",
                "common": {
                    "name":  "Time Sync Quality",
                    "type":  "string",
                    "role":  "text",
                    "read":  true,
                    "write": false,
                    "desc":  "Time Synchronisation Mode",
                },
                "native": {
					"udpKey": session + i + "_timeQ"
                }
            });
	
	adapter.setObject('Sessions.Session_' + session + i + '.rfid_tag',
            {
                "type": "state",
                "common": {
                    "name":  "RFID Tag of Card used to Start/Stop Session",
                    "type":  "string",
                    "role":  "text",
                    "read":  true,
                    "write": false,
                    "desc":  "RFID Token used for Charging Session",
                },
                "native": {
					"udpKey": session + i + "_RFID tag"
                }
            });
	
	adapter.setObject('Sessions.Session_' + session + i + '.rfid_class',
            {
                "type": "state",
                "common": {
                    "name":  "RFID Class of Card used to Start/Stop Session",
                    "type":  "string",
                    "role":  "text",
                    "read":  true,
                    "write": false,
                    "desc":  "RFID Class used for Session",
                },
                "native": {
					"udpKey": session + i + "_RFID class"
                }
            });
	
	adapter.setObject('Sessions.Session_' + session + i + '.serial',
            {
                "type": "state",
                "common": {
                    "name":  "Serialnumber of Device",
                    "type":  "string",
                    "role":  "text",
                    "read":  true,
                    "write": false,
                    "desc":  "Serial Number of Device",
                },
                "native": {
					"udpKey": session + i + "_Serial"
                }
            });
	
	adapter.setObject('Sessions.Session_' + session + i + '.sec',
            {
                "type": "state",
                "common": {
                    "name":  "Current State of Systemclock",
                    "type":  "number",
                    "role":  "value",
                    "read":  true,
                    "write": false,
                    "desc":  "Current State of System Clock since Startup of Device",
                },
                "native": {
					"udpKey": session + i + "_Sec"
                }
            });
	
	}
	
	
}