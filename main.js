"use strict";

/*
 * Created with @iobroker/create-adapter v1.33.0
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require("@iobroker/adapter-core");

// Load your modules here, e.g.:
const dgram = require("dgram");
const { reverse } = require("dns");
const request = require("request");

/**
 * The adapter instance
 * @type {ioBroker.Adapter}
 */
let adapter;

const DEFAULT_UDP_PORT = 7090;
const BROADCAST_UDP_PORT = 7092;

let txSocket;
let rxSocketReports = null;
let rxSocketBroadcast = null;
let sendDelayTimer = null;
const states = {};          // contains all actual state values
const stateChangeListeners = {};
const currentStateValues = {}; // contains all actual state values
const sendQueue = [];
const MODEL_P20 = 1;        // product ID is like KC-P20-ES240030-000-ST
const MODEL_P30 = 2;
const MODEL_BMW = 3;        // product ID is like BMW-10-EC2405B2-E1R
const TYPE_A_SERIES = 1;
const TYPE_B_SERIES = 2;
const TYPE_C_SERIES = 3;     // product ID for P30 is like KC-P30-EC240422-E00
const TYPE_E_SERIES = 4;     // product ID for P30 is like KC-P30-EC240422-E00
const TYPE_X_SERIES = 5;
const TYPE_D_EDITION = 6;    // product id (only P30) is KC-P30-EC220112-000-DE, there's no other


//var ioBroker_Settings
let ioBrokerLanguage      = "en";
const chargeTextAutomatic = {"en": "PV automatic active", "de": "PV-optimierte Ladung"};
const chargeTextMax       = {"en": "max. charging power", "de": "volle Ladeleistung"};

let wallboxWarningSent   = false;  // Warning for inacurate regulation with Deutshcland Edition
let wallboxUnknownSent   = false;  // Warning wallbox not recognized
let isPassive            = true;   // no automatic power regulation?
let lastDeviceData       = null;   // time of last check for device information
const intervalDeviceDataUpdate = 24 * 60 * 60 * 1000;  // check device data (e.g. firmware) every 24 hours => "report 1"
let intervalPassiveUpdate = 10 * 60 * 1000;  // check charging information every 10 minutes
let timerDataUpdate      = null;   // interval object for calculating timer
const intervalActiceUpdate = 15 * 1000;  // check current power (and calculate PV-automatics/power limitation every 15 seconds (report 2+3))
let lastCalculating      = null;   // time of last check for charging information
const intervalCalculating = 25 * 1000;  // calculate charging poser every 25(-30) seconds
let chargingToBeStarted = false;   // tried to start charging session last time?
let loadChargingSessions = false;
let photovoltaicsActive  = false;  // is photovoltaics automatic active?
let useX1switchForAutomatic = true;
let maxPowerActive       = false;  // is limiter für maximum power active?
let wallboxIncluded      = true;   // amperage of wallbox include in energy meters 1, 2 or 3?
let amperageDelta        = 500;    // default for step of amperage
let underusage           = 0;      // maximum regard use to reach minimal charge power for vehicle
let minAmperage          = 5000;   // minimum amperage to start charging session
let minChargeSeconds     = 0;      // minimum of charge time even when surplus is not sufficient
let minRegardSeconds     = 0;      // maximum time to accept regard when charging
let valueFor1pCharging   = null;   // value that will be assigned to 1p/3p state to switch to 1 phase charging
let valueFor3PCharging   = null;   // value that will be assigned to 1p/3p state to switch to 3 phase charging
let valueFor1P3PReady    = null;   // value that will be assigned to 1p/3p state when vehicle is plugged but not yet charging
let stateFor1p3pCharging = null;   // state for switching installation contactor
let stateFor1p3pAck      = false;  // Is state acknowledged?
let stepFor1p3pSwitching = 0;      // 0 = nothing to switch, 1 = stop charging, 2 = switch phases, 3 = restart charging
let retries1p3pSwitching = 0;
let valueFor1p3pSwitching = null;  // value for switch
const voltage            = 230;    // calculate with european standard voltage of 230V
const firmwareUrl        = "https://www.keba.com/en/emobility/service-support/downloads/Downloads";
const regexP30cSeries    = /<h3 .*class="headline *tw-h3 ">(?:(?:\s|\n|\r)*?)Updates KeContact P30 a-\/b-\/c-\/e-series((?:.|\n|\r)*?)<h3/gi;
//const regexP30xSeries    = /<h3 .*class="headline *tw-h3 ">(?:(?:\s|\n|\r)*?)Updates KeContact P30 x-series((?:.|\n|\r)*?)<h3/gi;
const regexFirmware      = /<div class="mt-3">Firmware Update\s+((?:.)*?)<\/div>/gi;
const regexCurrFirmware  = /P30 v\s+((?:.)*?)\s+\(/gi;

const stateWallboxEnabled      = "enableUser";                  /*Enable User*/
const stateWallboxCurrent      = "currentUser";                 /*Current User*/
const stateWallboxMaxCurrent   = "currentHardware";             /*Maximum Current Hardware*/
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
const stateReport              = "report";
const stateStart               = "start";
const stateStop                = "stop";
const stateSetDateTime         = "setdatetime";
const stateUnlock              = "unlock";
const stateProduct             = "product";
const stateX1input             = "input";
const stateFirmware            = "firmware";                    /*current running version of firmware*/
const stateFirmwareAvailable   = "statistics.availableFirmware";/*current version of firmware available at keba.com*/
const stateSurplus             = "statistics.surplus";          /*current surplus for PV automatics*/
const stateMaxPower            = "statistics.maxPower";         /*maximum power for wallbox*/
const stateChargingPhases      = "statistics.chargingPhases";   /*number of phases with which vehicle is currently charging*/
const statePlugTimestamp       = "statistics.plugTimestamp";    /*Timestamp when vehicled was plugged to wallbox*/
const stateChargeTimestamp     = "statistics.chargeTimestamp";  /*Timestamp when charging (re)started */
const stateRegardTimestamp     = "statistics.regardTimestamp";  /*Timestamp when charging session was continued with regard */
const stateSessionId           = "statistics.sessionId";        /*id of current charging session */
const stateRfidTag             = "statistics.rfid_tag";         /*rfid tag of current charging session */
const stateRfidClass           = "statistics.rfid_class";       /*rfid class of current charging session */
const stateWallboxDisabled     = "automatic.pauseWallbox";      /*switch to generally disable charging of wallbox, e.g. because of night storage heater */
const statePvAutomatic         = "automatic.photovoltaics";     /*switch to charge vehicle in regard to surplus of photovoltaics (false= charge with max available power) */
const stateAddPower            = "automatic.addPower";          /*additional regard to run charging session*/
const stateLimitCurrent        = "automatic.limitCurrent";      /*maximum amperage for charging*/
const stateManualPhases        = "automatic.calcPhases";        /*count of phases to calculate with for KeContact Deutschland-Edition*/
const stateLastChargeStart     = "statistics.lastChargeStart";  /*Timestamp when *last* charging session was started*/
const stateLastChargeFinish    = "statistics.lastChargeFinish"; /*Timestamp when *last* charging session was finished*/
const stateLastChargeAmount    = "statistics.lastChargeAmount"; /*Energy charging in *last* session in kWh*/
const stateMsgFromOtherwallbox = "internal.message";            /*Message passed on from other instance*/

/**
 * Starts the adapter instance
 * @param {Partial<utils.AdapterOptions>} [options]
 */
function startAdapter(options) {
    // Create the adapter and define its methods
    return adapter = utils.adapter(Object.assign({}, options, {
        name: "kecontact",

        // The ready callback is called when databases are connected and adapter received configuration.
        // start here!
        ready: onAdapterReady, // Main method defined below for readability

        // is called when adapter shuts down - callback has to be called under any circumstances!
        unload: onAdapterUnload,

        // If you need to react to object changes, uncomment the following method.
        // You also need to subscribe to the objects with `adapter.subscribeObjects`, similar to `adapter.subscribeStates`.
        // objectChange: (id, obj) => {
        //     if (obj) {
        //         // The object was changed
        //         adapter.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
        //     } else {
        //         // The object was deleted
        //         adapter.log.info(`object ${id} deleted`);
        //     }
        // },

        // is called if a subscribed state changes
        stateChange: onAdapterStateChange,

        // If you need to accept messages in your adapter, uncomment the following block.
        // /**
        //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
        //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
        //  */
        // message: (obj) => {
        //     if (typeof obj === "object" && obj.message) {
        //         if (obj.command === "send") {
        //             // e.g. send email or pushover or whatever
        //             adapter.log.info("send command");

        //             // Send response in callback if required
        //             if (obj.callback) adapter.sendTo(obj.from, obj.command, "Message received", obj.callback);
        //         }
        //     }
        // },
    }));
}

// startup
function onAdapterReady() {
    if (! checkConfig()) {
        adapter.log.error("start of adapter not possible due to config errors");
        return;
    }
    if (loadChargingSessions) {
        //History Datenpunkte anlegen
        createHistory();
    }
    main();
}

//unloading
function onAdapterUnload(callback) {
    try {
        if (sendDelayTimer) {
            clearInterval(sendDelayTimer);
        }

        disableChargingTimer();

        if (txSocket) {
            txSocket.close();
        }

        if (rxSocketReports) {
            if (rxSocketBroadcast.active)
                rxSocketReports.close();
        }

        if (rxSocketBroadcast) {
            if (rxSocketBroadcast.active)
                rxSocketBroadcast.close();
        }

        if (isForeignStateSpecified(adapter.config.stateRegard))
            adapter.unsubscribeForeignStates(adapter.config.stateRegard);
        if (isForeignStateSpecified(adapter.config.stateSurplus))
            adapter.unsubscribeForeignStates(adapter.config.stateSurplus);
        if (isForeignStateSpecified(adapter.config.stateBatteryCharging))
            adapter.unsubscribeForeignStates(adapter.config.stateBatteryCharging);
        if (isForeignStateSpecified(adapter.config.stateBatteryDischarging))
            adapter.unsubscribeForeignStates(adapter.config.stateBatteryDischarging);
        if (isForeignStateSpecified(adapter.config.stateEnergyMeter1))
            adapter.unsubscribeForeignStates(adapter.config.stateEnergyMeter1);
        if (isForeignStateSpecified(adapter.config.stateEnergyMeter2))
            adapter.unsubscribeForeignStates(adapter.config.stateEnergyMeter2);
        if (isForeignStateSpecified(adapter.config.stateEnergyMeter3))
            adapter.unsubscribeForeignStates(adapter.config.stateEnergyMeter3);

    } catch (e) {
        if (adapter.log)   // got an exception "TypeError: Cannot read property 'warn' of undefined"
            adapter.log.warn("Error while closing: " + e);
    }

    callback();
}

// is called if a subscribed state changes
function onAdapterStateChange (id, state) {
    // Warning: state can be null if it was deleted!
    if (!id || !state) {
        return;
    }
    //adapter.log.debug("stateChange " + id + " " + JSON.stringify(state));
    // save state changes of foreign adapters - this is done even if value has not changed but acknowledged

    const oldValue = getStateInternal(id);
    let newValue = state.val;
    setStateInternal(id, newValue);

    // if vehicle is (un)plugged check if schedule has to be disabled/enabled
    if (id == adapter.namespace + "." + stateWallboxPlug) {
        const wasVehiclePlugged   = isVehiclePlugged(oldValue);
        const isNowVehiclePlugged = isVehiclePlugged(newValue);
        if (isNowVehiclePlugged && ! wasVehiclePlugged) {
            adapter.log.info("vehicle plugged to wallbox");
            initChargingSession();
            forceUpdateOfCalculation();
        } else if (! isNowVehiclePlugged && wasVehiclePlugged) {
            adapter.log.info("vehicle unplugged from wallbox");
            finishChargingSession();
        }
    }

    if (id == adapter.namespace + "." + stateWallboxDisabled) {
        if (oldValue != newValue) {
            adapter.log.info("change pause status of wallbox from " + oldValue + " to " + newValue);
            newValue = getBoolean(newValue);
            forceUpdateOfCalculation();
        }
    }

    if (id == adapter.namespace + "." + statePvAutomatic) {
        if (oldValue != newValue) {
            adapter.log.info("change of photovoltaics automatic from " + oldValue + " to " + newValue);
            newValue = getBoolean(newValue);
            displayChargeMode();
            forceUpdateOfCalculation();
        }
    }

    if (id == adapter.namespace + "." + stateX1input) {
        if (useX1switchForAutomatic) {
            if (oldValue != newValue) {
                adapter.log.info("change of photovoltaics automatic via X1 from " + oldValue + " to " + newValue);
                displayChargeMode();
                forceUpdateOfCalculation();
            }
        }
    }

    if (id == adapter.namespace + "." + stateAddPower) {
        if (oldValue != newValue)
            adapter.log.info("change additional power from regard from " + oldValue + " to " + newValue);
    }

    if (id == adapter.namespace + "." + stateFirmware) {
        checkFirmware();
    }

    if (id == stateFor1p3pCharging) {
        stateFor1p3pAck = state.ack;
    }

    if (state.ack) {
        return;
    }
    if (! id.startsWith(adapter.namespace)) {
        // do not care for foreign states
        return;
    }

    if (!Object.prototype.hasOwnProperty.call(stateChangeListeners, id)) {
        adapter.log.error("Unsupported state change: " + id);
        return;
    }

    stateChangeListeners[id](oldValue, newValue);
    setStateAck(id, newValue);
}

async function main() {

    // Reset the connection indicator during startup
    await adapter.setStateAsync("info.connection", false, true);

    // The adapters config (in the instance object everything under the attribute "native") is accessible via
    // adapter.config:
    adapter.log.info("config host: " + adapter.config.host);
    adapter.log.info("config passiveMode: " + adapter.config.passiveMode);
    adapter.log.info("config pollInterval: " + adapter.config.pollInterval);
    adapter.log.info("config loadChargingSessions: " + adapter.config.loadChargingSessions);
    adapter.log.info("config useX1forAutomatic: " + adapter.config.useX1forAutomatic);
    adapter.log.info("config stateRegard: " + adapter.config.stateRegard);
    adapter.log.info("config stateSurplus: " + adapter.config.stateSurplus);
    adapter.log.info("config stateBatteryCharging: " + adapter.config.stateBatteryCharging);
    adapter.log.info("config stateBatteryDischarging: " + adapter.config.stateBatteryDischarging);
    adapter.log.info("config statesIncludeWallbox: " + adapter.config.statesIncludeWallbox);
    adapter.log.info("config minAmperage: " + adapter.config.minAmperage);
    adapter.log.info("config addPower: " + adapter.config.addPower);
    adapter.log.info("config delta: " + adapter.config.delta);
    adapter.log.info("config underusage: " + adapter.config.underusage);
    adapter.log.info("config minTime: " + adapter.config.minTime);
    adapter.log.info("config regardTime: " + adapter.config.regardTime);
    adapter.log.info("config maxPower: " + adapter.config.maxPower);
    adapter.log.info("config stateEnergyMeter1: " + adapter.config.stateEnergyMeter1);
    adapter.log.info("config stateEnergyMeter2: " + adapter.config.stateEnergyMeter2);
    adapter.log.info("config stateEnergyMeter3: " + adapter.config.stateEnergyMeter3);
    adapter.log.info("config wallboxNotIncluded: " + adapter.config.wallboxNotIncluded);

    /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean variable named "testVariable"
        Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
    */
    // await adapter.setObjectNotExistsAsync("testVariable", {
    //     type: "state",
    //     common: {
    //         name: "testVariable",
    //         type: "boolean",
    //         role: "indicator",
    //         read: true,
    //         write: true,
    //     },
    //     native: {},
    // });

    // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
    // adapter.subscribeStates("testVariable");
    // You can also add a subscription for multiple states. The following line watches all states starting with "lights."
    // adapter.subscribeStates("lights.*");
    // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
    // adapter.subscribeStates("*");

    /*
        setState examples
        you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
    */
    // the variable testVariable is set to true as command (ack=false)
    // await adapter.setStateAsync("testVariable", true);

    // same thing, but the value is flagged "ack"
    // ack should be always set to true if the value is received from or acknowledged from the target system
    // await adapter.setStateAsync("testVariable", { val: true, ack: true });

    // same thing, but the state is deleted after 30s (getState will return null afterwards)
    // await adapter.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

    // examples for the checkPassword/checkGroup functions
    // adapter.checkPassword("admin", "iobroker", (res) => {
    //     adapter.log.info("check user admin pw iobroker: " + res);
    // });

    // adapter.checkGroup("admin", "admin", (res) => {
    //     adapter.log.info("check group user admin group admin: " + res);
    // });
    txSocket = dgram.createSocket("udp4");

    rxSocketReports = dgram.createSocket({ type: "udp4", reuseAddr: true });
    rxSocketReports.on("error", (err) => {
        adapter.log.error("RxSocketReports error: " + err.message + "\n" + err.stack);
        rxSocketReports.close();
    });
    rxSocketReports.on("listening", function () {
        rxSocketReports.setBroadcast(true);
        const address = rxSocketReports.address();
        adapter.log.debug("UDP server listening on " + address.address + ":" + address.port);
    });
    rxSocketReports.on("message", handleWallboxMessage);
    rxSocketReports.bind(DEFAULT_UDP_PORT, "0.0.0.0");

    rxSocketBroadcast = dgram.createSocket({ type: "udp4", reuseAddr: true });
    rxSocketBroadcast.on("error", (err) => {
        adapter.log.error("RxSocketBroadcast error: " + err.message + "\n" + err.stack);
        rxSocketBroadcast.close();
    });
    rxSocketBroadcast.on("listening", function () {
        rxSocketBroadcast.setBroadcast(true);
        rxSocketBroadcast.setMulticastLoopback(true);
        const address = rxSocketBroadcast.address();
        adapter.log.debug("UDP broadcast server listening on " + address.address + ":" + address.port);
    });
    rxSocketBroadcast.on("message", handleWallboxBroadcast);
    rxSocketBroadcast.bind(BROADCAST_UDP_PORT);

    //await adapter.setStateAsync("info.connection", true, true);  // too ealry to acknowledge ...

    adapter.getForeignObject("system.config", function(err, ioBroker_Settings) {
        if (err) {
            adapter.log.error("Error while fetching system.config: " + err);
            return;
        }

        if (ioBroker_Settings && (ioBroker_Settings.common.language == "de")) {
            ioBrokerLanguage = "de";
        } else {
            ioBrokerLanguage = "en";
        }
    });

    adapter.getStatesOf(function (err, data) {
        if (data) {
            for (let i = 0; i < data.length; i++) {
                if (data[i].native && data[i].native.udpKey) {
                    states[data[i].native.udpKey] = data[i];
                }
            }
        }
        // save all state value into internal store
        adapter.getStates("*", function (err, obj) {
            if (err) {
                adapter.log.error("error reading states: " + err);
            } else {
                if (obj) {
                    for (const i in obj) {
                        if (! Object.prototype.hasOwnProperty.call(obj, i)) continue;
                        if (obj[i] !== null) {
                            if (typeof obj[i] == "object") {
                                setStateInternal(i, obj[i].val);
                            } else {
                                adapter.log.error("unexpected state value: " + obj[i]);
                            }
                        }
                    }
                } else {
                    adapter.log.error("not states found");
                }
            }
        });
        start();
    });
}

function start() {
    adapter.subscribeStates("*");

    stateChangeListeners[adapter.namespace + "." + stateWallboxEnabled] = function (oldValue, newValue) {
        sendUdpDatagram("ena " + (newValue ? 1 : 0), true);
    };
    stateChangeListeners[adapter.namespace + "." + stateWallboxCurrent] = function (oldValue, newValue) {
        //sendUdpDatagram("currtime " + parseInt(newValue) + " 1", true);
        sendUdpDatagram("curr " + parseInt(newValue), true);
    };
    stateChangeListeners[adapter.namespace + "." + stateWallboxOutput] = function (oldValue, newValue) {
        sendUdpDatagram("output " + (newValue ? 1 : 0), true);
    };
    stateChangeListeners[adapter.namespace + "." + stateWallboxDisplay] = function (oldValue, newValue) {
        if (newValue !== null) {
            if (typeof newValue == "string") {
                sendUdpDatagram("display 0 0 0 0 " + newValue.replace(/ /g, "$"), true);
            } else {
                adapter.log.error("invalid data to send to display: " + newValue);
            }
        }
    };
    stateChangeListeners[adapter.namespace + "." + stateWallboxDisabled] = function () {
        // parameters (oldValue, newValue) can be ommited if not needed
        // no real action to do
    };
    stateChangeListeners[adapter.namespace + "." + statePvAutomatic] = function () {
        // no real action to do
    };
    stateChangeListeners[adapter.namespace + "." + stateSetEnergy] = function (oldValue, newValue) {
        sendUdpDatagram("setenergy " + parseInt(newValue) * 10, true);
    };
    stateChangeListeners[adapter.namespace + "." + stateReport] = function (oldValue, newValue) {
        sendUdpDatagram("report " + newValue, true);
    };
    stateChangeListeners[adapter.namespace + "." + stateStart] = function (oldValue, newValue) {
        sendUdpDatagram("start " + newValue, true);
    };
    stateChangeListeners[adapter.namespace + "." + stateStop] = function (oldValue, newValue) {
        sendUdpDatagram("stop " + newValue, true);
    };
    stateChangeListeners[adapter.namespace + "." + stateSetDateTime] = function (oldValue, newValue) {
        sendUdpDatagram("setdatetime " + newValue, true);
    };
    stateChangeListeners[adapter.namespace + "." + stateUnlock] = function () {
        sendUdpDatagram("unlock", true);
    };
    stateChangeListeners[adapter.namespace + "." + stateAddPower] = function () {
        // no real action to do
    };
    stateChangeListeners[adapter.namespace + "." + stateManualPhases] = function () {
        // no real action to do
    };
    stateChangeListeners[adapter.namespace + "." + stateLimitCurrent] = function () {
        // no real action to do
    };
    stateChangeListeners[adapter.namespace + "." + stateMsgFromOtherwallbox] = function (oldValue, newValue) {
        handleWallboxExchange(newValue);
    };

    //sendUdpDatagram("i");   only needed for discovery
    requestReports();
    enableChargingTimer((isPassive) ? intervalPassiveUpdate : intervalActiceUpdate);
}

function isForeignStateSpecified(stateValue) {
    return stateValue && stateValue !== null && typeof stateValue == "string" && stateValue != "" && stateValue != "[object Object]";
}

function addForeignStateFromConfig(stateValue) {
    if (isForeignStateSpecified(stateValue)) {
        if (addForeignState(stateValue)) {
            return true;
        } else {
            adapter.log.error("Error when adding foreign state '" + stateValue + "'");
            return false;
        }
    }
    return true;
}

// check if config data is fine for adapter start
function checkConfig() {
    let everythingFine = true;
    if (adapter.config.host == "0.0.0.0" || adapter.config.host == "127.0.0.1") {
        adapter.log.warn("Can't start adapter for invalid IP address: " + adapter.config.host);
        everythingFine = false;
    }
    if (adapter.config.loadChargingSessions == true) {
        loadChargingSessions = true;
    }
    isPassive = false;
    if (adapter.config.passiveMode) {
        isPassive = true;
        if (everythingFine) {
            adapter.log.info("starting charging station in passive mode");
        }
    }
    if (isPassive) {
        if (adapter.config.pollInterval > 0) {
            intervalPassiveUpdate = getNumber(adapter.config.pollInterval) * 1000;
        }
    } else {
        isPassive = false;
        if (everythingFine) {
            adapter.log.info("starting charging station in active mode");
        }
    }
    if (isForeignStateSpecified(adapter.config.stateRegard)) {
        photovoltaicsActive = true;
        everythingFine = addForeignStateFromConfig(adapter.config.stateRegard) && everythingFine;
    }
    if (isForeignStateSpecified(adapter.config.stateSurplus)) {
        photovoltaicsActive = true;
        everythingFine = addForeignStateFromConfig(adapter.config.stateSurplus) && everythingFine;
    }
    if (photovoltaicsActive) {
        everythingFine = init1p3pSwitching(adapter.config.state1p3pSwitch) && everythingFine;
        everythingFine = addForeignStateFromConfig(adapter.config.stateBatteryCharging) && everythingFine;
        everythingFine = addForeignStateFromConfig(adapter.config.stateBatteryDischarging) && everythingFine;
        if (adapter.config.useX1forAutomatic) {
            useX1switchForAutomatic = true;
        } else {
            useX1switchForAutomatic = false;
        }
        if (! adapter.config.delta || adapter.config.delta <= 50) {
            adapter.log.info("amperage delta not speficied or too low, using default value of " + amperageDelta);
        } else {
            amperageDelta = getNumber(adapter.config.delta);
        }
        if (! adapter.config.minAmperage || adapter.config.minAmperage < minAmperage) {
            adapter.log.info("minimum amperage not speficied or too low, using default value of " + minAmperage);
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
            adapter.log.info("minimum charge time not speficied or too low, using default value of " + minChargeSeconds);
        } else {
            minChargeSeconds = getNumber(adapter.config.minTime);
        }
        if (! adapter.config.regardTime || adapter.config.regardTime < 0) {
            adapter.log.info("minimum regard time not speficied or too low, using default value of " + minRegardSeconds);
        } else {
            minRegardSeconds = getNumber(adapter.config.regardTime);
        }
    }
    if (adapter.config.maxPower && (adapter.config.maxPower != 0)) {
        maxPowerActive = true;
        if (adapter.config.maxPower <= 0) {
            adapter.log.warn("max. power negative or zero - power limitation deactivated");
            maxPowerActive = false;
        }
    }
    if (maxPowerActive) {
        everythingFine = addForeignStateFromConfig(adapter.config.stateEnergyMeter1) && everythingFine;
        everythingFine = addForeignStateFromConfig(adapter.config.stateEnergyMeter2) && everythingFine;
        everythingFine = addForeignStateFromConfig(adapter.config.stateEnergyMeter3) && everythingFine;
        if (adapter.config.wallboxNotIncluded) {
            wallboxIncluded = false;
        } else {
            wallboxIncluded = true;
        }
        if (everythingFine) {
            if (! (adapter.config.stateEnergyMeter1 || adapter.config.stateEnergyMeter2 || adapter.config.stateEnergyMeter1)) {
                adapter.log.error("no energy meters defined - power limitation deactivated");
                maxPowerActive = false;
            }
        }
    }
    return everythingFine;
}

function init1p3pSwitching(stateNameFor1p3p) {
    if (isForeignStateSpecified(stateNameFor1p3p)) {
        if (! addForeignStateFromConfig(adapter.config.state1p3pSwitch)) {
            return false;
        }
        adapter.getForeignState(stateNameFor1p3p, function (err, obj) {
            if (err) {
                adapter.log.error("error reading state " + stateNameFor1p3p + ": " + err);
                return;
            } else {
                if (obj) {
                    stateFor1p3pCharging = stateNameFor1p3p;
                    let valueOn;
                    let valueOff;
                    if (typeof obj.val == "boolean") {
                        valueOn = true;
                        valueOff = false;
                    } else if (typeof obj.val == "number") {
                        valueOn = 1;
                        valueOff = 0;
                    } else {
                        adapter.log.error("unhandled type " + typeof obj.val + " for state " + stateNameFor1p3p);
                        return false;
                    }
                    if (adapter.config["1p3pSwitchIsNO"]) {
                        valueFor1pCharging = valueOff;
                        valueFor3PCharging = valueOn;
                        valueFor1P3PReady  = valueOff;
                    } else {
                        valueFor1pCharging = valueOff;
                        valueFor3PCharging = valueOn;
                        valueFor1P3PReady  = valueOff;
                        adapter.log.info("state is " + stateNameFor1p3p + " 1p = " + valueFor1pCharging + ", 3p = " + valueFor3PCharging + ", idle = " + valueFor1P3PReady);
                    }
                }
                else {
                    adapter.log.error("state " + stateNameFor1p3p + " not found!");
                }
            }
        });
    }
    return true;
}

// subscribe a foreign state to save values in "currentStateValues"
function addForeignState(id) {
    if (typeof id != "string")
        return false;
    if (id == "" || id == " ")
        return false;
    adapter.getForeignState(id, function (err, obj) {
        if (err) {
            adapter.log.error("error subscribing " + id + ": " + err);
        } else {
            if (obj) {
                adapter.log.debug("subscribe state " + id + " - current value: " + obj.val);
                setStateInternal(id, obj.val);
                adapter.subscribeForeignStates(id); // there's no return value (success, ...)
                //adapter.subscribeForeignStates({id: id, change: "ne"}); // condition is not working
            }
            else {
                adapter.log.error("state " + id + " not found!");
            }
        }
    });
    return true;
}

function isMessageFromWallboxOfThisInstance(remote) {
    return (remote.address == adapter.config.host);
}

function sendMessageToOtherInstance(message, remote) {
    // save message for other instances by setting value into state
    const prefix = "system.adapter.";
    const adapterpart = adapter.name + ".";
    const suffix = ".uptime";
    adapter.getForeignObjects(prefix + adapterpart + "*" + suffix, function(err, objects) {
        if (err) {
            adapter.log.error("Error while fetching other instances: " + err);
            return;
        }
        if (objects) {
            for (const item in objects) {
                if (Object.prototype.hasOwnProperty.call(objects, item) && item.endsWith(suffix)) {
                    const namespace = item.slice(prefix.length, - suffix.length);
                    adapter.getForeignObject(prefix + namespace, function(err, object) {
                        if (err) {
                            adapter.log.error("Error while fetching other instances: " + err);
                            return;
                        }
                        if (object) {
                            if (Object.prototype.hasOwnProperty.call(object, "native")) {
                                if (Object.prototype.hasOwnProperty.call(object.native, "host")) {
                                    if (object.native.host == remote.address) {
                                        adapter.setForeignState(namespace + "." + stateMsgFromOtherwallbox, message.toString().trim());
                                        adapter.log.debug("Message from " + remote.address + " send to " + namespace);
                                    }
                                }
                            }
                        }
                    });
                }
            }
        }
    });
}

// handle incomming message from wallbox
function handleWallboxMessage(message, remote) {
    adapter.log.debug("UDP datagram from " + remote.address + ":" + remote.port + ": '" + message + "'");
    if (isMessageFromWallboxOfThisInstance(remote)) {     // handle only message from wallbox linked to this instance, ignore other wallboxes sending broadcasts
        // Mark that connection is established by incomming data
        handleMessage(message, "received");
    } else {
        sendMessageToOtherInstance(message, remote);
    }
}

// handle incomming broadcast message from wallbox
function handleWallboxBroadcast(message, remote) {
    adapter.log.debug("UDP broadcast datagram from " + remote.address + ":" + remote.port + ": '" + message + "'");
    if (isMessageFromWallboxOfThisInstance(remote)) {     // handle only message from wallbox linked to this instance, ignore other wallboxes sending broadcasts
        handleMessage(message, "broadcast");
    }
}

// handle incomming message from other instance for this wallbox
function handleWallboxExchange(message) {
    adapter.log.debug("datagram from other instance: '" + message + "'");
    handleMessage(message, "instance");
}

function handleMessage(message, origin) {
    // Mark that connection is established by incomming data
    adapter.setState("info.connection", true, true);
    let msg = "";
    try {
        msg = message.toString().trim();
        if (msg.length === 0) {
            return;
        }

        if (msg == "started ...") {
            adapter.log.info("Wallbox startup complete");
            return;
        }

        if (msg == "i") {
            adapter.log.debug("Received: " + message);
            return;
        }

        if (msg.startsWith("TCH-OK")) {
            adapter.log.debug("Received " + message);
            return;
        }

        if (msg.startsWith("TCH-ERR")) {
            adapter.log.error("Error received from wallbox: " + message);
            return;
        }

        if (msg[0] == '"') {
            msg = "{ " + msg + " }";
        }

        handleJsonMessage(JSON.parse(msg));
    } catch (e) {
        adapter.log.warn("Error handling " + origin + " message: " + e + " (" + msg + ")");
        return;
    }

}

async function handleJsonMessage(message) {
    // message auf ID Kennung für Session History prüfen
    if (message.ID >= 100 && message.ID <= 130) {
        adapter.log.debug("History ID received: " + message.ID.substr(1));
        const sessionid = message.ID.substr(1);
        if (loadChargingSessions) {
            updateState(states[sessionid + "_json"], JSON.stringify([message]));
        }
        for (const key in message){
            if (states[sessionid + "_" + key] || loadChargingSessions === false) {
                try {
                    if (message.ID == 100) {
                        // process some values of current charging session
                        switch (key) {
                            case "Session ID": setStateAck(stateSessionId, message[key]); break;
                            case "RFID tag": setStateAck(stateRfidTag, message[key]); break;
                            case "RFID class": setStateAck(stateRfidClass, message[key]); break;
                        }
                    }
                    if (loadChargingSessions) {
                        updateState(states[sessionid + "_" + key], message[key]);
                    }
                } catch (e) {
                    adapter.log.warn("Couldn't update state " + "Session_" + sessionid + "." + key + ": " + e);
                }
            } else if (key != "ID"){
                adapter.log.warn("Unknown Session value received: " + key + "=" + message[key]);
            }
        }
    } else {
        for (const key in message) {
            if (states[key]) {
                try {
                    await updateState(states[key], message[key]);
                } catch (e) {
                    adapter.log.warn("Couldn't update state " + key + ": " + e);
                }
            } else if (key != "ID") {
                adapter.log.debug("Unknown value received: " + key + "=" + message[key]);
            }
        }
        if (message.ID == 3) {
            // Do calculation after processing "report 3"
            checkWallboxPower();
        }
    }
}

// get minimum current for wallbox
function getMinCurrent() {
    return minAmperage;
}

// get maximum current for wallbox (hardware defined by dip switch)
function getMaxCurrent() {
    let max = getStateDefault0(stateWallboxMaxCurrent);
    const limit = getStateDefault0(stateLimitCurrent);
    if ((limit > 0) && (limit < max)) {
        max = limit;
    }
    return max;
}

function resetChargingSessionData() {
    setStateAck(stateChargeTimestamp, null);
    setStateAck(stateRegardTimestamp, null);
}

function saveChargingSessionData() {
    const plugTimestamp = getStateAsDate(statePlugTimestamp);
    if (plugTimestamp == null) {
        setStateAck(stateLastChargeStart, null);
    } else {
        setStateAck(stateLastChargeStart, plugTimestamp.toString());
    }
    setStateAck(stateLastChargeFinish, (new Date()).toString());
    setStateAck(stateLastChargeAmount, getStateDefault0(stateWallboxChargeAmount) / 1000);
}

function stopCharging(isMaxPowerCalculation) {
    regulateWallbox(0, isMaxPowerCalculation);
    resetChargingSessionData();
}

function regulateWallbox(milliAmpere, isMaxPowerCalculation) {
    let oldValue = 0;
    if (getStateDefaultFalse(stateWallboxEnabled))
        oldValue = getStateDefault0(stateWallboxCurrent);

    if (milliAmpere != oldValue) {
        if (milliAmpere == 0) {
            adapter.log.info("stop charging");
        } else if (oldValue == 0) {
            adapter.log.info("(re)start charging");
        } else {
            adapter.log.info("regulate wallbox from " + oldValue + " to " + milliAmpere + "mA" + ((isMaxPowerCalculation) ? " (maxPower)" : ""));
        }
        sendUdpDatagram("currtime " + milliAmpere + " 1", true);
    }
}

function initChargingSession() {
    resetChargingSessionData();
    setStateAck(statePlugTimestamp, new Date().toString());
    setStateAck(stateSessionId, null);
    setStateAck(stateRfidTag, null);
    setStateAck(stateRfidClass, null);
    displayChargeMode();
}

function finishChargingSession() {
    saveChargingSessionData();
    setStateAck(statePlugTimestamp, null);
    resetChargingSessionData();
}

function getWallboxPowerInWatts() {
    if (getWallboxType() == TYPE_D_EDITION) {
        if (isVehiclePlugged() && getStateDefaultFalse(stateWallboxEnabled) && (getStateDefault0(stateWallboxState) == 3)) {
            return getStateDefault0(stateWallboxCurrent) * voltage * getChargingPhaseCount() / 1000;
        } else {
            return 0;
        }
    } else {
        return getStateDefault0(stateWallboxPower) / 1000;
    }
}

function getSurplusWithoutWallbox() {
    let power = getStateDefault0(adapter.config.stateSurplus) - getStateDefault0(adapter.config.stateRegard);
    const batteryPower = getStateDefault0(adapter.config.stateBatteryCharging) - getStateDefault0(adapter.config.stateBatteryDischarging);
    if (batteryPower > 0) {
        power += batteryPower;
    }
    if (adapter.config.statesIncludeWallbox)
        power += getWallboxPowerInWatts();
    return power;
}

function getTotalPower() {
    let result = getStateDefault0(adapter.config.stateEnergyMeter1)
               + getStateDefault0(adapter.config.stateEnergyMeter2)
               + getStateDefault0(adapter.config.stateEnergyMeter3);
    if (wallboxIncluded) {
        result -= getWallboxPowerInWatts();
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

function has1P3PAutomatic() {
    return stateFor1p3pCharging !== null;
}

function isReducedChargingBecause1p3p() {
    if (! has1P3PAutomatic()) {
        return false;
    }
    const currentSwitch = getStateInternal(stateFor1p3pCharging);
    if (currentSwitch === valueFor1pCharging) {
        return true;
    }
    if (currentSwitch === valueFor3PCharging) {
        return false;
    }
    adapter.log.warn("Invalid value für 1p3p switch: " + currentSwitch + " (type " + typeof currentSwitch + ")");
    return false;
}

function get1p3pPhases() {
    if (isReducedChargingBecause1p3p()) {
        getStateDefault0(stateManualPhases);
    }
    return getChargingPhaseCount();
}

function getChargingPhaseCount() {
    let retVal = getStateDefault0(stateChargingPhases);
    if ((getWallboxType() == TYPE_D_EDITION) || (retVal == 0)) {
        if (isReducedChargingBecause1p3p()) {
            retVal = 1;
        } else {
            retVal = getStateDefault0(stateManualPhases);
            if (retVal < 0) {
                adapter.log.warn("invalid manual phases count " + retVal + " using 1 phases");
                retVal = 1;
            }
            if (retVal > 3) {
                adapter.log.warn("invalid manual phases count " + retVal + " using 3 phases");
                retVal = 3;
            }
        }
    }

    // Number of phaes can only be calculated if vehicle is charging
    if ((getWallboxType() != TYPE_D_EDITION) && isVehicleCharging()) {
        let tempCount = 0;
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
            if (! isReducedChargingBecause1p3p()) {
                setStateAck(stateChargingPhases, tempCount);
            }
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
    return getWallboxPowerInWatts() > 100 ;
}

function isVehiclePlugged(myValue) {
    let value;
    if (myValue) {
        value = myValue;
    } else {
        value = getStateInternal(stateWallboxPlug);
    }
    // 0 unplugged
    // 1 plugged on charging station
    // 3 plugged on charging station plug locked
    // 5 plugged on charging station             plugged on EV
    // 7 plugged on charging station plug locked plugged on EV
    // For wallboxes with fixed cable values of 0 and 1 not used
    // Charging only possible with value of 7
    return value >= 5;
}

function isPvAutomaticsActive() {
    if (isPassive || ! photovoltaicsActive) {
        return false;
    }
    if (useX1switchForAutomatic) {
        if (getStateDefaultFalse(stateX1input) == true) {
            return false;
        }
    }
    if (getStateDefaultFalse(statePvAutomatic))
        return true;
    else
        return false;
}

function displayChargeMode() {
    if (isPassive) {
        return;
    }
    let text;
    if (isPvAutomaticsActive())
        text = chargeTextAutomatic[ioBrokerLanguage];
    else
        text = chargeTextMax[ioBrokerLanguage];
    adapter.setState(stateWallboxDisplay, text);
}

function getAmperage(power, phases) {
    const curr = Math.round(power / voltage * 1000 / amperageDelta / phases) * amperageDelta;
    adapter.log.debug("power: " + power + " / voltage: " + voltage + " * 1000 / delta: " + amperageDelta + " / phases: " + phases + " * delta = " + curr);
    return curr;
}

function checkRetries() {
    if (retries1p3pSwitching > 3) {
        adapter.log.error("switching not possible in step " + stepFor1p3pSwitching);
        stepFor1p3pSwitching = 0;
        return true;
    }
    adapter.log.info("still waiting for 1p/3p step " + stepFor1p3pSwitching + " to complete...");
    retries1p3pSwitching ++;
    return false;
}

function checkWallboxPower() {
    // update charging state also between two calculations to recognize charging session
    // before a new calculation will stop it again (as long as charingTimestamp was not yet set)
    // it can be stopped immediatelly with no respect to minimim charging time...
    if (getStateAsDate(stateChargeTimestamp) === null && isVehicleCharging() && (chargingToBeStarted || isPassive)) {
        adapter.log.info("vehicle (re)starts to charge");
        setStateAck(stateChargeTimestamp, new Date().toString());
    }

    let curr    = 0;      // in mA
    let tempMax = getMaxCurrent();
    let phases = get1p3pPhases();
    let isMaxPowerCalculation = false;
    chargingToBeStarted = false;

    // first of all check maximum power allowed
    if (maxPowerActive) {
        // Always calculate with three phases for safety reasons
        const maxPower = getTotalPowerAvailable();
        setStateAck(stateMaxPower, Math.round(maxPower));
        adapter.log.debug("Available max power: " + maxPower);
        const maxAmperage = getAmperage(maxPower, phases);
        if (tempMax > maxAmperage) {
            tempMax = maxAmperage;
        }
    }

    const available = getSurplusWithoutWallbox();
    setStateAck(stateSurplus, Math.round(available));
    adapter.log.debug("Available surplus: " + available);

    if (isPassive) {
        if (getStateAsDate(stateChargeTimestamp) !== null && ! isVehicleCharging()) {
            resetChargingSessionData();
        }
        return;
    }

    const newDate = new Date();
    if (lastCalculating !== null && newDate.getTime() - lastCalculating.getTime() < intervalCalculating) {
        return;
    }

    if (stepFor1p3pSwitching > 0) {
        switch (stepFor1p3pSwitching) {
            case 1:
                if (! isVehicleCharging()) {
                    checkRetries();
                    return;
                }
                stepFor1p3pSwitching ++;
                retries1p3pSwitching = 0;
                adapter.setForeignState(stateFor1p3pCharging, valueFor1p3pSwitching);
                return;
            case 2:
                if (! stateFor1p3pAck) {
                    checkRetries();
                    return;
                }
                stepFor1p3pSwitching = 0;
                retries1p3pSwitching = 0;
                adapter.log.info("switch 1p/3p successfully completed.");
                break;
            default:
                adapter.log.error("unknown step for 1p/3p switching: " + stepFor1p3pSwitching);
        }
    }
    valueFor1p3pSwitching = null;
    stepFor1p3pSwitching = 0;
    lastCalculating = newDate;

    // lock wallbox if requested or available amperage below minimum
    if (getStateDefaultFalse(stateWallboxDisabled) || getMinCurrent() > tempMax ||
        (isPvAutomaticsActive() && ! isVehiclePlugged())) {
        curr = 0;
    } else {
        // if vehicle is currently charging and was not before, then save timestamp
        if (isVehiclePlugged() && isPvAutomaticsActive()) {
            curr = getAmperage(available, phases);
            if (curr > tempMax) {
                curr = tempMax;
            }
            if (has1P3PAutomatic()) {
                const currWith1p = getAmperage(available, 1);
                if (curr != currWith1p) {
                    if (curr < getMinCurrent()) {
                        if (! isReducedChargingBecause1p3p()) {
                            valueFor1p3pSwitching = valueFor1pCharging;
                        }
                        phases = 1;
                        curr = currWith1p;
                    } else {
                        if (curr >= getMinCurrent() && isReducedChargingBecause1p3p()) {
                            valueFor1p3pSwitching = valueFor3PCharging;
                        }
                    }
                }
            }
            const addPower = getStateDefault0(stateAddPower);
            if (curr < getMinCurrent() && addPower > 0) {
                // Reicht der Überschuss noch nicht, um zu laden, dann ggfs. zusätzlichen Netzbezug bis "addPower" zulassen
                adapter.log.debug("check with additional power of: " + addPower);
                if (getAmperage(available + addPower, phases) >= getMinCurrent()) {
                    adapter.log.debug("Minimum amperage reached by addPower of " + addPower);
                    curr = getMinCurrent();
                }
            }
            const chargeTimestamp = getStateAsDate(stateChargeTimestamp);
            if (chargeTimestamp !== null) {
                if (curr < getMinCurrent()) {
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
                if (curr < getMinCurrent()) {
                    if (minChargeSeconds > 0) {
                        if (((new Date()).getTime() - chargeTimestamp.getTime()) / 1000 < minChargeSeconds) {
                            adapter.log.info("minimum charge time of " + minChargeSeconds + "sec not reached, continuing charging session");
                            curr = getMinCurrent();
                        }
                    }
                }
                if (curr < getMinCurrent()) {
                    if (minRegardSeconds > 0) {
                        const aktDate = new Date();
                        let regardDate = getStateAsDate(stateRegardTimestamp);
                        if (regardDate == null) {
                            setStateAck(stateRegardTimestamp, aktDate.toString());
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
            }
        } else {
            curr = tempMax;   // no automatic active or vehicle not plugged to wallbox? Charging with maximum power possible
            isMaxPowerCalculation = true;
        }
    }

    if (valueFor1p3pSwitching !== null) {
        adapter.log.debug("stop charging for switch of phases ...");
        stopCharging(isMaxPowerCalculation);
        stepFor1p3pSwitching = 1;
    } else {
        if (curr < getMinCurrent()) {
            adapter.log.debug("not enough power for charging ...");
            stopCharging(isMaxPowerCalculation);
        } else {
            if (curr > tempMax) {
                curr = tempMax;
            }
            adapter.log.debug("wallbox set to charging maximum of " + curr + " mA");
            regulateWallbox(curr, isMaxPowerCalculation);
            chargingToBeStarted = true;
        }
    }
}

function disableChargingTimer() {
    if (timerDataUpdate) {
        clearInterval(timerDataUpdate);
        timerDataUpdate = null;
    }
}

function enableChargingTimer(time) {
    disableChargingTimer();
    timerDataUpdate = setInterval(requestReports, time);
}

function forceUpdateOfCalculation() {
    // disable time of last calculation to do it with next interval
    lastCalculating = null;
    requestReports();
}

function requestReports() {
    requestDeviceDataReport();
    requestChargingDataReport();
}

function requestDeviceDataReport() {
    const newDate = new Date();
    if (lastDeviceData == null || newDate.getTime() - lastDeviceData.getTime() >= intervalDeviceDataUpdate) {
        sendUdpDatagram("report 1");
        loadChargingSessionsFromWallbox();
        lastDeviceData = newDate;
    }
}

function requestChargingDataReport() {
    sendUdpDatagram("report 2");
    sendUdpDatagram("report 3");
    sendUdpDatagram("report 100");
}

function loadChargingSessionsFromWallbox() {
    if (loadChargingSessions) {
        for (let i = 101; i <= 130; i++) {
            sendUdpDatagram("report " + i);
        }
    }
}

async function updateState(stateData, value) {
    if (stateData.common.type == "number") {
        value = parseFloat(value);
        if (stateData.native.udpMultiplier) {
            value *= parseFloat(stateData.native.udpMultiplier);
            //Workaround for Javascript parseFloat round error for max. 2 digits after comma
            value = Math.round(value * 100) / 100;
            //
        }
    } else if (stateData.common.type == "boolean") {
        value = parseInt(value) !== 0;
    }
    // immediately update power and amperage values to prevent that value is not yet updated by setState()
    // when doing calculation after processing report 3
    // no longer needed when using await
    //if (stateData._id == adapter.namespace + "." + stateWallboxPower ||
    //    stateData._id == adapter.namespace + "." + stateWallboxPhase1 ||
    //    stateData._id == adapter.namespace + "." + stateWallboxPhase2 ||
    //    stateData._id == adapter.namespace + "." + stateWallboxPhase3) {
    //    setStateInternal(stateData._id, value);
    //}
    await setStateAckSync(stateData._id, value);
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
    const message = sendQueue.shift();
    if (txSocket) {
        try {
            txSocket.send(message, 0, message.length, DEFAULT_UDP_PORT, adapter.config.host, function (err) {
                // 2nd parameter "bytes" not needed, therefore only "err" coded
                if (err) {
                    adapter.log.warn("UDP send error for " + adapter.config.host + ":" + DEFAULT_UDP_PORT + ": " + err);
                    return;
                }
                adapter.log.debug("Sent '" + message + "' to " + adapter.config.host + ":" + DEFAULT_UDP_PORT);
            });
        } catch (e) {
            if (adapter.log)
                adapter.log.error("Error sending message '" + message + "': " + e);
        }
    }
}

function getStateInternal(id) {
    if ((id == null) || (typeof id !== "string") || (id.trim().length == 0)) {
        return null;
    }
    let obj = id;
    if (! obj.startsWith(adapter.namespace + "."))
        obj = adapter.namespace + "." + id;
    return currentStateValues[obj];
}

function getNumber(value) {
    if (value) {
        if (typeof value !== "number") {
            value = parseFloat(value);
            if (isNaN(value)) {
                value = 0;
            }
        }
        return value;
    }
    return 0;
}

function getStateAsDate(id) {
    let result = getStateInternal(id);
    // state come as timestamp string => to be converted to date object
    if (result != null) {
        result = new Date(result);
    }
    return result;
}

function getBoolean(value) {
    // "repair" state: VIS boolean control sets value to 0/1 instead of false/true
    if (typeof value != "boolean") {
        return value == 1;
    }
    return value;
}

function getStateDefaultFalse(id) {
    if (id == null)
        return false;
    return getBoolean(getStateInternal(id));
}

function getStateDefault0(id) {
    if (id == null)
        return 0;
    return getNumber(getStateInternal(id));
}

function setStateInternal(id, value) {
    let obj = id;
    if (! obj.startsWith(adapter.namespace + "."))
        obj = adapter.namespace + "." + id;
    adapter.log.debug("update state " + obj + " with value:" + value);
    currentStateValues[obj] = value;
}

function setStateAck(id, value) {
    // State wird intern auch über "onStateChange" angepasst. Wenn es bereits hier gesetzt wird, klappt die Erkennung
    // von Wertänderungen nicht, weil der interne Wert bereits aktualisiert ist.
    //setStateInternal(id, value);
    adapter.setState(id, {val: value, ack: true});
}

async function setStateAckSync(id, value) {
    // Do synchronous setState
    // State wird intern auch über "onStateChange" angepasst. Wenn es bereits hier gesetzt wird, klappt die Erkennung
    // von Wertänderungen nicht, weil der interne Wert bereits aktualisiert ist.
    //setStateInternal(id, value);
    const promisedSetState = (id, value) => new Promise(resolve => adapter.setState(id, {val: value, ack: true}, resolve));
    await promisedSetState(id, value);
}

function checkFirmware() {
    if (getWallboxModel() == MODEL_P30) {
        try {
            request.get(firmwareUrl, processFirmwarePage);
        } catch (e) {
            adapter.log.warn("Error requesting firmware url " + firmwareUrl + "e: " + e);
        }
    }
    return;
}

function sendWallboxWarning(message) {
    if (! wallboxWarningSent) {
        adapter.log.warn(message);
        wallboxWarningSent = true;
    }

}

function getWallboxModel() {
    const type = getStateInternal(stateProduct);
    if (typeof type !== "string") {
        return -1;
    }
    if (type.startsWith("KC-P20")) {
        return MODEL_P20;
    }
    if (type.startsWith("KC-P30") && (type.substr(15, 1) == "-")) {
        return MODEL_P30;
    }
    if (type.startsWith("BMW-10")  && (type.substr(15, 1) == "-")) {
        return MODEL_BMW;
    }
    return 0;
}

function getWallboxType() {
    const type = getStateInternal(stateProduct);
    switch (getWallboxModel()) {
        case -1:
            return 0;
        case MODEL_P20:
            switch (type.substr(13,1)) {
                case "0": return TYPE_E_SERIES;
                case "1":
                    sendWallboxWarning("KeContact P20 b-series will not be supported!");
                    return TYPE_B_SERIES;
                case "2":  // c-series
                case "3":  // c-series + PLC (only P20)
                case "A": return TYPE_C_SERIES;  // c-series + WLAN
                case "B":  // x-series
                case "C":  // x-series + GSM
                case "D":  // x-series + GSM + PLC
                    return TYPE_X_SERIES;
            }
            break;
        case MODEL_P30:
            if (type.endsWith("-DE")) {   // KEBA says there's only one ID: KC-P30-EC220112-000-DE
                sendWallboxWarning("Keba KeContact P30 Deutschland-Edition detected. Regulation may be inaccurate.");
                return TYPE_D_EDITION;
            }
            // fall through
        case MODEL_BMW:
            switch (type.substr(13,1)) {
                case "0": return TYPE_E_SERIES;
                case "1":
                    sendWallboxWarning("KeContact P30 b-series will not be supported!");
                    return TYPE_B_SERIES;
                case "2": return TYPE_C_SERIES;
                case "3":
                    sendWallboxWarning("KeContact P30 a-series will not be supported!");
                    return TYPE_A_SERIES;
                case "B":  // x-series WLAN
                case "C":  // x-series WLAN + 3G
                case "E":  // x-series WLAN + 4G
                case "G":  // x-series 3G
                case "H":  // x-series 4G
                    return TYPE_X_SERIES;
            }
            break;
        default:
    }
    if (! wallboxUnknownSent) {
        sendSentryMessage( "unknown wallbox type " + type);
        wallboxUnknownSent = true;
    }
    return 0;
}

function sendSentryMessage(msg) {
    adapter.log.error(msg);
    if (adapter.supportsFeature && adapter.supportsFeature("PLUGINS")) {
        const sentryInstance = adapter.getPluginInstance("sentry");
        if (sentryInstance) {
            sentryInstance.getSentryObject().captureException(msg);
        }
    }
}

function getFirmwareRegEx() {
    switch (getWallboxModel()) {
        case -1:
            return 0;
        case MODEL_P30 :
            switch (getWallboxType()) {
                case TYPE_C_SERIES :
                case TYPE_D_EDITION :
                    return regexP30cSeries;
                case TYPE_X_SERIES :
                    return null;  // regexP30xSeries; x-Series no longer supported for firmware check
                default:
                    return null;
            }
        case MODEL_P20 :  // as mail of Keba on 06th august 2021 there will be no forther firmware updates
        case MODEL_BMW :
        default:
            return null;
    }
}

function processFirmwarePage(err, stat, body) {
    const prefix = "Keba firmware check: ";
    if (err) {
        adapter.log.warn(prefix + err);
    } else if (stat.statusCode != 200) {
        adapter.log.warn("Firmware page could not be loaded (" + stat.statusCode + ")");
    } else if (body) {
        const regexPattern = getFirmwareRegEx();
        if (! regexPattern || (regexPattern == null)) {
            return;
        }
        regexPattern.lastIndex = 0;
        const list = regexPattern.exec(body);
        if (list) {
            regexFirmware.lastIndex = 0;
            const block = regexFirmware.exec(list[1]);
            if (block) {
                setStateAck(stateFirmwareAvailable, block[1]);
                const currFirmware = getStateInternal(stateFirmware);
                regexCurrFirmware.lastIndex = 0;
                const currFirmwareList = regexCurrFirmware.exec(currFirmware);
                if (currFirmwareList) {
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

function createHistory() {
    // create Sessions Channel
    adapter.setObject("Sessions",
        {
            type: "channel",
            common: {
                name: "Sessions Statistics"
            },
            native: {}
        });
    // create Datapoints for 31 Sessions
    for (let i = 0; i <= 30; i++){
        let session = "";
        if (i < 10) {
            session = "0";
        }

        adapter.setObject("Sessions.Session_" + session + i,
            {
                type: "channel",
                common: {
                    name: "Session_" +session + i + " Statistics"
                },
                native: {}
            });

        adapter.setObject("Sessions.Session_" + session + i + ".json",
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

        adapter.setObject("Sessions.Session_" + session + i + ".sessionid",
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

        adapter.setObject("Sessions.Session_" + session + i + ".currentHardware",
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

        adapter.setObject("Sessions.Session_" + session + i + ".eStart",
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

        adapter.setObject("Sessions.Session_" + session + i + ".ePres",
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

        adapter.setObject("Sessions.Session_" + session + i + ".started_s",
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

        adapter.setObject("Sessions.Session_" + session + i + ".ended_s",
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

        adapter.setObject("Sessions.Session_" + session + i + ".started",
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

        adapter.setObject("Sessions.Session_" + session + i + ".ended",
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

        adapter.setObject("Sessions.Session_" + session + i + ".reason",
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

        adapter.setObject("Sessions.Session_" + session + i + ".timeQ",
            {
                "type": "state",
                "common": {
                    "name":  "Time Sync Quality",
                    "type":  "number",
                    "role":  "value",
                    "read":  true,
                    "write": false,
                    "desc":  "Time Synchronisation Mode",
                },
                "native": {
                    "udpKey": session + i + "_timeQ"
                }
            });

        adapter.setObject("Sessions.Session_" + session + i + ".rfid_tag",
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

        adapter.setObject("Sessions.Session_" + session + i + ".rfid_class",
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

        adapter.setObject("Sessions.Session_" + session + i + ".serial",
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

        adapter.setObject("Sessions.Session_" + session + i + ".sec",
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

if (require.main !== module) {
    // Export startAdapter in compact mode
    module.exports = startAdapter;
} else {
    // otherwise start the instance directly
    startAdapter();
}