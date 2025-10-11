'use strict';

/*
 * Created with @iobroker/create-adapter v2.6.5
 */

// The adapter-core module gives you access to the core ioBroker functions
// you need to create an adapter
const utils = require('@iobroker/adapter-core');

// Load your modules here, e.g.:
const dgram = require('dgram');
const axios = require('axios');
const I18n = require('@iobroker/adapter-core').I18n;

class Kecontact extends utils.Adapter {
    DEFAULT_UDP_PORT = 7090;
    BROADCAST_UDP_PORT = 7092;

    // eslint-disable-next-line jsdoc/check-tag-names
    /** @type {dgram.Socket | null} */
    txSocket = null;
    // eslint-disable-next-line jsdoc/check-tag-names
    /** @type {dgram.Socket | null} */
    rxSocketReports = null;
    // eslint-disable-next-line jsdoc/check-tag-names
    /** @type {dgram.Socket | null} */
    rxSocketBroadcast = null;
    // eslint-disable-next-line jsdoc/check-tag-names
    /** @type {NodeJS.Timeout | null} */
    sendDelayTimer = null;

    states = {}; // contains all actual state values
    stateChangeListeners = {};
    currentStateValues = {}; // contains all actual state values
    sendQueue = [];
    MODEL_P20 = 1; // product ID is like KC-P20-ES240030-000-ST
    MODEL_P30 = 2;
    MODEL_BMW = 3; // product ID is like BMW-10-EC2405B2-E1R
    TYPE_A_SERIES = 1;
    TYPE_B_SERIES = 2;
    TYPE_C_SERIES = 3; // product ID for P30 is like KC-P30-EC240422-E00
    TYPE_E_SERIES = 4; // product ID for P30 is like KC-P30-EC240422-E00
    TYPE_X_SERIES = 5;
    TYPE_D_EDITION = 6; // product id (only P30) is KC-P30-EC220112-000-DE, there's no other

    chargeTextAutomatic = 'pvAutomaticActive';
    chargeTextMax = 'pvAutomaticInactive';

    wallboxWarningSent = false; // Warning for inacurate regulation with Deutshcland Edition
    wallboxUnknownSent = false; // Warning wallbox not recognized
    isPassive = true; // no automatic power regulation?
    // eslint-disable-next-line jsdoc/check-tag-names
    /** @type {Date | null} */
    lastDeviceData = null; // time of last check for device information
    intervalDeviceDataUpdate = 24 * 60 * 60 * 1000; // check device data (e.g. firmware) every 24 hours => 'report 1'
    intervalPassiveUpdate = 10 * 60 * 1000; // check charging information every 10 minutes
    // eslint-disable-next-line jsdoc/check-tag-names
    /** @type {NodeJS.Timeout | null} */
    timerDataUpdate = null; // interval object for calculating timer
    intervalActiceUpdate = 15 * 1000; // check current power (and calculate PV-automatics/power limitation every 15 seconds (report 2+3))
    // eslint-disable-next-line jsdoc/check-tag-names
    /** @type {Date | null} */
    lastCalculating = null; // time of last check for charging information
    intervalCalculating = 25 * 1000; // calculate charging poser every 25(-30) seconds
    chargingToBeStarted = false; // tried to start charging session last time?
    loadChargingSessions = false;
    photovoltaicsActive = false; // is photovoltaics automatic active?
    useX1switchForAutomatic = true;
    maxPowerActive = false; // is limiter for maximum power active?
    lastPower = 0; // max power value when checking maxPower
    maxAmperageActive = false; // is limiter for maximum amperage active?
    lastAmperagePhase1; // last amperage value of phase 1 when checking maxAmperage
    lastAmperagePhase2; // last amperage value of phase 2 when checking maxAmperage
    lastAmperagePhase3; // last amperage value of phase 3 when checking maxAmperage
    maxAmperageDeltaLimit = 1000; // raising limit (in mA) when an immediate max power calculation is enforced
    wallboxIncluded = true; // amperage of wallbox include in energy meters 1, 2 or 3?
    amperageDelta = 500; // default for step of amperage
    underusage = 0; // maximum grid consumption use to reach minimal charge power for vehicle
    minAmperageDefault = 6000; // default minimum amperage to start charging session
    maxCurrentEnWG = 6000; // maximum current allowed when limitation of §14a EnWg is active
    minAmperage = 5000; // minimum amperage to start charging session
    minChargeSeconds = 0; // minimum of charge time even when surplus is not sufficient
    minConsumptionSeconds = 0; // maximum time to accept grid consumption when charging
    min1p3pSwSec = 0; // minimum time between phase switching
    isMaxPowerCalculation = false; // switch to show if max power calculation is active
    // eslint-disable-next-line jsdoc/check-tag-names
    /** @type {boolean | number} */
    valueFor1p3pOff = 0; // value that will be assigned to 1p/3p state when vehicle is unplugged (unpower switch)
    // eslint-disable-next-line jsdoc/check-tag-names
    /** @type {boolean | number} */
    valueFor1pCharging = 0; // value that will be assigned to 1p/3p state to switch to 1 phase charging
    // eslint-disable-next-line jsdoc/check-tag-names
    /** @type {boolean | number} */
    valueFor3pCharging = 1; // value that will be assigned to 1p/3p state to switch to 3 phase charging
    // eslint-disable-next-line jsdoc/check-tag-names
    /** @type {string | null} */
    stateFor1p3pCharging = null; // state for switching installation contactor
    stateFor1p3pAck = false; // Is state acknowledged?
    stepFor1p3pSwitching = 0; // 0 = nothing to switch, 1 = stop charging, 2 = switch phases, 3 = acknowledge switching, -1 = temporarily disabled
    retries1p3pSwitching = 0;
    valueFor1p3pSwitching = null; // value for switch
    batteryStrategy = 0; // default = don't care for a battery storage
    startWithState5Attempted = false; // switch, whether a start command was tried once even with state of 5
    voltage = 230; // calculate with european standard voltage of 230V
    firmwareUrl = 'https://www.keba.com/en/emobility/service-support/downloads/downloads';
    regexP30cSeries =
        /<h3 .*class="headline *tw-h3 ">(?:(?:\s|\n|\r)*?)Updates KeContact P30 a-\/b-\/c-\/e-series((?:.|\n|\r)*?)<h3/gi;
    //regexP30xSeries    = /<h3 .*class="headline *tw-h3 ">(?:(?:\s|\n|\r)*?)Updates KeContact P30 x-series((?:.|\n|\r)*?)<h3/gi;
    regexFirmware = /<div class="mt-3">Firmware Update\s+((?:.)*?)<\/div>/gi;
    regexCurrFirmware = /P30 v\s+((?:.)*?)\s+\(/gi;

    stateWallboxEnabled = 'enableUser'; /*Enable User*/
    stateWallboxCurrent = 'currentUser'; /*Current User*/
    stateWallboxMaxCurrent = 'currentHardware'; /*Maximum Current Hardware*/
    stateWallboxCurrentWithTimer = 'currentTimer'; /*Current value for currTime */
    stateTimeForCurrentChange = 'timeoutCurrentTimer'; /*Timer value for currTime */
    stateWallboxPhase1 = 'i1'; /*Current 1*/
    stateWallboxPhase2 = 'i2'; /*Current 2*/
    stateWallboxPhase3 = 'i3'; /*Current 3*/
    stateWallboxPlug = 'plug'; /*Plug status */
    stateWallboxState = 'state'; /*State of charging session */
    stateWallboxPower = 'p'; /*Power*/
    stateAuthActivated = 'authON';
    stateAuthPending = 'autoreq';
    stateWallboxChargeAmount = 'ePres'; /*ePres - amount of charged energy in Wh */
    stateWallboxDisplay = 'display';
    stateWallboxOutput = 'output';
    stateSetEnergy = 'setenergy';
    stateReport = 'report';
    stateStart = 'start';
    stateStop = 'stop';
    stateSetDateTime = 'setdatetime';
    stateUnlock = 'unlock';
    stateProduct = 'product';
    stateX1input = 'input';
    stateFirmware = 'firmware'; /*current running version of firmware*/
    stateFirmwareAvailable = 'statistics.availableFirmware'; /*current version of firmware available at keba.com*/
    stateSurplus = 'statistics.surplus'; /*current surplus for PV automatics*/
    stateMaxPower = 'statistics.maxPower'; /*maximum power for wallbox*/
    stateMaxAmperage = 'statistics.maxAmperage'; /*maximum amperage for wallbox*/
    stateChargingPhases = 'statistics.chargingPhases'; /*number of phases with which vehicle is currently charging*/
    statePlugTimestamp = 'statistics.plugTimestamp'; /*Timestamp when vehicled was plugged to wallbox*/
    stateAuthPlugTimestamp =
        'statistics.authPlugTimestamp'; /* Timestamp when vehicle was plugged and charging was authorized */
    stateChargeTimestamp = 'statistics.chargeTimestamp'; /*Timestamp when charging (re)started */
    stateConsumptionTimestamp =
        'statistics.consumptionTimestamp'; /*Timestamp when charging session was continued with grid consumption */
    state1p3pSwTimestamp = 'statistics.1p3pSwTimestamp'; /*Timestamp when 1p3pSw was changed */
    stateSessionId = 'statistics.sessionId'; /*id of current charging session */
    stateRfidTag = 'statistics.rfid_tag'; /*rfid tag of current charging session */
    stateRfidClass = 'statistics.rfid_class'; /*rfid class of current charging session */
    stateWallboxDisabled =
        'automatic.pauseWallbox'; /*switch to generally disable charging of wallbox, e.g. because of night storage heater */
    statePvAutomatic =
        'automatic.photovoltaics'; /*switch to charge vehicle in grid consumption to surplus of photovoltaics (false= charge with max available power) */
    stateAddPower = 'automatic.addPower'; /*additional grid consumption to run charging session*/
    stateLimitCurrent = 'automatic.limitCurrent'; /*maximum amperage for charging*/
    stateLimitCurrent1p = 'automatic.limitCurrent1p'; /*maximum amperage for charging when 1p 3p switch set to 1p */
    stateManualPhases = 'automatic.calcPhases'; /*count of phases to calculate with for KeContact Deutschland-Edition*/
    stateManual1p3p = 'automatic.1p3pCharging'; /*switch to permanently charge with 1p or 3p*/
    stateBatteryStrategy = 'automatic.batteryStorageStrategy'; /*strategy to use for battery storage dynamically*/
    stateMinimumSoCOfBatteryStorage =
        'automatic.batterySoCForCharging'; /*SoC above which battery storage may be used for charging vehicle*/
    stateLastChargeStart = 'statistics.lastChargeStart'; /*Timestamp when *last* charging session was started*/
    stateLastChargeFinish = 'statistics.lastChargeFinish'; /*Timestamp when *last* charging session was finished*/
    stateLastChargeAmount = 'statistics.lastChargeAmount'; /*Energy charging in *last* session in kWh*/
    stateMsgFromOtherwallbox = 'internal.message'; /*Message passed on from other instance*/
    stateX2Source = 'x2phaseSource'; /*X2 switch source */
    stateX2Switch = 'x2phaseSwitch'; /*X2 switch */
    stateVehicleSoC = 'automatic.stateVehicleSoC'; /*SoC of vehicle currently to be charged*/
    stateTargetSoC = 'automatic.targetSoC'; /*SoC up to this vehicle is to be charged*/
    stateResetTargetSoC = 'automatic.resetTargetSoC'; /*reset target SoC after it has been reached?*/

    /**
     * @param [options] options for adapter start
     */
    constructor(options) {
        super({
            ...options,
            name: 'kecontact',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        // this.on('objectChange', this.onObjectChange.bind(this));
        // this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    async onReady() {
        // Initialize your adapter here
        if (I18n === undefined) {
            this.log.error(
                'start of adapter not possible due to missing translation - please ensure js-controller >= 7',
            );
            return;
        }
        await I18n.init(__dirname, this);

        if (!this.checkConfig()) {
            this.log.error('start of adapter not possible due to config errors');
            return;
        }
        if (this.loadChargingSessions) {
            //History Datenpunkte anlegen
            this.createHistory();
        }

        // Reset the connection indicator during startup
        this.setState('info.connection', false, true);

        // The adapters config (in the instance object everything under the attribute "native") is accessible via
        // this.config:
        this.log.debug(`config host: ${this.config.host}`);
        this.log.debug(`config passiveMode: ${this.config.passiveMode}`);
        this.log.debug(`config pollInterval: ${this.config.pollInterval}`);
        this.log.debug(`config loadChargingSessions: ${this.config.loadChargingSessions}`);
        this.log.debug(`config lessInfoLogs: ${this.config.lessInfoLogs}`);
        this.log.debug(`config useX1forAutomatic: ${this.config.useX1forAutomatic}`);
        this.log.debug(`config authChargingTime: ${this.config.authChargingTime}`);
        this.log.debug(`config stateRegard: ${this.config.stateRegard}`);
        this.log.debug(`config stateSurplus: ${this.config.stateSurplus}`);
        this.log.debug(`config stateBatteryCharging: ${this.config.stateBatteryCharging}`);
        this.log.debug(`config stateBatteryDischarging: ${this.config.stateBatteryDischarging}`);
        this.log.debug(`config stateBatterySoC: ${this.config.stateBatterySoC}`);
        this.log.debug(`config batteryPower: ${this.config.batteryPower}`);
        this.log.debug(`config batteryChargePower: ${this.config.batteryChargePower}`);
        this.log.debug(`config batteryMinSoC: ${this.config.batteryMinSoC}`);
        this.log.debug(`config batteryLimitSoC: ${this.config.batteryLimitSoC}`);
        this.log.debug(`config batteryStorageStrategy: ${this.config.batteryStorageStrategy}`);
        this.log.debug(`config statesIncludeWallbox: ${this.config.statesIncludeWallbox}`);
        this.log.debug(`config.state1p3pSwitch: ${this.config.state1p3pSwitch}`);
        this.log.debug(`config.1p3pViax2: ${this.config['1p3pViaX2']}`);
        this.log.debug(
            `config.1p3pSwitchIsNO: ${this.config['1p3pSwitchIsNO']}, 1p = ${this.valueFor1pCharging}, 3p = ${
                this.valueFor3pCharging
            }, off = ${this.valueFor1p3pOff}`,
        );
        this.log.debug(`config minAmperage: ${this.config.minAmperage}`);
        this.log.debug(`config addPower: ${this.config.addPower}`);
        this.log.debug(`config delta: ${this.config.delta}`);
        this.log.debug(`config underusage: ${this.config.underusage}`);
        this.log.debug(`config minTime: ${this.config.minTime}`);
        this.log.debug(`config regardTime: ${this.config.regardTime}`);
        this.log.debug(`config stateEnWG: ${this.config.stateEnWG}`);
        this.log.debug(`config dynamicEnWG: ${this.config.dynamicEnWG}`);
        this.log.debug(`config maxPower: ${this.config.maxPower}`);
        this.log.debug(`config stateEnergyMeter1: ${this.config.stateEnergyMeter1}`);
        this.log.debug(`config stateEnergyMeter2: ${this.config.stateEnergyMeter2}`);
        this.log.debug(`config stateEnergyMeter3: ${this.config.stateEnergyMeter3}`);
        this.log.debug(`config wallboxNotIncluded: ${this.config.wallboxNotIncluded}`);
        this.log.debug(`config maxAmperage: ${this.config.maxAmperage}`);
        this.log.debug(`config stateAmperagePhase1: ${this.config.stateAmperagePhase1}`);
        this.log.debug(`config stateAmperagePhase2: ${this.config.stateAmperagePhase2}`);
        this.log.debug(`config stateAmperagePhase3: ${this.config.stateAmperagePhase3}`);
        this.log.debug(`config amperageUnit: ${this.config.amperageUnit} => factor is ${this.getAmperageFactor()}`);

        /*
        For every state in the system there has to be also an object of type state
        Here a simple template for a boolean variable named "testVariable"
        Because every adapter instance uses its own unique namespace variable names can't collide with other adapters variables
        */
        /* await this.setObjectNotExistsAsync("testVariable", {
            type: "state",
            common: {
                name: "testVariable",
                type: "boolean",
                role: "indicator",
                read: true,
                write: true,
            },
            native: {},
        }); */

        // In order to get state updates, you need to subscribe to them. The following line adds a subscription for our variable we have created above.
        //this.subscribeStates("testVariable");
        // You can also add a subscription for multiple states. The following line watches all states starting with "lights."
        // this.subscribeStates('lights.*');
        // Or, if you really must, you can also watch all states. Don't do this if you don't need to. Otherwise this will cause a lot of unnecessary load on the system:
        // this.subscribeStates('*');

        /*
            setState examples
            you will notice that each setState will cause the stateChange event to fire (because of above subscribeStates cmd)
        */
        // the variable testVariable is set to true as command (ack=false)
        //await this.setStateAsync("testVariable", true);

        // same thing, but the value is flagged "ack"
        // ack should be always set to true if the value is received from or acknowledged from the target system
        //await this.setStateAsync("testVariable", { val: true, ack: true });

        // same thing, but the state is deleted after 30s (getState will return null afterwards)
        //await this.setStateAsync("testVariable", { val: true, ack: true, expire: 30 });

        // examples for the checkPassword/checkGroup functions
        /*let result = await this.checkPasswordAsync("admin", "iobroker");
        this.log.info("check user admin pw iobroker: " + result);*/

        /*result = await this.checkGroupAsync("admin", "admin");
        this.log.info("check group user admin group admin: " + result);*/

        this.setupUdpCommunication();

        //await adapter.setStateAsync('info.connection', true, true);  // too early to acknowledge ...

        this.initializeInternalStateValues();
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback has to be called under any circumstances!
     */
    onUnload(callback) {
        try {
            // Here you must clear all timeouts or intervals that may still be active
            try {
                if (this.sendDelayTimer) {
                    clearInterval(this.sendDelayTimer);
                }

                this.disableChargingTimer();

                if (this.txSocket !== null) {
                    this.txSocket.close();
                    this.txSocket = null;
                }

                if (this.rxSocketReports !== null) {
                    this.rxSocketReports.close();
                    this.rxSocketReports = null;
                }

                if (this.rxSocketBroadcast !== null) {
                    this.rxSocketBroadcast.close();
                    this.rxSocketBroadcast = null;
                }

                if (this.isForeignStateSpecified(this.config.stateRegard)) {
                    this.unsubscribeForeignStates(this.config.stateRegard);
                }
                if (this.isForeignStateSpecified(this.config.stateSurplus)) {
                    this.unsubscribeForeignStates(this.config.stateSurplus);
                }
                if (this.isForeignStateSpecified(this.config.stateBatteryCharging)) {
                    this.unsubscribeForeignStates(this.config.stateBatteryCharging);
                }
                if (this.isForeignStateSpecified(this.config.stateBatteryDischarging)) {
                    this.unsubscribeForeignStates(this.config.stateBatteryDischarging);
                }
                if (this.isForeignStateSpecified(this.config.stateBatterySoC)) {
                    this.unsubscribeForeignStates(this.config.stateBatterySoC);
                }
                if (this.isForeignStateSpecified(this.config.stateEnergyMeter1)) {
                    this.unsubscribeForeignStates(this.config.stateEnergyMeter1);
                }
                if (this.isForeignStateSpecified(this.config.stateEnergyMeter2)) {
                    this.unsubscribeForeignStates(this.config.stateEnergyMeter2);
                }
                if (this.isForeignStateSpecified(this.config.stateEnergyMeter3)) {
                    this.unsubscribeForeignStates(this.config.stateEnergyMeter3);
                }
                if (this.isForeignStateSpecified(this.config.stateEnWG)) {
                    this.unsubscribeForeignStates(this.config.stateEnWG);
                }
                const stateForVehicleSoC = this.getStateInternal(this.stateVehicleSoC);
                if (this.isForeignStateSpecified(stateForVehicleSoC)) {
                    this.unsubscribeForeignStates(stateForVehicleSoC);
                }
            } catch (e) {
                if (this.log) {
                    // got an exception 'TypeError: Cannot read property 'warn' of undefined'
                    this.log.warn(`Error while closing: ${e}`);
                }
            }
            callback();
        } catch (e) {
            this.log.warn(`Error while disabling timers: ${e}`);
            callback();
        }
    }

    // If you need to react to object changes, uncomment the following block and the corresponding line in the constructor.
    // You also need to subscribe to the objects with `this.subscribeObjects`, similar to `this.subscribeStates`.
    // /**
    //  * Is called if a subscribed object changes
    //  * @param {string} id
    //  * @param {ioBroker.Object | null | undefined} obj
    //  */
    // onObjectChange(id, obj) {
    //     if (obj) {
    //         // The object was changed
    //         this.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
    //     } else {
    //         // The object was deleted
    //         this.log.info(`object ${id} deleted`);
    //     }
    // }

    /**
     * Is called if a subscribed state changes
     *
     * @param id name of the state that changed
     * @param state object with all data of state
     */
    onStateChange(id, state) {
        if (state) {
            // The state was changed
            this.log.silly(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
            if (!id) {
                return;
            }
            //this.log.silly('stateChange ' + id + ' ' + JSON.stringify(state));
            // save state changes of foreign adapters - this is done even if value has not changed but acknowledged

            const oldValue = this.getStateInternal(id);
            let newValue = state.val;
            this.setStateInternal(id, newValue);

            // if vehicle is (un)plugged check if schedule has to be disabled/enabled
            if (id == `${this.namespace}.${this.stateWallboxPlug}`) {
                const wasVehiclePlugged = this.isVehiclePlugged(oldValue);
                const isNowVehiclePlugged = this.isVehiclePlugged(newValue);
                if (isNowVehiclePlugged && !wasVehiclePlugged) {
                    this.log.info('vehicle plugged to wallbox');
                    if (this.stepFor1p3pSwitching < 0) {
                        this.reset1p3pSwitching();
                    }
                    if (!this.isPvAutomaticsActive()) {
                        this.set1p3pSwitching(this.valueFor3pCharging);
                    }
                    this.initChargingSession();
                    this.forceUpdateOfCalculation();
                } else if (!isNowVehiclePlugged && wasVehiclePlugged) {
                    this.log.info('vehicle unplugged from wallbox');
                    this.finishChargingSession();
                    if (this.isContinueDueToMin1p3pSwTime(new Date())) {
                        this.log.debug('wait for minimum time for phase switch to "off"');
                    } else {
                        this.set1p3pSwitching(this.valueFor1p3pOff);
                        if (this.stepFor1p3pSwitching < 0) {
                            this.reset1p3pSwitching();
                        }
                    }
                }
            }

            // if the Wallbox have been disabled or enabled.
            if (id == `${this.namespace}.${this.stateWallboxDisabled}`) {
                if (oldValue != newValue) {
                    this.log.info(`change pause status of wallbox from ${oldValue} to ${newValue}`);
                    newValue = this.getBoolean(newValue);
                    this.forceUpdateOfCalculation();
                }
            }

            // if PV Automatic has been disable or enabled.
            if (id == `${this.namespace}.${this.statePvAutomatic}`) {
                if (oldValue != newValue) {
                    this.log.info(`change of photovoltaics automatic from ${oldValue} to ${newValue}`);
                    newValue = this.getBoolean(newValue);
                    this.displayChargeMode();
                    this.forceUpdateOfCalculation();
                }
            }

            // if the state of the X1 Input has chaned.
            if (id == `${this.namespace}.${this.stateX1input}`) {
                if (this.useX1switchForAutomatic) {
                    if (oldValue != newValue) {
                        this.log.info(`change of photovoltaics automatic via X1 from ${oldValue} to ${newValue}`);
                        this.displayChargeMode();
                        this.forceUpdateOfCalculation();
                    }
                }
            }

            // if the value for AddPower  was changes.
            if (id == `${this.namespace}.${this.stateAddPower}`) {
                if (oldValue != newValue) {
                    this.log.info(`change additional power from grid consumption from ${oldValue} to ${newValue}`);
                }
            }

            if (id == `${this.namespace}.${this.stateFirmware}`) {
                this.checkFirmware();
            }

            if (id == this.stateFor1p3pCharging) {
                this.stateFor1p3pAck = state.ack;
            }

            if (this.maxPowerActive === true && typeof newValue == 'number') {
                if (
                    id == this.config.stateEnergyMeter1 ||
                    id == this.config.stateEnergyMeter2 ||
                    id == this.config.stateEnergyMeter3
                ) {
                    if (this.getTotalPower() - this.lastPower > (this.maxAmperageDeltaLimit / 1000) * this.voltage) {
                        this.requestCurrentChargingValuesDataReport();
                    }
                }
            }

            if (this.maxAmperageActive === true && typeof newValue == 'number') {
                if (
                    id == this.config.stateAmperagePhase1 ||
                    id == this.config.stateAmperagePhase2 ||
                    id == this.config.stateAmperagePhase3
                ) {
                    if (
                        this.getStateDefault0(this.config.stateAmperagePhase1) * this.getAmperageFactor() -
                            this.lastAmperagePhase1 >
                            this.maxAmperageDeltaLimit ||
                        this.getStateDefault0(this.config.stateAmperagePhase2) * this.getAmperageFactor() -
                            this.lastAmperagePhase2 >
                            this.maxAmperageDeltaLimit ||
                        this.getStateDefault0(this.config.stateAmperagePhase3) * this.getAmperageFactor() -
                            this.lastAmperagePhase3 >
                            this.maxAmperageDeltaLimit
                    ) {
                        this.requestCurrentChargingValuesDataReport();
                    }
                }
            }

            if (id == this.stateVehicleSoC) {
                if (this.isForeignStateSpecified(oldValue)) {
                    this.unsubscribeForeignStates(oldValue);
                }
                if (this.isForeignStateSpecified(newValue)) {
                    this.addForeignState(newValue);
                }
            }

            if (state.ack) {
                return;
            }
            if (!id.startsWith(this.namespace)) {
                // do not care for foreign states
                return;
            }

            if (!Object.prototype.hasOwnProperty.call(this.stateChangeListeners, id)) {
                this.log.error(`Unsupported state change: ${id}`);
                return;
            }

            this.stateChangeListeners[id](oldValue, newValue);
            this.setStateAck(id, newValue);
        } else {
            // The state was deleted
            this.log.debug(`state ${id} deleted`);
        }
    }

    // If you need to accept messages in your adapter, uncomment the following block and the corresponding line in the constructor.
    // /**
    //  * Some message was sent to this instance over message box. Used by email, pushover, text2speech, ...
    //  * Using this method requires "common.messagebox" property to be set to true in io-package.json
    //  * @param {ioBroker.Message} obj
    //  */
    // onMessage(obj) {
    //     if (typeof obj === 'object' && obj.message) {
    //         if (obj.command === 'send') {
    //             // e.g. send email or pushover or whatever
    //             this.log.info('send command');

    //             // Send response in callback if required
    //             if (obj.callback) this.sendTo(obj.from, obj.command, 'Message received', obj.callback);
    //         }
    //     }
    // }

    setupUdpCommunication() {
        this.txSocket = dgram.createSocket('udp4');

        this.rxSocketReports = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.rxSocketReports.on('error', err => {
            this.log.error(`RxSocketReports error: ${err.message}\n${err.stack}`);
            if (this.rxSocketReports !== null) {
                this.rxSocketReports.close();
            }
        });
        this.rxSocketReports.on('listening', () => {
            if (this.rxSocketReports !== null) {
                this.rxSocketReports.setBroadcast(true);
                const address = this.rxSocketReports.address();
                this.log.debug(`UDP server listening on ${address.address}:${address.port}`);
            }
        });
        this.rxSocketReports.on('message', this.handleWallboxMessage.bind(this));
        this.rxSocketReports.bind(this.DEFAULT_UDP_PORT, '0.0.0.0');

        this.rxSocketBroadcast = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        this.rxSocketBroadcast.on('error', err => {
            if (this.rxSocketBroadcast !== null) {
                this.log.error(`RxSocketBroadcast error: ${err.message}\n${err.stack}`);
                this.rxSocketBroadcast.close();
            }
        });
        this.rxSocketBroadcast.on('listening', () => {
            if (this.rxSocketBroadcast !== null) {
                this.rxSocketBroadcast.setBroadcast(true);
                this.rxSocketBroadcast.setMulticastLoopback(true);
                const address = this.rxSocketBroadcast.address();
                this.log.debug(`UDP broadcast server listening on ${address.address}:${address.port}`);
            }
        });
        this.rxSocketBroadcast.on('message', this.handleWallboxBroadcast.bind(this));
        this.rxSocketBroadcast.bind(this.BROADCAST_UDP_PORT);
    }

    initializeInternalStateValues() {
        this.getStatesOf((err, data) => {
            if (data) {
                for (let i = 0; i < data.length; i++) {
                    if (data[i].native && data[i].native.udpKey) {
                        this.states[data[i].native.udpKey] = data[i];
                    }
                }
            }
            // save all state values into internal store
            this.getStates('*', (err, obj) => {
                if (err) {
                    this.log.error(`error reading states: ${err}`);
                } else {
                    if (obj) {
                        for (const id in obj) {
                            if (!Object.prototype.hasOwnProperty.call(obj, id)) {
                                continue;
                            }
                            if (obj[id] !== null) {
                                if (typeof obj[id] == 'object') {
                                    this.setStateInternal(id, obj[id].val);
                                    this.log.debug(`found state ${id} with value ${obj[id].val}`);
                                    if (id.endsWith(`${this.stateVehicleSoC}`)) {
                                        const stateForVehicleSoC = this.getStateInternal(obj[id].val);
                                        if (this.isForeignStateSpecified(stateForVehicleSoC)) {
                                            this.addForeignState(stateForVehicleSoC);
                                        }
                                    }
                                } else {
                                    this.log.error(`unexpected state value: ${obj[id]}`);
                                }
                            }
                        }
                    } else {
                        this.log.error('no states found');
                    }
                }
            });
            this.subscribeStatesAndStartWorking();
        });
    }

    /**
     * Function is called at the end of main function and will add the subscribed functions
     * of all the states of the dapter.
     */
    subscribeStatesAndStartWorking() {
        this.subscribeStates('*');

        this.stateChangeListeners[`${this.namespace}.${this.stateWallboxEnabled}`] = (_oldValue, newValue) => {
            this.sendUdpDatagram(`ena ${newValue ? 1 : 0}`, true);
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateWallboxCurrent}`] = (_oldValue, newValue) => {
            this.sendUdpDatagram(`curr ${parseInt(newValue)}`, true);
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateWallboxCurrentWithTimer}`] = (_oldValue, newValue) => {
            this.sendUdpDatagram(
                `currtime ${parseInt(newValue)} ${this.getStateDefault0(this.stateTimeForCurrentChange)}`,
                true,
            );
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateTimeForCurrentChange}`] = () => {
            // parameters (oldValue, newValue) can be ommited if not needed
            // no real action to do
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateWallboxOutput}`] = (_oldValue, newValue) => {
            this.sendUdpDatagram(`output ${newValue ? 1 : 0}`, true);
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateWallboxDisplay}`] = (_oldValue, newValue) => {
            if (newValue !== null) {
                if (typeof newValue == 'string') {
                    this.sendUdpDatagram(`display 0 0 0 0 ${newValue.replace(/ /g, '$')}`, true);
                } else {
                    this.log.error(`invalid data to send to display: ${newValue}`);
                }
            }
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateWallboxDisabled}`] = (_oldValue, newValue) => {
            this.log.debug(`set ${this.stateWallboxDisabled} to ${newValue}`);
            // no real action to do
        };
        this.stateChangeListeners[`${this.namespace}.${this.statePvAutomatic}`] = (_oldValue, newValue) => {
            this.log.debug(`set ${this.statePvAutomatic} to ${newValue}`);
            // no real action to do
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateSetEnergy}`] = (_oldValue, newValue) => {
            this.sendUdpDatagram(`setenergy ${parseInt(newValue) * 10}`, true);
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateReport}`] = (_oldValue, newValue) => {
            this.sendUdpDatagram(`report ${newValue}`, true);
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateStart}`] = (_oldValue, newValue) => {
            this.sendUdpDatagram(`start ${newValue}`, true);
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateStop}`] = (_oldValue, newValue) => {
            this.sendUdpDatagram(`stop ${newValue}`, true);
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateSetDateTime}`] = (_oldValue, newValue) => {
            this.sendUdpDatagram(`setdatetime ${newValue}`, true);
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateUnlock}`] = () => {
            this.sendUdpDatagram('unlock', true);
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateX2Source}`] = (_oldValue, newValue) => {
            this.sendUdpDatagram(`x2src ${newValue}`, true);
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateX2Switch}`] = (_oldValue, newValue) => {
            this.sendUdpDatagram(`x2 ${newValue}`, true);
            this.setStateAck(this.state1p3pSwTimestamp, new Date().toString());
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateAddPower}`] = (_oldValue, newValue) => {
            this.log.debug(`set ${this.stateAddPower} to ${newValue}`);
            // no real action to do
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateManualPhases}`] = (_oldValue, newValue) => {
            this.log.debug(`set ${this.stateManualPhases} to ${newValue}`);
            // no real action to do
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateLimitCurrent}`] = (_oldValue, newValue) => {
            this.log.debug(`set ${this.stateLimitCurrent} to ${newValue}`);
            // no real action to do
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateManual1p3p}`] = (_oldValue, newValue) => {
            this.log.debug(`set ${this.stateManual1p3p} to ${newValue}`);
            // no real action to do
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateLimitCurrent1p}`] = (_oldValue, newValue) => {
            this.log.debug(`set ${this.stateLimitCurrent1p} to ${newValue}`);
            // no real action to do
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateBatteryStrategy}`] = (_oldValue, newValue) => {
            this.log.debug(`set ${this.stateBatteryStrategy} to ${newValue}`);
            // no real action to do
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateMsgFromOtherwallbox}`] = (_oldValue, newValue) => {
            this.handleWallboxExchange(newValue);
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateMinimumSoCOfBatteryStorage}`] = (
            _oldValue,
            newValue,
        ) => {
            this.log.debug(`set ${this.stateMinimumSoCOfBatteryStorage} to ${newValue}`);
            // no real action to do
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateVehicleSoC}`] = (_oldValue, newValue) => {
            this.log.debug(`set ${this.stateVehicleSoC} to ${newValue}`);
            // no real action to do
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateTargetSoC}`] = (_oldValue, newValue) => {
            this.log.debug(`set ${this.stateTargetSoC} to ${newValue}`);
            // no real action to do
        };
        this.stateChangeListeners[`${this.namespace}.${this.stateResetTargetSoC}`] = (_oldValue, newValue) => {
            this.log.debug(`set ${this.stateResetTargetSoC} to ${newValue}`);
            // no real action to do
        };

        //sendUdpDatagram('i');   only needed for discovery
        this.requestReports();
        this.enableChargingTimer(this.isPassive ? this.intervalPassiveUpdate : this.intervalActiceUpdate);
    }

    /**
     * Function which checks weahter the state given by the parameter is defined in the adapter.config page.
     *
     * @param stateValue is a string with the value of the state.
     * @returns true if the state is specified.
     */
    isForeignStateSpecified(stateValue) {
        return (
            stateValue &&
            stateValue !== null &&
            typeof stateValue == 'string' &&
            stateValue !== '' &&
            stateValue !== '[object Object]'
        );
    }

    /**
     * Function calls addForeignState which subscribes a foreign state to write values
     * in 'currentStateValues'
     *
     * @param stateName is a string with the name of the state.
     * @returns returns true if the function addForeingnState was executed successful
     */
    addForeignStateFromConfig(stateName) {
        if (this.isForeignStateSpecified(stateName)) {
            if (this.addForeignState(stateName)) {
                return true;
            }
            this.log.error(`Error when adding foreign state "${stateName}"`);
            return false;
        }
        return true;
    }

    /**
     * Function is called by onAdapterReady. Check if config data is fine for adapter start
     *
     * @returns returns true if everything is fine
     */
    checkConfig() {
        let everythingFine = true;
        if (this.config.host == '0.0.0.0' || this.config.host == '127.0.0.1') {
            this.log.warn(`Can't start adapter for invalid IP address: ${this.config.host}`);
            everythingFine = false;
        }
        if (this.config.loadChargingSessions === true) {
            this.loadChargingSessions = true;
        }
        this.isPassive = false;
        if (this.config.passiveMode) {
            this.isPassive = true;
            if (everythingFine) {
                this.log.info('starting charging station in passive mode');
            }
            if (this.config.pollInterval > 0) {
                this.intervalPassiveUpdate = this.getNumber(this.config.pollInterval) * 1000;
            }
        } else {
            if (everythingFine) {
                this.log.info('starting charging station in active mode');
            }
        }
        if (this.isForeignStateSpecified(this.config.stateRegard)) {
            this.photovoltaicsActive = true;
            everythingFine = this.addForeignStateFromConfig(this.config.stateRegard) && everythingFine;
        }
        if (this.isForeignStateSpecified(this.config.stateSurplus)) {
            this.photovoltaicsActive = true;
            everythingFine = this.addForeignStateFromConfig(this.config.stateSurplus) && everythingFine;
        }
        if (this.photovoltaicsActive) {
            everythingFine = this.init1p3pSwitching(this.config.state1p3pSwitch) && everythingFine;
            everythingFine = this.addForeignStateFromConfig(this.config.stateBatteryCharging) && everythingFine;
            everythingFine = this.addForeignStateFromConfig(this.config.stateBatteryDischarging) && everythingFine;
            everythingFine = this.addForeignStateFromConfig(this.config.stateBatterySoC) && everythingFine;
            if (
                this.isForeignStateSpecified(this.config.stateBatteryCharging) ||
                this.isForeignStateSpecified(this.config.stateBatteryDischarging) ||
                this.config.batteryPower > 0
            ) {
                this.batteryStrategy = this.config.batteryStorageStrategy;
            }
            if (this.config.useX1forAutomatic) {
                this.useX1switchForAutomatic = true;
            } else {
                this.useX1switchForAutomatic = false;
            }
            if (!this.config.delta || this.config.delta <= 50) {
                this.log.info(`amperage delta not speficied or too low, using default value of ${this.amperageDelta}`);
            } else {
                this.amperageDelta = this.getNumber(this.config.delta);
            }
            if (!this.config.minAmperage || this.config.minAmperage == 0) {
                this.log.info(`using default minimum amperage of ${this.minAmperageDefault}`);
                this.minAmperage = this.minAmperageDefault;
            } else if (this.config.minAmperage < this.minAmperage) {
                this.log.info(`minimum amperage not speficied or too low, using default value of ${this.minAmperage}`);
            } else {
                this.minAmperage = this.getNumber(this.config.minAmperage);
            }
            if (this.config.addPower !== 0) {
                this.setStateAck(this.stateAddPower, this.getNumber(this.config.addPower));
            }
            if (this.config.underusage !== 0) {
                this.underusage = this.getNumber(this.config.underusage);
            }
            if (!this.config.minTime || this.config.minTime < 0) {
                this.log.info(
                    `minimum charge time not speficied or too low, using default value of ${this.minChargeSeconds}`,
                );
            } else {
                this.minChargeSeconds = this.getNumber(this.config.minTime);
            }
            if (!this.config.regardTime || this.config.regardTime < 0) {
                this.log.info(
                    `minimum grid consumption time not speficied or too low, using default value of ${this.minConsumptionSeconds}`,
                );
            } else {
                this.minConsumptionSeconds = this.getNumber(this.config.regardTime);
            }
        }

        if (this.isX2PhaseSwitch()) {
            if (this.isForeignStateSpecified(this.config.state1p3pSwitch)) {
                everythingFine = false;
                this.log.error('both, state for 1p/3p switch and switching via X2, must not be specified together');
            }
            const valueOn = 1;
            const valueOff = 0;
            this.valueFor1p3pOff = valueOff;
            if (this.config['1p3pSwitchIsNO'] === true) {
                this.valueFor1pCharging = valueOff;
                this.valueFor3pCharging = valueOn;
            } else {
                this.valueFor1pCharging = valueOn;
                this.valueFor3pCharging = valueOff;
            }

            this.min1p3pSwSec = 305;
            this.log.info(`Using min time between phase switching of: ${this.min1p3pSwSec} sec`);
        }

        if (this.isEnWGDefined()) {
            everythingFine = this.addForeignStateFromConfig(this.config.stateEnWG) && everythingFine;
        }

        if (this.config.maxPower && this.config.maxPower > 0) {
            this.maxPowerActive = true;
            if (this.config.maxPower <= 0) {
                this.log.warn('max. power negative or zero - power limitation deactivated');
                this.maxPowerActive = false;
            }
        }
        if (this.maxPowerActive) {
            everythingFine = this.addForeignStateFromConfig(this.config.stateEnergyMeter1) && everythingFine;
            everythingFine = this.addForeignStateFromConfig(this.config.stateEnergyMeter2) && everythingFine;
            everythingFine = this.addForeignStateFromConfig(this.config.stateEnergyMeter3) && everythingFine;
            if (this.config.wallboxNotIncluded) {
                this.wallboxIncluded = false;
            } else {
                this.wallboxIncluded = true;
            }
            if (everythingFine) {
                if (
                    !(
                        this.isForeignStateSpecified(this.config.stateEnergyMeter1) ||
                        this.isForeignStateSpecified(this.config.stateEnergyMeter2) ||
                        this.isForeignStateSpecified(this.config.stateEnergyMeter3)
                    )
                ) {
                    this.log.error('no energy meters defined - power limitation deactivated');
                    this.maxPowerActive = false;
                }
            }
        }

        if (this.config.maxAmperage && this.config.maxAmperage > 0) {
            this.maxAmperageActive = true;
            if (this.config.maxAmperage <= 0) {
                this.log.warn('max. current negative or zero - current limitation deactivated');
                this.maxAmperageActive = false;
            }
        }
        if (this.maxAmperageActive) {
            everythingFine = this.addForeignStateFromConfig(this.config.stateAmperagePhase1) && everythingFine;
            everythingFine = this.addForeignStateFromConfig(this.config.stateAmperagePhase2) && everythingFine;
            everythingFine = this.addForeignStateFromConfig(this.config.stateAmperagePhase3) && everythingFine;
            if (everythingFine) {
                if (
                    !(
                        this.isForeignStateSpecified(this.config.stateAmperagePhase1) &&
                        this.isForeignStateSpecified(this.config.stateAmperagePhase2) &&
                        this.isForeignStateSpecified(this.config.stateAmperagePhase3)
                    )
                ) {
                    this.log.error('not all energy meters defined - amperage limitation deactivated');
                    this.maxAmperageActive = false;
                }
            }
        }

        return everythingFine;
    }

    /**
     * Writes text to log with info or debug level depending on config setting "lessInfoLogs"
     *
     * @param text text to be logged
     */
    logInfoOrDebug(text) {
        if (this.config.lessInfoLogs === true) {
            this.log.debug(text);
        } else {
            this.log.info(text);
        }
    }

    init1p3pSwitching(stateNameFor1p3p) {
        if (!this.isForeignStateSpecified(stateNameFor1p3p)) {
            return true;
        }
        if (!this.addForeignStateFromConfig(stateNameFor1p3p)) {
            return false;
        }
        this.getForeignState(stateNameFor1p3p, (err, obj) => {
            if (err) {
                this.log.error(`error reading state ${stateNameFor1p3p}: ${err}`);
                return;
            }
            if (obj) {
                this.stateFor1p3pCharging = stateNameFor1p3p;
                let valueOn;
                let valueOff;
                if (typeof obj.val == 'boolean') {
                    valueOn = true;
                    valueOff = false;
                } else if (typeof obj.val == 'number') {
                    valueOn = 1;
                    valueOff = 0;
                } else {
                    this.log.error(`unhandled type ${typeof obj.val} for state ${stateNameFor1p3p}`);
                    return;
                }
                this.stateFor1p3pAck = obj.ack;
                this.valueFor1p3pOff = valueOff;
                if (this.config['1p3pSwitchIsNO'] === true) {
                    this.valueFor1pCharging = valueOff;
                    this.valueFor3pCharging = valueOn;
                } else {
                    this.valueFor1pCharging = valueOn;
                    this.valueFor3pCharging = valueOff;
                }
            } else {
                this.log.error(`state ${stateNameFor1p3p} not found!`);
            }
        });
        return true;
    }

    // subscribe a foreign state to save values in 'currentStateValues'
    addForeignState(id) {
        if (typeof id !== 'string') {
            return false;
        }
        if (id == '' || id == ' ') {
            return false;
        }
        this.getForeignState(id, (err, obj) => {
            if (err) {
                this.log.error(`error subscribing ${id}: ${err}`);
            } else {
                if (obj) {
                    this.log.debug(`subscribe state ${id} - current value: ${obj.val}`);
                    this.setStateInternal(id, obj.val);
                    this.subscribeForeignStates(id); // there's no return value (success, ...)
                    //adapter.subscribeForeignStates({id: id, change: 'ne'}); // condition is not working
                } else {
                    this.log.error(`state ${id} not found!`);
                }
            }
        });
        return true;
    }

    isMessageFromWallboxOfThisInstance(remote) {
        return remote.address == this.config.host;
    }

    sendMessageToOtherInstance(message, remote) {
        // save message for other instances by setting value into state
        const prefix = 'system.adapter.';
        const adapterpart = `${this.name}.`;
        const suffix = '.uptime';
        this.getForeignObjects(`${prefix + adapterpart}*${suffix}`, (err, objects) => {
            if (err) {
                this.log.error(`Error while fetching other instances: ${err}`);
                return;
            }
            if (objects) {
                for (const item in objects) {
                    if (Object.prototype.hasOwnProperty.call(objects, item) && item.endsWith(suffix)) {
                        const namespace = item.slice(prefix.length, -suffix.length);
                        this.getForeignObject(prefix + namespace, (err, object) => {
                            if (err) {
                                this.log.error(`Error while fetching other instances: ${err}`);
                                return;
                            }
                            if (object) {
                                if (Object.prototype.hasOwnProperty.call(object, 'native')) {
                                    if (Object.prototype.hasOwnProperty.call(object.native, 'host')) {
                                        if (object.native.host == remote.address) {
                                            this.setForeignState(
                                                `${namespace}.${this.stateMsgFromOtherwallbox}`,
                                                message.toString().trim(),
                                            );
                                            this.log.debug(`Message from ${remote.address} send to ${namespace}`);
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
    handleWallboxMessage(message, remote) {
        this.log.debug(`UDP datagram from ${remote.address}:${remote.port}: "${message}"`);
        if (this.isMessageFromWallboxOfThisInstance(remote)) {
            // handle only message from wallbox linked to this instance, ignore other wallboxes sending broadcasts
            // Mark that connection is established by incomming data
            this.handleMessage(message, 'received');
        } else {
            this.sendMessageToOtherInstance(message, remote);
        }
    }

    // handle incomming broadcast message from wallbox
    handleWallboxBroadcast(message, remote) {
        this.log.debug(`UDP broadcast datagram from ${remote.address}:${remote.port}: "${message}"`);
        if (this.isMessageFromWallboxOfThisInstance(remote)) {
            // handle only message from wallbox linked to this instance, ignore other wallboxes sending broadcasts
            this.handleMessage(message, 'broadcast');
        }
    }

    // handle incomming message from other instance for this wallbox
    handleWallboxExchange(message) {
        this.log.debug(`datagram from other instance: "${message}"`);
        this.handleMessage(message, 'instance');
    }

    handleMessage(message, origin) {
        // Mark that connection is established by incomming data
        this.setState('info.connection', true, true);
        let msg;
        try {
            msg = message.toString().trim();
            if (msg.length === 0) {
                return;
            }

            if (msg == 'started ...') {
                this.log.info('Wallbox startup complete');
                return;
            }

            if (msg == 'i') {
                this.log.debug(`Received: ${message}`);
                return;
            }

            if (msg.startsWith('TCH-OK')) {
                this.log.debug(`Received ${message}`);
                return;
            }

            if (msg.startsWith('TCH-ERR')) {
                this.log.error(`Error received from wallbox: ${message}`);
                return;
            }

            if (msg[0] == '"') {
                msg = `{ ${msg} }`;
            }

            this.handleJsonMessage(JSON.parse(msg));
        } catch (e) {
            this.log.warn(`Error handling ${origin} message: ${e} (${msg})`);
            return;
        }
    }

    async handleJsonMessage(message) {
        // message auf ID Kennung für Session History prüfen
        if (message.ID >= 100 && message.ID <= 130) {
            this.log.debug(`History ID received: ${message.ID.substr(1)}`);
            const sessionid = message.ID.substr(1);
            if (this.loadChargingSessions) {
                this.updateState(this.states[`${sessionid}_json`], JSON.stringify([message]));
            }
            for (const key in message) {
                if (this.states[`${sessionid}_${key}`] || this.loadChargingSessions === false) {
                    try {
                        if (message.ID == 100) {
                            // process some values of current charging session
                            switch (key) {
                                case 'Session ID':
                                    this.setStateAck(this.stateSessionId, message[key]);
                                    break;
                                case 'RFID tag':
                                    this.setStateAck(this.stateRfidTag, message[key]);
                                    break;
                                case 'RFID class':
                                    this.setStateAck(this.stateRfidClass, message[key]);
                                    break;
                            }
                        }
                        if (this.loadChargingSessions) {
                            this.updateState(this.states[`${sessionid}_${key}`], message[key]);
                        }
                    } catch (e) {
                        this.log.warn(`Couldn"t update state ` + `Session_${sessionid}.${key}: ${e}`);
                    }
                } else if (key != 'ID') {
                    this.log.warn(`Unknown Session value received: ${key}=${message[key]}`);
                }
            }
        } else {
            for (const key in message) {
                if (this.states[key]) {
                    try {
                        await this.updateState(this.states[key], message[key]);
                        if (key == 'X2 phaseSwitch source' && this.isX2PhaseSwitch()) {
                            const currentValue = this.getStateDefault0(this.states[key]._id);
                            if (currentValue !== 4) {
                                this.log.info(`activating X2 source from ${currentValue} to 4 for phase switching`);
                                this.sendUdpDatagram('x2src 4', true);
                            }
                        }
                    } catch (e) {
                        this.log.warn(`Couldn"t update state ${key}: ${e}`);
                    }
                } else if (key != 'ID') {
                    this.log.warn(`Unknown value received: ${key}=${message[key]}`);
                }
            }
            if (message.ID == 3) {
                // Do calculation after processing 'report 3'
                this.checkWallboxPower();
            }
        }
    }

    /**
     * Return battery storage strategy to be used (from state or from settings)
     *
     * @returns number of strategy (1-4) or 0 if none
     */
    getBatteryStorageStrategy() {
        const strategy = this.getStateDefault0(this.stateBatteryStrategy);
        if (strategy > 0) {
            return strategy;
        }
        return this.batteryStrategy;
    }

    /**
     * Return whether battery is not to be used and vehicle is priorized
     *
     * @returns true if this mode is activated
     */
    isNotUsingBatteryWithPrioOnVehicle() {
        return this.getBatteryStorageStrategy() == 1;
    }

    /**
     * Return whether battery is not to be used and battery is priorized before vehicle
     *
     * @returns true if this mode is activated
     */
    isNotUsingBatteryWithPrioOnBattery() {
        return this.getBatteryStorageStrategy() == 2;
    }

    /**
     * Return whether battery is not to be used and vehicle is priorized
     *
     * @returns true if this mode is activated
     */
    isUsingBatteryForMinimumChargingOfVehicle() {
        return this.getBatteryStorageStrategy() == 3;
    }

    /**
     * Return whether battery is not to be used and vehicle is priorized
     *
     * @returns true if this mode is activated
     */
    isUsingBatteryForFullChargingOfVehicle() {
        return this.getBatteryStorageStrategy() == 4;
    }

    /**
     * Get the minimum current for wallbox
     *
     * @returns the  minimum amperage to start charging session in mA
     */
    getMinCurrent() {
        return this.minAmperage;
    }

    /**
     * Get maximum current for wallbox (hardware defined by dip switch) min. of stateWallboxMaxCurrent and stateLimitCurrent
     *
     * @returns the  maxium allowed charging current in mA
     */
    getMaxCurrent() {
        let max = this.getStateDefault0(this.stateWallboxMaxCurrent);
        let limit = this.getStateDefault0(this.stateLimitCurrent);
        if (this.has1P3PAutomatic() && this.isReducedChargingBecause1p3p()) {
            const limit1p = this.getStateDefault0(this.stateLimitCurrent1p);
            if (limit1p > 0) {
                limit = limit1p;
            }
        }
        if (limit > 0 && limit < max) {
            max = limit;
        }
        return max;
    }

    /**
     * get tagetSoC for charging session.
     * Checks if a value for vehicleSoC is specified and return value from target SoC
     */
    getTagetSoC() {
        const targetSoC = this.getStateDefault0(this.stateTargetSoC);
        if (targetSoC == 0) {
            return 0;
        }
        if (this.getVehicleSoC() < 100) {
            return targetSoC;
        }
        return 0;
    }

    /**
     * get current SoC for vehicle.
     * If define get SoC of vehicle (or 100% if not)
     */
    getVehicleSoC() {
        const stateVehicleSoC = this.getStateInternal(this.stateVehicleSoC);
        this.log.debug(`vehicle SoC state value: ${stateVehicleSoC}`);
        if (stateVehicleSoC) {
            if (typeof stateVehicleSoC !== 'string' || stateVehicleSoC.trim() === '') {
                return 100;
            }
        } else {
            return 100;
        }
        const vehicleSoC = this.getStateDefault0(stateVehicleSoC);
        this.log.debug(`vehicle SoC value: ${vehicleSoC}`);
        if (typeof vehicleSoC !== 'number' || vehicleSoC == 0) {
            return 100;
        }
        return vehicleSoC;
    }

    /**
     * true, if taget SoC is to be resetted after vehicles reaches target SoC
     */
    isResetTargetSoC() {
        return this.getStateDefaultFalse(this.stateResetTargetSoC);
    }

    /**
     * Reset targetSoc to zero
     */
    resetTargetSoC() {
        this.setStateAck(this.stateTargetSoC, 0);
    }

    resetChargingSessionData() {
        this.setStateAck(this.stateChargeTimestamp, null);
        this.setStateAck(this.stateConsumptionTimestamp, null);
    }

    saveChargingSessionData() {
        const plugTimestamp = this.getStateAsDate(this.statePlugTimestamp);
        if (plugTimestamp == null) {
            this.setStateAck(this.stateLastChargeStart, null);
        } else {
            this.setStateAck(this.stateLastChargeStart, plugTimestamp.toString());
        }
        this.setStateAck(this.stateLastChargeFinish, new Date().toString());
        this.setStateAck(this.stateLastChargeAmount, this.getStateDefault0(this.stateWallboxChargeAmount) / 1000);
    }

    stopCharging() {
        this.regulateWallbox(0);
        this.resetChargingSessionData();
    }

    regulateWallbox(milliAmpere) {
        let oldValue = 0;
        if (this.getStateDefaultFalse(this.stateWallboxEnabled) || this.getStateDefault0(this.stateWallboxState) == 3) {
            oldValue = this.getStateDefault0(this.stateWallboxCurrent);
        }

        if (this.isNoChargingDueToInteruptedStateOfWallbox(milliAmpere)) {
            if (milliAmpere > 0) {
                this.log.debug('No charging due to interupted charging station');
            }
            milliAmpere = 0;
        }

        if (milliAmpere != oldValue) {
            if (milliAmpere == 0) {
                this.log.info(`stop charging ${this.isMaxPowerCalculation === true ? ' (maxPower)' : ''}`);
            } else if (oldValue == 0) {
                this.log.info(
                    `(re)start charging with ${milliAmpere}mA${this.isMaxPowerCalculation === true ? ' (maxPower)' : ''}`,
                );
            } else {
                const text = `regulate wallbox from ${oldValue} to ${milliAmpere}mA${
                    this.isMaxPowerCalculation === true ? ' (maxPower)' : ''
                }`;
                if (this.isMaxPowerCalculation === true && !this.isVehiclePlugged()) {
                    this.log.debug(text);
                } else {
                    this.logInfoOrDebug(text);
                }
            }
            this.sendUdpDatagram(`currtime ${milliAmpere} 1`, true);
        }
    }

    initChargingSession() {
        this.resetChargingSessionData();
        this.setStateAck(this.statePlugTimestamp, new Date().toString());
        this.setStateAck(this.stateAuthPlugTimestamp, null);
        this.setStateAck(this.stateSessionId, null);
        this.setStateAck(this.stateRfidTag, null);
        this.setStateAck(this.stateRfidClass, null);
        this.displayChargeMode();
    }

    finishChargingSession() {
        this.saveChargingSessionData();
        this.setStateAck(this.statePlugTimestamp, null);
        this.setStateAck(this.stateAuthPlugTimestamp, null);
        this.resetChargingSessionData();
    }

    /**
     * Return the amount of watts used for charging. Value is calculated for TYPE_D_EDITION wallbox and returned by the box itself for others.
     *
     * @returns the power in watts, with which the wallbox is currently charging.
     */
    getWallboxPowerInWatts() {
        if (this.getWallboxType() == this.TYPE_D_EDITION) {
            if (this.isVehiclePlugged() && this.getStateDefault0(this.stateWallboxState) == 3) {
                return (
                    (this.getStateDefault0(this.stateWallboxCurrent) * this.voltage * this.getChargingPhaseCount()) /
                    1000
                );
            }
            return 0;
        }
        return this.getStateDefault0(this.stateWallboxPower) / 1000;
    }

    /**
     * Get minimum SoC of battery storage above which it may be used for charging vehicle
     *
     * @returns SoC
     */
    getMinimumBatteryStorageSocForCharging() {
        const dynamicValue = this.getStateDefault0(this.stateMinimumSoCOfBatteryStorage);
        const fixValue = this.config.batteryMinSoC;
        let value;
        if (dynamicValue > 0 && dynamicValue >= fixValue) {
            value = dynamicValue;
        } else {
            value = fixValue;
        }
        if (value > 0 && value <= 100) {
            return value;
        }
        return 0;
    }

    /**
     * Get delta to add to available power to ignore battery power (fullPowerRequested === false) or to work with surplus plus power
     * of battery storage.
     *
     * @param isFullPowerRequested if checked then maximum available power of battery storage will be returned
     * @returns delta to be added to surplus for available power for charging vehicle.
     */
    getBatteryStoragePower(isFullPowerRequested) {
        // Beispiel: Surplus = 2000W
        // Batterie entladen mit 1000W
        // Max. Leistung Batterie: 2500W
        const batteryPower =
            this.getStateDefault0(this.config.stateBatteryCharging) -
            this.getStateDefault0(this.config.stateBatteryDischarging);
        if (this.isNotUsingBatteryWithPrioOnBattery()) {
            if (this.getStateDefault0(this.config.stateBatterySoC) >= this.config.batteryLimitSoC) {
                if (batteryPower > 0) {
                    return 0;
                }
            } else {
                return batteryPower - this.getBatteryChargePower();
            }
        } else if (
            this.isNotUsingBatteryWithPrioOnVehicle() ||
            (this.isUsingBatteryForMinimumChargingOfVehicle() && isFullPowerRequested === false)
        ) {
            return batteryPower;
        } else if (
            this.isUsingBatteryForFullChargingOfVehicle() ||
            (this.isUsingBatteryForMinimumChargingOfVehicle() && isFullPowerRequested === true)
        ) {
            const maxBatteryPower =
                this.getStateDefault0(this.config.stateBatterySoC) > this.getMinimumBatteryStorageSocForCharging()
                    ? this.getBatteryDischargePower()
                    : 0;
            return maxBatteryPower + batteryPower;
        } else {
            return 0;
        }
        return batteryPower;
    }

    /**
     * Get power that battery can deliver at maximum
     *
     * @returns power in watts with which battery can be discharged
     */
    getBatteryDischargePower() {
        return this.config.batteryPower;
    }

    /**
     * Get power with which battery can be charged at maximum
     *
     * @returns power in watts with which battery can be charged
     */
    getBatteryChargePower() {
        if (this.config.batteryChargePower > 0) {
            return this.config.batteryChargePower;
        }
        return this.config.batteryPower;
    }

    /**
     * The available surplus is calculated and returned not considering the used power for charging. If configured the availabe storage power is added.
     *
     * @param isFullBatteryStoragePowerRequested if checked then maximum available power of the battery is added
     * @returns the available surplus without considering the wallbox power currently used for charging or negative value is case of grid consumption.
     */
    getSurplusWithoutWallbox(isFullBatteryStoragePowerRequested = false) {
        let power =
            this.getStateDefault0(this.config.stateSurplus) -
            this.getStateDefault0(this.config.stateRegard) +
            this.getBatteryStoragePower(isFullBatteryStoragePowerRequested);
        if (this.config.statesIncludeWallbox) {
            power += this.getWallboxPowerInWatts();
        }
        return power;
    }

    /**
     * The available totoal power is calculated base on EnergyMeters without wallbox power.
     *
     * @returns the available power in watts not including the wallbox power itself.
     */
    getTotalPower() {
        let result =
            this.getStateDefault0(this.config.stateEnergyMeter1) +
            this.getStateDefault0(this.config.stateEnergyMeter2) +
            this.getStateDefault0(this.config.stateEnergyMeter3);
        if (this.wallboxIncluded) {
            result -= this.getWallboxPowerInWatts();
        }
        return result;
    }

    /**
     * If the maximum power available is defined and max power limitation is active, a reduced value is returned, otherwise no real limit.
     *
     * @returns the total power available in watts
     */
    getTotalPowerAvailable() {
        // Wenn keine Leistungsbegrenzung eingestelt ist, dann max. liefern
        if (this.maxPowerActive && this.config.maxPower > 0) {
            this.lastPower = this.getTotalPower();
            return this.config.maxPower - this.lastPower;
        }
        return 999999; // return default maximum
    }

    /**
     * Return factor for calculation maxAmperage with values from energy meter
     *
     * @returns factor for multiplying value to bring them to mA
     */
    getAmperageFactor() {
        return this.config.amperageUnit === 'A' ? 1000 : 1;
    }

    /**
     * If max amperage limitation is active, a reduced value is returned, otherwise no real limit.
     *
     * @returns the total current available in mA
     */
    getTotalAmperageAvailable() {
        // Wenn keine Leistungsbegrenzung eingestelt ist, dann max. liefern
        if (this.maxAmperageActive && this.config.maxAmperage > 0) {
            if (this.getWallboxType() === this.TYPE_D_EDITION) {
                this.log.warn('Amperage limitation not possible with Keba Deutschland-Edition! Limitation disabled.');
                this.maxAmperageActive = false;
            } else {
                const amperageFactor = this.getAmperageFactor();
                this.lastAmperagePhase1 = this.getStateDefault0(this.config.stateAmperagePhase1) * amperageFactor;
                this.lastAmperagePhase2 = this.getStateDefault0(this.config.stateAmperagePhase2) * amperageFactor;
                this.lastAmperagePhase3 = this.getStateDefault0(this.config.stateAmperagePhase3) * amperageFactor;
                const amperageWallbox1 = this.getStateDefault0(this.stateWallboxPhase1);
                const amperageWallbox2 = this.getStateDefault0(this.stateWallboxPhase2);
                const amperageWallbox3 = this.getStateDefault0(this.stateWallboxPhase3);
                const amperageAvailable1 = this.config.maxAmperage - (this.lastAmperagePhase1 - amperageWallbox1);
                const amperageAvailable2 = this.config.maxAmperage - (this.lastAmperagePhase2 - amperageWallbox2);
                const amperageAvailable3 = this.config.maxAmperage - (this.lastAmperagePhase3 - amperageWallbox3);
                this.log.debug(
                    `amperage of mains: ${this.lastAmperagePhase1}/${this.lastAmperagePhase2}/${
                        this.lastAmperagePhase3
                    }, amperage of charging station: ${amperageWallbox1}/${amperageWallbox2}/${
                        amperageWallbox3
                    } => available: ${amperageAvailable1}/${amperageAvailable2}/${amperageAvailable3}`,
                );
                return this.getRoundedAmperage(
                    Math.min(amperageAvailable1, amperageAvailable2, amperageAvailable3),
                    true,
                );
            }
        }
        return this.getRoundedAmperage(this.getMaxCurrent(), true); // return default maximum
    }

    /**
     * If the §14a EnWG is active calculate max current
     *
     * @returns the total current available in mA
     */
    getMaxCurrentEnWG() {
        if (this.isEnWGDefined() && this.isEnWGActive()) {
            if (this.config.dynamicEnWG === true) {
                const allowedPower = (3 * this.voltage * this.maxCurrentEnWG) / 1000;
                return this.getAmperage(allowedPower + this.getSurplusWithoutWallbox(), this.get1p3pPhases(), true);
            }
            return this.maxCurrentEnWG;
        }
        return -1; // no value defined
    }

    /**
     * Return, if a possible power limitation according to §14a EnWG was activated by the common carrier
     *
     * @returns true, if EnWG limitation is defined and active
     */
    isEnWGActive() {
        const stateName = this.config.stateEnWG;
        const value = this.getStateInternal(stateName);
        if (typeof value == 'boolean') {
            return value;
        } else if (typeof value == 'number') {
            return value > 0;
        }
        this.log.error(`unhandled type ${typeof value} for state ${stateName}`);
        return false;
    }

    /**
     * resets values for 1p/3p switching
     */
    reset1p3pSwitching() {
        this.stepFor1p3pSwitching = 0;
        this.retries1p3pSwitching = 0;
    }

    /**
     * Advances variables to next step of 1p/3p switching
     */
    doNextStepOf1p3pSwitching() {
        this.stepFor1p3pSwitching++;
        this.retries1p3pSwitching = 0;
    }

    /**
     * Returns whether phase switching is done via X2 of charging station
     *
     * @returns true, if switch is done via X2
     */
    isX2PhaseSwitch() {
        return this.config['1p3pViaX2'] === true;
    }

    /**
     * Returns whether EnWG limitation is defined in config
     *
     * @returns true, if EnWG limiting is defined oin config
     */
    isEnWGDefined() {
        return this.isForeignStateSpecified(this.config.stateEnWG);
    }

    /**
     * set a new value for 1p/3p switching. Ignored, if not active.
     *
     * @param newValue new value for 1p/3p switch
     * @returns true, if switching is in progress, false when nothing to do
     */
    set1p3pSwitching(newValue) {
        if (!this.has1P3PAutomatic() || this.stepFor1p3pSwitching < 0) {
            return false;
        }
        if (newValue !== null) {
            if (this.isX2PhaseSwitch()) {
                if (newValue != this.getStateDefault0(this.stateX2Switch)) {
                    this.setStateAck(this.state1p3pSwTimestamp, new Date().toString());
                    this.log.info(
                        `updating X2 for switch of phases from ${this.getStateDefault0(this.stateX2Switch)} to ${newValue}...`,
                    );
                    this.sendUdpDatagram(`x2 ${newValue}`, true);
                }
            } else {
                if (newValue !== this.getStateInternal(this.stateFor1p3pCharging)) {
                    if (newValue !== this.valueFor1p3pSwitching) {
                        this.stepFor1p3pSwitching = 1;
                        this.valueFor1p3pSwitching = newValue;
                    }
                }
            }
        }
        return this.check1p3pSwitching();
    }

    /**
     * Checks whether it's ok to proceed or processing should stop to wait for 1p/3p switching.
     *
     * @returns true, if switching is in progress, false when nothing to do
     */
    check1p3pSwitching() {
        if (!this.has1P3PAutomatic() || this.isX2PhaseSwitch()) {
            if (this.stepFor1p3pSwitching >= 0) {
                this.reset1p3pSwitching(); // don't reset -1 value
            }
            return false;
        }
        if (this.stepFor1p3pSwitching <= 0) {
            return false;
        }
        switch (this.stepFor1p3pSwitching) {
            case 1:
                if (this.isVehicleCharging()) {
                    if (this.retries1p3pSwitching == 0) {
                        this.log.info('stop charging for switch of phases ...');
                        this.stopCharging();
                    } else {
                        this.check1p3pSwitchingRetries();
                    }
                    return true;
                }
                this.doNextStepOf1p3pSwitching();
            // falls through
            case 2:
                if (
                    this.valueFor1p3pSwitching !== this.getStateInternal(this.stateFor1p3pCharging) &&
                    this.stateFor1p3pCharging !== null
                ) {
                    this.stateFor1p3pAck = false;
                    this.log.info(`switching 1p3p to ${this.valueFor1p3pSwitching} ...`);
                    this.setForeignState(this.stateFor1p3pCharging, this.valueFor1p3pSwitching);
                    this.doNextStepOf1p3pSwitching();
                    return true;
                }
                this.doNextStepOf1p3pSwitching();
            // falls through
            case 3:
                if (!this.stateFor1p3pAck) {
                    this.check1p3pSwitchingRetries();
                    return true;
                }
                this.reset1p3pSwitching();
                this.log.info('switch 1p/3p successfully completed.');
                break;
            default:
                this.log.error(`unknown step for 1p/3p switching: ${this.stepFor1p3pSwitching}`);
                this.reset1p3pSwitching();
        }
        return false;
    }

    /**
     * Return the current for 1 phase to switch to 3 phases charging (lower when only 2 phases in effect for charging)
     *
     * @returns current from which to switch to 3p in mA
     */
    getCurrentForSwitchTo3p() {
        return this.getMinCurrent() * this.get1p3pPhases() * 1.1;
    }

    /**
     * Is adapter configured to be able to switch between 1 and 3 phases charging
     *
     * @returns true, if it is possible to switch 1p/3p
     */
    has1P3PAutomatic() {
        return this.stepFor1p3pSwitching >= 0 && (this.stateFor1p3pCharging !== null || this.isX2PhaseSwitch());
    }

    /**
     * returns whether charging was switched to 1p and more than 1 phase is available for charging
     *
     * @returns true, if charging was switched to 1p and more than 1 phase is available for charging
     */
    isReducedChargingBecause1p3p() {
        if (!this.has1P3PAutomatic() || this.stepFor1p3pSwitching < 0) {
            return false;
        }
        let currentSwitch;
        if (this.isX2PhaseSwitch()) {
            currentSwitch = this.getStateDefault0(this.stateX2Switch);
        } else {
            currentSwitch = this.getStateInternal(this.stateFor1p3pCharging);
        }
        if (currentSwitch === this.valueFor1pCharging) {
            return true;
        }
        if (currentSwitch === this.valueFor3pCharging) {
            return false;
        }
        this.log.warn(`Invalid value for 1p3p switch: ${currentSwitch} (type ${typeof currentSwitch})`);
        return false;
    }

    /**
     * Return the number of phases currently possible if no switch to 1p would be in progress
     *
     * @returns number of phases for charging of 3p would be in effect
     */
    get1p3pPhases() {
        if (this.isReducedChargingBecause1p3p()) {
            let phases = this.getStateDefault0(this.stateChargingPhases);
            if (this.isVehicleCharging() && phases > 1 && this.getChargingPhaseCount() > 1) {
                this.log.error(
                    `Charging with ${phases} but reduced (1p) expected, disabling 1p/3p switch for this charging session`,
                );
                this.reset1p3pSwitching();
                this.stepFor1p3pSwitching = -1;
            }
            if (phases <= 0) {
                phases = this.getStateDefault0(this.stateManualPhases);
            }
            if (phases <= 0) {
                phases = 1;
            }
            if (phases > 3) {
                phases = 3;
            }
            return phases;
        }
        return this.getChargingPhaseCount();
    }

    /**
     * Return the number of phases currently used for charging
     *
     * @returns number of phases recognized for charging.
     */
    getChargingPhaseCount() {
        let retVal = this.getStateDefault0(this.stateChargingPhases);
        if (this.getWallboxType() == this.TYPE_D_EDITION || retVal == 0) {
            if (this.isReducedChargingBecause1p3p()) {
                retVal = 1;
            } else {
                retVal = this.getStateDefault0(this.stateManualPhases);
                if (retVal < 0) {
                    this.log.warn(`invalid manual phases count ${retVal} using 1 phases`);
                    retVal = 1;
                }
                if (retVal > 3) {
                    this.log.warn(`invalid manual phases count ${retVal} using 3 phases`);
                    retVal = 3;
                }
            }
        }

        // Number of phaes can only be calculated if vehicle is charging
        if (this.getWallboxType() != this.TYPE_D_EDITION && this.isVehicleCharging()) {
            let tempCount = 0;
            if (this.getStateDefault0(this.stateWallboxPhase1) > 250) {
                tempCount++;
            }
            if (this.getStateDefault0(this.stateWallboxPhase2) > 250) {
                tempCount++;
            }
            if (this.getStateDefault0(this.stateWallboxPhase3) > 250) {
                tempCount++;
            }
            if (tempCount > 0) {
                // save phase count and write info message if changed
                if (retVal != tempCount) {
                    this.log.debug(`wallbox is charging with ${tempCount} ${tempCount == 1 ? 'phase' : 'phases'}`);
                }
                if (!this.isReducedChargingBecause1p3p() === true) {
                    this.setStateAck(this.stateChargingPhases, tempCount);
                }
                retVal = tempCount;
            } else {
                this.log.warn('wallbox is charging but no phases where recognized');
            }
        }
        // if no phases where detected then calculate with one phase
        if (retVal <= 0) {
            this.log.debug('setting phase count to 1');
            retVal = 1;
        }
        this.log.silly(`currently charging with ${retVal} phases`);
        return retVal;
    }

    /**
     * Returns the status true if the WallboxPowerinWatts is bigger then 1000W
     *
     * @returns true if the vehicle is charing based on getWallboxPowerInWatts
     */
    isVehicleCharging() {
        return this.getWallboxPowerInWatts() > 1000;
    }

    /**
     * Check if the vehicle is plugged. Value is based on internal state stateWallboxPlug which is >= if vehicle is plugged.
     *
     * @param value own value, otherwise taken from state
     * @returns true if the vehicle is plugged
     */
    isVehiclePlugged(value = this.getStateInternal(this.stateWallboxPlug)) {
        // 0 unplugged
        // 1 plugged on charging station
        // 3 plugged on charging station plug locked
        // 5 plugged on charging station             plugged on EV
        // 7 plugged on charging station plug locked plugged on EV
        // For wallboxes with fixed cable values of 0 and 1 not used
        // Charging only possible with value of 7
        return value >= 5;
    }

    /**
     * Check if the PV Automatic is currently active or not
     *
     * @returns true if PV automatic is active
     */
    isPvAutomaticsActive() {
        if (this.isPassive === true || this.photovoltaicsActive === false) {
            return false;
        }
        if (this.useX1switchForAutomatic === true) {
            if (this.getStateDefaultFalse(this.stateX1input)) {
                return false;
            }
        }
        if (this.getStateDefaultFalse(this.statePvAutomatic)) {
            return true;
        }
        return false;
    }

    displayChargeMode() {
        if (this.isPassive) {
            return;
        }
        let text;
        if (this.isPvAutomaticsActive()) {
            text = I18n.translate(this.chargeTextAutomatic);
        } else {
            text = I18n.translate(this.chargeTextMax);
        }
        this.setState(this.stateWallboxDisplay, text);
    }

    /**
     * Returns the rounded value for charging amperage.
     *
     * @param amperage power in Watts used for calculation
     * @param forceRoundOff do not use commercial rounding but round off
     * @returns rounded value according to amperageDelta.
     */
    getRoundedAmperage(amperage, forceRoundOff = false) {
        if (forceRoundOff === true) {
            return Math.floor(amperage / this.amperageDelta) * this.amperageDelta;
        }
        return Math.round(amperage / this.amperageDelta) * this.amperageDelta;
    }

    /**
     * Returns the rounded value for charging amperage possible based on the defined power and phases given to the function.
     *
     * @param power power in Watts used for calculation
     * @param phases number of phases to be used for calculation
     * @param forceRoundOff do not use commercial rounding but round off
     * @returns the values for the amperage based on amperageDelta and parameters.
     */
    getAmperage(power, phases, forceRoundOff = false) {
        const curr = ((power / this.voltage) * 1000) / phases;
        this.log.debug(
            `power: ${power} / voltage: ${this.voltage} * 1000 / delta: ${this.amperageDelta} / phases: ${phases} * delta = ${curr}`,
        );
        return this.getRoundedAmperage(curr, forceRoundOff);
    }

    check1p3pSwitchingRetries() {
        if (this.retries1p3pSwitching >= 3) {
            this.log.error(
                `switching not possible in step ${this.stepFor1p3pSwitching}, disabling 1p/3p switch for this charging session`,
            );
            this.reset1p3pSwitching();
            this.stepFor1p3pSwitching = -1;
            return true;
        }
        this.log.info(`still waiting for 1p/3p step ${this.stepFor1p3pSwitching} to complete...`);
        this.retries1p3pSwitching++;
        return false;
    }

    /**
     * Checks whether charging should continue because minimum charging time was not yet reached
     *
     * @param aktDate current time as Date object
     * @param chargeTimestamp time when vehicle started to charge or null if vehicle is not charging
     * @returns true if minimum charging time was not yet reached
     */
    isContinueDueToMinChargingTime(aktDate, chargeTimestamp) {
        if (this.minChargeSeconds <= 0 || chargeTimestamp == null) {
            return false;
        }
        if ((aktDate.getTime() - chargeTimestamp.getTime()) / 1000 < this.minChargeSeconds) {
            return true;
        }
        return false;
    }

    /**
     * Checks whether charging should continue because minimum time for charging even with grid consumption was not yet reached
     *
     * @param aktDate current time as Date object
     * @returns true if minimum charging time was not yet reached
     */
    isContinueDueToMinConsumptionTime(aktDate) {
        if (this.minConsumptionSeconds <= 0) {
            return false;
        }
        let consumptionTimestamp = this.getStateAsDate(this.stateConsumptionTimestamp);
        if (consumptionTimestamp == null) {
            this.setStateAck(this.stateConsumptionTimestamp, aktDate.toString());
            consumptionTimestamp = aktDate;
        }
        if ((aktDate.getTime() - consumptionTimestamp.getTime()) / 1000 < this.minConsumptionSeconds) {
            return true;
        }
        return false;
    }

    /**
     * Checks whether switching between phases can not be performed since minimum waiting time has not yet reached.
     *
     * @param aktDate current time as Date object
     * @returns true if minimum time between switching phased was not yet reached
     */
    isContinueDueToMin1p3pSwTime(aktDate) {
        if (this.min1p3pSwSec <= 0) {
            return false;
        }
        const sw1p3pDate = this.getStateAsDate(this.state1p3pSwTimestamp);
        if (sw1p3pDate === null) {
            return false;
        }
        if ((aktDate.getTime() - sw1p3pDate.getTime()) / 1000 < this.min1p3pSwSec) {
            return true;
        }
        return false;
    }

    /**
     * Checks whether charging station is in state 5 (no charging due to no RFID, power limitation or conditions of vehicle).
     * After one attempt was made, no futher attempts should be done.
     *
     * @param milliAmpere  geplante Ladestromstärke
     */
    isNoChargingDueToInteruptedStateOfWallbox(milliAmpere) {
        if (milliAmpere <= 0) {
            this.startWithState5Attempted = false;
            return false;
        }
        if (this.getStateDefault0(this.stateWallboxState) == 5) {
            if (this.startWithState5Attempted === true) {
                return true;
            }
            this.startWithState5Attempted = true;
        } else {
            this.startWithState5Attempted = false;
        }
        return false;
    }

    /**
     * Checks whether the vehicle is plugged to the charging station, authorization is needed and successfully done
     * In this case, we should charge a bit. Otherwise due to a Keba bug charging will not be possible later on
     */
    isVehicleReadyToChargeAndAuthorizationDone() {
        return (
            this.isVehiclePlugged() &&
            this.getStateDefaultFalse(this.stateAuthActivated) === true &&
            this.getStateDefaultFalse(this.stateAuthPending) == false
        );
    }

    checkWallboxPower() {
        // update charging state also between two calculations to recognize charging session
        // before a new calculation will stop it again (as long as chargingTimestamp was not yet set)
        // it can be stopped immediatelly with no respect to minimim charging time...
        if (
            this.getStateAsDate(this.stateChargeTimestamp) === null &&
            this.isVehicleCharging() &&
            (this.chargingToBeStarted === true || this.isPassive === true)
        ) {
            this.log.info('vehicle (re)starts to charge');
            this.setStateAck(this.stateChargeTimestamp, new Date().toString());
        }

        let curr = 0; // in mA
        let tempMax = this.getMaxCurrent();
        this.log.debug(`current max current is ${tempMax}`);
        let phases = this.get1p3pPhases();
        this.isMaxPowerCalculation = false;
        this.chargingToBeStarted = false;

        // first of all check maximum power allowed
        if (this.maxPowerActive === true) {
            // Always calculate with three phases for safety reasons
            const maxPower = this.getTotalPowerAvailable();
            this.setStateAck(this.stateMaxPower, Math.round(maxPower));
            this.log.debug(`Available max power: ${maxPower}`);
            const maxAmperage = this.getAmperage(maxPower, phases, true);
            if (tempMax > maxAmperage) {
                tempMax = maxAmperage;
            }
        }

        // check also maximum current allowed
        if (this.maxAmperageActive === true) {
            const maxAmperage = this.getTotalAmperageAvailable();
            this.setStateAck(this.stateMaxAmperage, maxAmperage);
            this.log.debug(`Available max amperage: ${maxAmperage}`);
            if (tempMax > maxAmperage) {
                tempMax = maxAmperage;
            }
        }

        // next check if limitation is active according to german for §14a EnWG
        const maxCurrentEnWG = this.getMaxCurrentEnWG();
        if (maxCurrentEnWG >= 0) {
            if (maxCurrentEnWG < tempMax) {
                tempMax = maxCurrentEnWG;
                this.log.debug(`Limit current to ${maxCurrentEnWG} mA due to §14a EnWG`);
            }
        }
        if (tempMax < this.getMinCurrent()) {
            tempMax = 0;
        }

        const available = this.getSurplusWithoutWallbox();
        this.setStateAck(this.stateSurplus, Math.round(available));
        this.log.debug(`Available surplus: ${available}`);

        if (this.check1p3pSwitching()) {
            return;
        }

        if (this.isPassive === true) {
            if (this.getStateAsDate(this.stateChargeTimestamp) !== null && !this.isVehicleCharging()) {
                this.resetChargingSessionData();
            }
            return;
        }

        const newDate = new Date();
        if (
            this.lastCalculating !== null &&
            newDate.getTime() - this.lastCalculating.getTime() < this.intervalCalculating
        ) {
            if (this.getStateDefault0(this.stateWallboxCurrent) > tempMax) {
                this.log.debug(`set intermediate charging maximum of ${tempMax} mA`);
                this.regulateWallbox(tempMax);
            }
            return;
        }

        this.lastCalculating = newDate;
        let newValueFor1p3pSwitching = null;

        this.log.debug(
            `pvAutomaticsActive: ${this.isPvAutomaticsActive()}, vehicleIsPlugged: ${this.isVehiclePlugged()}`,
        );

        // lock wallbox if requested or available amperage below minimum
        if (
            this.getStateDefaultFalse(this.stateWallboxDisabled) === true ||
            tempMax == 0 ||
            (this.isPvAutomaticsActive() && !this.isVehiclePlugged())
        ) {
            curr = 0;
            this.log.debug('no charging calculated');
        } else {
            // if vehicle is currently charging and was not before, then save timestamp
            if (this.isDynamicChargingActive()) {
                curr = this.getAmperage(available, phases);
                this.log.debug(`first calculation for current is ${curr}`);
                if (curr > tempMax) {
                    curr = tempMax;
                    this.log.debug(`new current due to max current is ${curr}`);
                }
                if (this.isUsingBatteryForMinimumChargingOfVehicle() === true) {
                    if (
                        curr < this.minAmperage &&
                        this.isVehicleCharging() &&
                        this.getAmperage(this.getSurplusWithoutWallbox(true), phases) > this.minAmperage
                    ) {
                        curr = this.minAmperage;
                        this.log.debug(`new current due to min charging by battery storage is ${curr}`);
                    }
                }
                const chargeTimestamp = this.getStateAsDate(this.stateChargeTimestamp);
                const sw1p3pTimestamp = this.getStateAsDate(this.state1p3pSwTimestamp);
                const consumptionTimestamp = this.getStateAsDate(this.stateConsumptionTimestamp);

                if (this.has1P3PAutomatic()) {
                    const switch1p3p = this.getStateDefault0(this.stateManual1p3p);
                    const currWith1p = this.getAmperage(available, 1);
                    let newValues = [];
                    switch (switch1p3p) {
                        case 1:
                            newValues = this.prepareFor1pCharging(
                                currWith1p,
                                chargeTimestamp,
                                newDate,
                                consumptionTimestamp,
                                sw1p3pTimestamp,
                            );
                            break;
                        case 3:
                            newValues = this.prepareFor3pCharging(
                                currWith1p,
                                chargeTimestamp,
                                newDate,
                                phases,
                                sw1p3pTimestamp,
                            );
                            break;
                        default:
                            if (curr != currWith1p) {
                                if (curr < this.getMinCurrent()) {
                                    newValues = this.prepareFor1pCharging(
                                        currWith1p,
                                        chargeTimestamp,
                                        newDate,
                                        consumptionTimestamp,
                                        sw1p3pTimestamp,
                                    );
                                } else {
                                    newValues = this.prepareFor3pCharging(
                                        currWith1p,
                                        chargeTimestamp,
                                        newDate,
                                        phases,
                                        sw1p3pTimestamp,
                                    );
                                }
                            }
                    }
                    if (newValues['phases'] !== undefined) {
                        phases = newValues['phases'];
                    }
                    if (newValues['curr'] !== undefined) {
                        curr = newValues['curr'];
                    }
                    if (newValues['newValueFor1p3pSwitching'] !== undefined) {
                        newValueFor1p3pSwitching = newValues['newValueFor1p3pSwitching'];
                    }
                }

                const addPower = this.getStateDefault0(this.stateAddPower);
                if (curr < this.getMinCurrent() && addPower > 0) {
                    // Reicht der Überschuss noch nicht, um zu laden, dann ggfs. zusätzlichen Netzbezug bis 'addPower' zulassen
                    this.log.debug(`check with additional power of: ${addPower}`);
                    if (this.getAmperage(available + addPower, phases) >= this.getMinCurrent()) {
                        this.log.debug(`Minimum amperage reached by addPower of ${addPower}`);
                        curr = this.getMinCurrent();
                    }
                }
                if (chargeTimestamp !== null) {
                    if (curr < this.getMinCurrent()) {
                        // if vehicle is currently charging or is allowed to do so then check limits for power off
                        if (this.underusage > 0) {
                            this.log.debug(
                                `check with additional power of: ${addPower} and underUsage: ${this.underusage}`,
                            );
                            curr = this.getAmperage(available + addPower + this.underusage, phases);
                            if (curr >= this.getMinCurrent()) {
                                this.logInfoOrDebug(
                                    'tolerated under-usage of charge power, continuing charging session',
                                );
                                curr = this.getMinCurrent();
                                if (newValueFor1p3pSwitching == this.valueFor3pCharging) {
                                    newValueFor1p3pSwitching = null; // then also stop possible 1p to 3p switching
                                }
                            }
                        }
                    }
                    if (curr < this.getMinCurrent()) {
                        if (this.isContinueDueToMinChargingTime(newDate, chargeTimestamp)) {
                            this.logInfoOrDebug(
                                `minimum charge time of ${this.minChargeSeconds}sec not reached, continuing charging session. ${chargeTimestamp}`,
                            );
                            curr = this.getMinCurrent();
                            newValueFor1p3pSwitching = null; // than also stop possible 1p/3p switching
                        }
                    }
                    if (curr < this.getMinCurrent()) {
                        if (this.isContinueDueToMinConsumptionTime(newDate)) {
                            this.logInfoOrDebug(
                                `minimum grid consumption time of ${this.minConsumptionSeconds}sec not reached, continuing charging session. ConsumptionTimestamp: ${consumptionTimestamp}`,
                            );
                            curr = this.getMinCurrent();
                            newValueFor1p3pSwitching = null; // than also stop possible 1p/3p switching
                        }
                    } else {
                        this.setStateAck(this.stateConsumptionTimestamp, null);
                    }
                }
            } else {
                curr = tempMax; // no automatic active or vehicle not plugged to wallbox? Charging with maximum power possible
                this.log.debug(`new current due to vehicle not plugged or pv automatics not active is ${curr}`);
                this.isMaxPowerCalculation = true;
                if (this.isVehiclePlugged()) {
                    newValueFor1p3pSwitching = this.valueFor3pCharging;
                } else {
                    newValueFor1p3pSwitching = this.valueFor1p3pOff;
                }
            }
        }

        if (this.config.authChargingTime > 0 && this.isVehicleReadyToChargeAndAuthorizationDone()) {
            let authTimestamp = this.getStateAsDate(this.stateAuthPlugTimestamp);
            if (authTimestamp == null) {
                authTimestamp = new Date();
                this.setStateAckSync(this.stateAuthPlugTimestamp, authTimestamp.toString());
            }
            this.log.debug(
                `authTimestamp is ${typeof authTimestamp} with value ${authTimestamp.toString()}, time diff ${newDate.getTime() - authTimestamp.getTime()}`,
            );
            this.log.debug(
                `curr is ${curr}, minCurrent ${this.getMinCurrent()}, mintime = ${this.config.authChargingTime * 1000}`,
            );
            if (
                curr < this.getMinCurrent() &&
                newDate.getTime() - authTimestamp.getTime() < this.config.authChargingTime * 1000
            ) {
                this.log.debug(
                    `${this.isVehicleCharging() ? 'continue' : 'start'} charging after successful authorization`,
                );
                curr = this.getMinCurrent();
                if (this.has1P3PAutomatic()) {
                    newValueFor1p3pSwitching = this.valueFor1pCharging;
                }
            }
        }

        if (curr < this.getMinCurrent()) {
            const sw1p3pTimestamp = this.getStateAsDate(this.state1p3pSwTimestamp);
            let currentSwitch;
            if (this.isX2PhaseSwitch()) {
                currentSwitch = this.getStateDefault0(this.stateX2Switch);
            } else {
                currentSwitch = this.getStateInternal(this.stateFor1p3pCharging);
            }

            if (currentSwitch === this.valueFor1p3pOff) {
                this.log.silly('switch is already in valueFor1p3pOff');
            } else if (sw1p3pTimestamp !== null && this.isContinueDueToMin1p3pSwTime(newDate)) {
                this.log.debug(
                    `no switching to default phases because of minimum time between switching (stopCharging): ${sw1p3pTimestamp}`,
                );
            } else {
                this.log.debug('switching phases to default as charging is stopped');
                this.set1p3pSwitching(this.valueFor1p3pOff);
            }
            this.log.debug('not enough power for charging ...');
            this.stopCharging();
        } else {
            if (newValueFor1p3pSwitching !== null) {
                if (this.isContinueDueToMin1p3pSwTime(newDate)) {
                    this.log.debug('wait for minimum time for phase switch to 3p');
                } else {
                    if (this.set1p3pSwitching(newValueFor1p3pSwitching)) {
                        return;
                    }
                }
            }
            if (curr > tempMax) {
                curr = tempMax;
            }
            this.log.debug(`wallbox set to charging maximum of ${curr} mA`);
            this.regulateWallbox(curr);
            this.chargingToBeStarted = true;
        }
    }

    /**
     * Check, if dynamic charging should be in effect
     *
     * @returns true, if dynamic charging should be in effect (= PV automatics)
     */
    isDynamicChargingActive() {
        const targetSoc = this.getTagetSoC();
        this.log.debug(`target SoC is ${targetSoc}%`);
        if (targetSoc > 0) {
            const vehicleSoc = this.getVehicleSoC();
            this.log.debug(`target SoC is ${targetSoc}%, vehicle SoC is ${vehicleSoc}%`);
            if (vehicleSoc > 0) {
                if (vehicleSoc < targetSoc) {
                    this.log.debug('SoC of vehicle below target, full power charging active');
                    return false;
                } else if (this.isResetTargetSoC()) {
                    this.resetTargetSoC();
                }
            }
        }

        return this.isVehiclePlugged() && this.isPvAutomaticsActive();
    }

    /**
     * tries to setup everything for charging with 1p
     *
     * @param {*} currWith1p current if charging with 1p
     * @param {*} chargeTimestamp timestamp when charging was started
     * @param {*} newDate current timestamp
     * @param {*} consumptionTimestamp timestamp when charging fell into consumption from grid
     * @param {*} sw1p3pTimestamp timestamp of last 1p3p switch
     */
    prepareFor1pCharging(currWith1p, chargeTimestamp, newDate, consumptionTimestamp, sw1p3pTimestamp) {
        let result = [];
        if (this.isReducedChargingBecause1p3p()) {
            result['phases'] = 1;
            result['curr'] = currWith1p;
            this.log.debug(`new current due to 1p charging is ${currWith1p}`);
        } else {
            if (this.isContinueDueToMinChargingTime(newDate, chargeTimestamp)) {
                this.log.debug(`no switching to 1 phase because of minimum charging time: ${chargeTimestamp}`);
            } else if (chargeTimestamp !== null && this.isContinueDueToMinConsumptionTime(newDate)) {
                this.log.debug(
                    `no switching to 1 phase because of minimum grid consumption time: ${consumptionTimestamp}`,
                );
            } else if (sw1p3pTimestamp !== null && this.isContinueDueToMin1p3pSwTime(newDate)) {
                this.log.debug(`no switching to 1 phase because of minimum time between switching: ${sw1p3pTimestamp}`);
            } else {
                result['newValueFor1p3pSwitching'] = this.valueFor1pCharging;
                result['phases'] = 1;
                result['curr'] = currWith1p;
                this.log.debug(`new current due to switching to 1p charging is ${currWith1p}`);
            }
        }
        return result;
    }

    /**
     * tries to setup everything for charging with 3p
     *
     * @param {*} currWith1p current if charging with 1p
     * @param {*} chargeTimestamp timestamp when charging was started
     * @param {*} newDate current timestamp
     * @param {*} phases number of phases to be used for calculation
     * @param {*} sw1p3pTimestamp timestamp of last 1p3p switch
     */
    prepareFor3pCharging(currWith1p, chargeTimestamp, newDate, phases, sw1p3pTimestamp) {
        let result = [];
        if (this.isReducedChargingBecause1p3p()) {
            let isSwitchFrom1pTo3p = false;
            if (this.isContinueDueToMinChargingTime(newDate, chargeTimestamp)) {
                this.log.debug(`no switching to ${phases} phases because of minimum charging time: ${chargeTimestamp}`);
            } else if (sw1p3pTimestamp !== null && this.isContinueDueToMin1p3pSwTime(newDate)) {
                this.log.debug(
                    `no switching to ${phases} phase because of minimum time between switching: ${sw1p3pTimestamp}`,
                );
            } else {
                if (currWith1p < this.getCurrentForSwitchTo3p()) {
                    this.log.debug(
                        `no switching to ${phases} phases because amperage ${currWith1p} < ${this.getCurrentForSwitchTo3p()}`,
                    );
                } else {
                    this.log.debug(
                        `switching to ${phases} phases because amperage ${currWith1p} >= ${this.getCurrentForSwitchTo3p()}`,
                    );
                    result['newValueFor1p3pSwitching'] = this.valueFor3pCharging;
                    isSwitchFrom1pTo3p = true;
                    this.log.debug('will swiutch back to 3p');
                }
            }
            if (isSwitchFrom1pTo3p === false) {
                result['phases'] = 1;
                result['curr'] = currWith1p;
                this.log.debug(`new current due to not switching to 3p charging is ${currWith1p}`);
            }
        }
        return result;
    }

    disableChargingTimer() {
        if (this.timerDataUpdate) {
            clearInterval(this.timerDataUpdate);
            this.timerDataUpdate = null;
        }
    }

    enableChargingTimer(time) {
        this.disableChargingTimer();
        this.timerDataUpdate = setInterval(this.requestReports.bind(this), time);
    }

    forceUpdateOfCalculation() {
        // disable time of last calculation to do it with next interval
        this.lastCalculating = null;
        this.requestReports();
    }

    requestReports() {
        this.requestDeviceDataReport();
        this.requestChargingDataReport();
    }

    /**
     * Requests data report with ID 1 from charging station (containing permanent values from charging station)
     */
    requestDeviceDataReport() {
        const newDate = new Date();
        if (
            this.lastDeviceData == null ||
            newDate.getTime() - this.lastDeviceData.getTime() >= this.intervalDeviceDataUpdate
        ) {
            this.sendUdpDatagram('report 1');
            this.loadChargingSessionsFromWallbox();
            this.lastDeviceData = newDate;
        }
    }

    /**
     * Requests data report with ID 2 from charging station (containing general data of charging session)
     */
    requestCurrentChargingSessionDataReport() {
        this.sendUdpDatagram('report 2');
    }

    /**
     * Requests data report with ID 3 from charging station (containing voltage, amperage and power of charging session)
     */
    requestCurrentChargingValuesDataReport() {
        this.sendUdpDatagram('report 3');
    }

    /**
     * Requests data report with ID 100 from charging station (containing data from last charging session)
     */
    requestLastChargingSessionDataReport() {
        this.sendUdpDatagram('report 100');
    }

    /**
     * Requests all three data reports from charging station
     */
    requestChargingDataReport() {
        this.requestCurrentChargingSessionDataReport();
        this.requestCurrentChargingValuesDataReport();
        this.requestLastChargingSessionDataReport();
    }

    loadChargingSessionsFromWallbox() {
        if (this.loadChargingSessions) {
            for (let i = 101; i <= 130; i++) {
                this.sendUdpDatagram(`report ${i}`);
            }
        }
    }

    async updateState(stateData, value) {
        if (stateData && stateData.common) {
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
            // immediately update power and amperage values to prevent that value is not yet updated by setState()
            // when doing calculation after processing report 3
            // no longer needed when using await
            //if (stateData._id == adapter.namespace + '.' + stateWallboxPower ||
            //    stateData._id == adapter.namespace + '.' + stateWallboxPhase1 ||
            //    stateData._id == adapter.namespace + '.' + stateWallboxPhase2 ||
            //    stateData._id == adapter.namespace + '.' + stateWallboxPhase3) {
            //    setStateInternal(stateData._id, value);
            //}
            await this.setStateAckSync(stateData._id, value);
        }
    }

    sendUdpDatagram(message, highPriority) {
        if (highPriority) {
            this.sendQueue.unshift(message);
        } else {
            this.sendQueue.push(message);
        }
        if (!this.sendDelayTimer) {
            this.sendNextQueueDatagram();
            this.sendDelayTimer = setInterval(this.sendNextQueueDatagram.bind(this), 300);
        }
    }

    sendNextQueueDatagram() {
        if (this.sendQueue.length === 0) {
            if (this.sendDelayTimer !== null) {
                clearInterval(this.sendDelayTimer);
                this.sendDelayTimer = null;
            }
            return;
        }
        const message = this.sendQueue.shift();
        if (this.txSocket) {
            try {
                this.txSocket.send(message, 0, message.length, this.DEFAULT_UDP_PORT, this.config.host, err => {
                    // 2nd parameter 'bytes' not needed, therefore only 'err' coded
                    if (err) {
                        this.log.warn(`UDP send error for ${this.config.host}:${this.DEFAULT_UDP_PORT}: ${err}`);
                        return;
                    }
                    this.log.debug(`Sent "${message}" to ${this.config.host}:${this.DEFAULT_UDP_PORT}`);
                });
            } catch (e) {
                if (this.log) {
                    this.log.error(`Error sending message "${message}": ${e}`);
                }
            }
        }
    }

    getStateInternal(id) {
        if (id == null || typeof id !== 'string' || id.trim().length == 0) {
            return null;
        }
        let obj = id;
        if (!obj.startsWith(`${this.namespace}.`)) {
            obj = `${this.namespace}.${id}`;
        }
        return this.currentStateValues[obj];
    }

    getNumber(value) {
        if (value) {
            if (typeof value !== 'number') {
                value = parseFloat(value);
                if (isNaN(value)) {
                    value = 0;
                }
            }
            return value;
        }
        return 0;
    }

    getStateAsDate(id) {
        let result = this.getStateInternal(id);
        // state comes as timestamp string => to be converted to date object
        if (result != null && result != '') {
            result = new Date(result);
        }
        return result;
    }

    getBoolean(value) {
        // 'repair' state: VIS boolean control sets value to 0/1 instead of false/true
        if (typeof value != 'boolean') {
            return value === 1;
        }
        return value;
    }

    getStateDefaultFalse(id) {
        if (id == null) {
            return false;
        }
        return this.getBoolean(this.getStateInternal(id));
    }

    getStateDefault0(id) {
        if (id == null) {
            return 0;
        }
        return this.getNumber(this.getStateInternal(id));
    }

    setStateInternal(id, value) {
        let obj = id;
        if (!obj.startsWith(`${this.namespace}.`)) {
            obj = `${this.namespace}.${id}`;
        }
        this.log.silly(`update state ${obj} with value:${value}`);
        this.currentStateValues[obj] = value;
    }

    setStateAck(id, value) {
        // State wird intern auch über 'onStateChange' angepasst. Wenn es bereits hier gesetzt wird, klappt die Erkennung
        // von Wertänderungen nicht, weil der interne Wert bereits aktualisiert ist.
        //setStateInternal(id, value);
        this.setState(id, { val: value, ack: true });
    }

    async setStateAckSync(id, value) {
        // Do synchronous setState
        // State wird intern auch über 'onStateChange' angepasst. Wenn es bereits hier gesetzt wird, klappt die Erkennung
        // von Wertänderungen nicht, weil der interne Wert bereits aktualisiert ist.
        //setStateInternal(id, value);
        const promisedSetState = (id, value) =>
            new Promise(resolve => this.setState(id, { val: value, ack: true }, resolve));
        await promisedSetState(id, value);
    }

    async checkFirmware() {
        if (this.getWallboxModel() == this.MODEL_P30) {
            try {
                const response = await axios.get(this.firmwareUrl);
                this.processFirmwarePage(response.status, response.data);
            } catch (e) {
                this.log.warn(`Error requesting firmware url ${this.firmwareUrl}e: ${e}`);
            }
        }
        return;
    }

    sendWallboxWarning(message) {
        if (!this.wallboxWarningSent) {
            this.log.warn(message);
            this.wallboxWarningSent = true;
        }
    }

    getWallboxModel() {
        const type = this.getStateInternal(this.stateProduct);
        if (typeof type !== 'string') {
            return -1;
        }
        if (type.startsWith('KC-P20')) {
            return this.MODEL_P20;
        }
        if (type.startsWith('KC-P30') && type.substr(15, 1) == '-') {
            return this.MODEL_P30;
        }
        if (type.startsWith('BMW-10') && type.substr(15, 1) == '-') {
            return this.MODEL_BMW;
        }
        return 0;
    }

    getWallboxType() {
        const type = this.getStateInternal(this.stateProduct);
        switch (this.getWallboxModel()) {
            case -1:
                return 0;
            case this.MODEL_P20:
                switch (type.substr(13, 1)) {
                    case '0':
                        return this.TYPE_E_SERIES;
                    case '1':
                        this.sendWallboxWarning('KeContact P20 b-series will not be supported!');
                        return this.TYPE_B_SERIES;
                    case '2': // c-series
                    case '3': // c-series + PLC (only P20)
                    case 'A': // c-series + WLAN
                    case 'K': // Dienstwagen-Wallbox / Company Car Wall Box MID / Art.no. 126 389
                        return this.TYPE_C_SERIES;
                    case 'B': // x-series
                    case 'C': // x-series + GSM
                    case 'D': // x-series + GSM + PLC
                        return this.TYPE_X_SERIES;
                }
                break;
            case this.MODEL_P30:
                if (type.endsWith('-DE')) {
                    // KEBA says there's only one ID: KC-P30-EC220112-000-DE
                    this.sendWallboxWarning(
                        'Keba KeContact P30 Deutschland-Edition detected. Regulation may be inaccurate.',
                    );
                    return this.TYPE_D_EDITION;
                }
            // fall through
            case this.MODEL_BMW:
                switch (type.substr(13, 1)) {
                    case '0':
                        return this.TYPE_E_SERIES;
                    case '1':
                        this.sendWallboxWarning('KeContact P30 b-series will not be supported!');
                        return this.TYPE_B_SERIES;
                    case '2':
                        return this.TYPE_C_SERIES;
                    case '3':
                        this.sendWallboxWarning('KeContact P30 a-series will not be supported!');
                        return this.TYPE_A_SERIES;
                    case 'B': // x-series WLAN
                    case 'C': // x-series WLAN + 3G
                    case 'E': // x-series WLAN + 4G
                    case 'G': // x-series 3G
                    case 'H': // x-series 4G
                    case 'U': // KC-P30-EC2204U2-M0R-CC (Company Car Wall Box MID     - GREEN EDITION),
                        //       KC-P30-EC2204U2-E00-PV (Photovoltaic Wallbox Cable   - PV-Edition),
                        //       KC-P30-ES2400U2-E00-PV (Photovoltaic WallBox Shutter - PV-Edition)
                        return this.TYPE_X_SERIES;
                }
                break;
            default:
        }
        if (!this.wallboxUnknownSent) {
            this.sendSentryMessage(`unknown wallbox type ${type}`);
            this.wallboxUnknownSent = true;
        }
        return 0;
    }

    sendSentryMessage(msg) {
        this.log.error(msg);
        if (this.supportsFeature && this.supportsFeature('PLUGINS')) {
            const sentryInstance = this.getPluginInstance('sentry');
            if (sentryInstance) {
                sentryInstance.getSentryObject().captureException(msg);
            }
        }
    }

    getFirmwareRegEx() {
        switch (this.getWallboxModel()) {
            case -1:
                return 0;
            case this.MODEL_P30:
                switch (this.getWallboxType()) {
                    case this.TYPE_C_SERIES:
                    case this.TYPE_D_EDITION:
                        return this.regexP30cSeries;
                    case this.TYPE_X_SERIES:
                        return null; // regexP30xSeries; x-Series no longer supported for firmware check
                    default:
                        return null;
                }
            case this.MODEL_P20: // as mail of Keba on 06th august 2021 there will be no forther firmware updates
            case this.MODEL_BMW:
            default:
                return null;
        }
    }

    processFirmwarePage(statusCode, body) {
        const prefix = 'Keba firmware check: ';
        if (statusCode != 200) {
            this.log.warn(`Firmware page could not be loaded (${statusCode})`);
        } else if (body) {
            const regexPattern = this.getFirmwareRegEx();
            if (!regexPattern || regexPattern == null) {
                return;
            }
            regexPattern.lastIndex = 0;
            const list = regexPattern.exec(body);
            if (list) {
                this.regexFirmware.lastIndex = 0;
                const block = this.regexFirmware.exec(list[1]);
                if (block) {
                    this.setStateAck(this.stateFirmwareAvailable, block[1]);
                    const currFirmware = this.getStateInternal(this.stateFirmware);
                    this.regexCurrFirmware.lastIndex = 0;
                    const currFirmwareList = this.regexCurrFirmware.exec(currFirmware);
                    if (currFirmwareList) {
                        currFirmwareList[1] = `V${currFirmwareList[1]}`;
                        if (block[1] == currFirmwareList[1]) {
                            this.log.info(`${prefix}latest firmware installed`);
                        } else {
                            this.log.warn(
                                `${prefix}current firmware ${currFirmwareList[1]}, <a href="${this.firmwareUrl}">new firmware ${block[1]} available</a>`,
                            );
                        }
                    } else {
                        this.log.error(`${prefix}current firmare unknown: ${currFirmware}`);
                    }
                } else {
                    this.log.warn(`${prefix}no firmware found`);
                }
            } else {
                // disabled due to chenges on webpage of Keba
                //adapter.log.warn(prefix + 'no section found');
                //adapter.log.debug(body);
            }
        } else {
            this.log.warn(`${prefix}empty page, status code ${statusCode}`);
        }
        return true;
    }

    createHistory() {
        // create Sessions Channel
        this.setObject('Sessions', {
            type: 'channel',
            common: {
                name: 'Sessions Statistics',
            },
            native: {},
        });
        // create Datapoints for 31 Sessions
        for (let i = 0; i <= 30; i++) {
            let session = '';
            if (i < 10) {
                session = '0';
            }

            this.setObject(`Sessions.Session_${session}${i}`, {
                type: 'channel',
                common: {
                    name: `Session_${session}${i} Statistics`,
                },
                native: {},
            });

            this.setObject(`Sessions.Session_${session}${i}.json`, {
                type: 'state',
                common: {
                    name: 'Raw json string from Wallbox',
                    type: 'string',
                    role: 'json',
                    read: true,
                    write: false,
                    desc: 'RAW_Json message',
                },
                native: {
                    udpKey: `${session + i}_json`,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.sessionid`, {
                type: 'state',
                common: {
                    name: 'SessionID of Charging Session',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    desc: 'unique Session ID',
                },
                native: {
                    udpKey: `${session + i}_Session ID`,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.currentHardware`, {
                type: 'state',
                common: {
                    name: 'Maximum Current of Hardware',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    desc: 'Maximum Current that can be supported by hardware',
                    unit: 'mA',
                },
                native: {
                    udpKey: `${session + i}_Curr HW`,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.eStart`, {
                type: 'state',
                common: {
                    name: 'Energy Counter Value at Start',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    desc: 'Total Energy Consumption at beginning of Charging Session',
                    unit: 'Wh',
                },
                native: {
                    udpKey: `${session + i}_E start`,
                    udpMultiplier: 0.1,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.ePres`, {
                type: 'state',
                common: {
                    name: 'Charged Energy in Current Session',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    desc: 'Energy Transfered in Current Charging Session',
                    unit: 'Wh',
                },
                native: {
                    udpKey: `${session + i}_E pres`,
                    udpMultiplier: 0.1,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.started_s`, {
                type: 'state',
                common: {
                    name: 'Time or Systemclock at Charging Start in Seconds',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    desc: 'Systemclock since System Startup at Charging Start',
                    unit: 's',
                },
                native: {
                    udpKey: `${session + i}_started[s]`,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.ended_s`, {
                type: 'state',
                common: {
                    name: 'Time or Systemclock at Charging End in Seconds',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    desc: 'Systemclock since System Startup at Charging End',
                    unit: 's',
                },
                native: {
                    udpKey: `${session + i}_ended[s]`,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.started`, {
                type: 'state',
                common: {
                    name: 'Time at Start of Charging',
                    type: 'string',
                    role: 'date',
                    read: true,
                    write: false,
                    desc: 'Time at Charging Session Start',
                },
                native: {
                    udpKey: `${session + i}_started`,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.ended`, {
                type: 'state',
                common: {
                    name: 'Time at End of Charging',
                    type: 'string',
                    role: 'date',
                    read: true,
                    write: false,
                    desc: 'Time at Charging Session End',
                },
                native: {
                    udpKey: `${session + i}_ended`,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.reason`, {
                type: 'state',
                common: {
                    name: 'Reason for End of Session',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    desc: 'Reason for End of Charging Session',
                },
                native: {
                    udpKey: `${session + i}_reason`,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.timeQ`, {
                type: 'state',
                common: {
                    name: 'Time Sync Quality',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    desc: 'Time Synchronisation Mode',
                },
                native: {
                    udpKey: `${session + i}_timeQ`,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.rfid_tag`, {
                type: 'state',
                common: {
                    name: 'RFID Tag of Card used to Start/Stop Session',
                    type: 'string',
                    role: 'text',
                    read: true,
                    write: false,
                    desc: 'RFID Token used for Charging Session',
                },
                native: {
                    udpKey: `${session + i}_RFID tag`,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.rfid_class`, {
                type: 'state',
                common: {
                    name: 'RFID Class of Card used to Start/Stop Session',
                    type: 'string',
                    role: 'text',
                    read: true,
                    write: false,
                    desc: 'RFID Class used for Session',
                },
                native: {
                    udpKey: `${session + i}_RFID class`,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.serial`, {
                type: 'state',
                common: {
                    name: 'Serialnumber of Device',
                    type: 'string',
                    role: 'text',
                    read: true,
                    write: false,
                    desc: 'Serial Number of Device',
                },
                native: {
                    udpKey: `${session + i}_Serial`,
                },
            });

            this.setObject(`Sessions.Session_${session}${i}.sec`, {
                type: 'state',
                common: {
                    name: 'Current State of Systemclock',
                    type: 'number',
                    role: 'value',
                    read: true,
                    write: false,
                    desc: 'Current State of System Clock since Startup of Device',
                },
                native: {
                    udpKey: `${session + i}_Sec`,
                },
            });
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    /**
     * @param [options] options for adapter start
     */
    module.exports = options => new Kecontact(options);
} else {
    // otherwise start the instance directly
    new Kecontact();
}
