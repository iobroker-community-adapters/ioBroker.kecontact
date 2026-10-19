'use strict';

/*
 * Regression test for GitHub issue #628
 * https://github.com/iobroker-community-adapters/ioBroker.kecontact/issues/628
 *
 * When PV (solar surplus) automatics is toggled ON mid charging-session while there is no
 * surplus, the adapter used to enter an endless interrupted -> ready -> charging loop.
 *
 * Root cause: statistics.chargeTimestamp was set when charging first began (before PV
 * automatics was on). isContinueDueToMinChargingTime() measured against that STALE timestamp
 * and kept forcing curr = getMinCurrent(), so the "not enough power -> stopCharging()" branch
 * was never reached.
 *
 * Fix (option A): when PV automatics genuinely transitions off -> on during an active charging
 * session, re-anchor the minimum-charge-time timer by clearing statistics.chargeTimestamp. That
 * makes isContinueDueToMinChargingTime() return false on the next cycle, so stopCharging() runs.
 *
 * These tests exercise the handler for the PV automatics state and isContinueDueToMinChargingTime(),
 * and a full checkWallboxPower() regulation cycle driven right after the toggle. They are written so
 * that the decisive cases FAIL against the un-fixed main.js and PASS with the fix in place.
 *
 * Note on the fix: clearing chargeTimestamp in the handler is not sufficient on its own, because the
 * very next checkWallboxPower() cycle (triggered by forceUpdateOfCalculation()) re-anchors it to
 * 'now' via its top-of-function guard when chargingToBeStarted === true (the state a PV-off
 * max-power session leaves behind). The handler therefore also clears chargingToBeStarted, so the
 * re-anchor guard does not fire on that immediately following cycle and the negative-surplus path
 * reaches stopCharging(). The full-cycle test below asserts that end-to-end behaviour.
 */

const { expect } = require('chai');
const proxyquire = require('proxyquire').noCallThru();
const { describe, it } = require('mocha');

// Minimal stub for the ioBroker Adapter base class so main.js can be required and the
// Kecontact class instantiated without the full ioBroker runtime.
class AdapterStub {
    constructor() {
        // nothing - the test configures the instance explicitly
    }

    // The Kecontact constructor registers lifecycle listeners via this.on(...).
    on() {
        // no-op: the test invokes handlers (e.g. onStateChange) directly.
    }

    setState() {
        // overridden per-instance in createAdapter()
    }
}

const adapterCoreStub = {
    Adapter: AdapterStub,
    I18n: {
        translate: (...args) => args.join(' '),
    },
    '@global': true,
};

const Kecontact = proxyquire('./main.js', {
    '@iobroker/adapter-core': adapterCoreStub,
});

/**
 * Build a Kecontact instance wired up for unit testing of the regulation/anchoring logic.
 *
 * @returns {object} the configured adapter instance
 */
function createAdapter() {
    const adapter = Kecontact({});

    adapter.namespace = 'kecontact.0';
    adapter.currentStateValues = {};

    const noop = () => {};
    adapter.log = { silly: noop, info: noop, debug: noop, warn: noop, error: noop };

    // setState writes through to the internal state cache (ack path) so that
    // getStateAsDate()/getStateInternal() observe the change, mirroring the real adapter.
    adapter.setState = (id, obj) => {
        adapter.setStateInternal(id, obj.val);
    };

    // Avoid side effects that need the full runtime; the fix only cares about the timestamp.
    adapter.displayChargeMode = noop;
    adapter.forceUpdateOfCalculation = noop;

    return adapter;
}

/**
 * Simulate an ioBroker state change for the PV automatics datapoint.
 *
 * @param {object} adapter the Kecontact instance
 * @param {boolean|number} newVal the new value of statePvAutomatic
 */
function firePvAutomaticChange(adapter, newVal) {
    const id = `${adapter.namespace}.${adapter.statePvAutomatic}`;
    adapter.onStateChange(id, { val: newVal, ack: false });
}

describe('issue #628 - PV automatics toggled on mid-session must not loop', () => {
    describe('isContinueDueToMinChargingTime', () => {
        it('returns true for a recent (stale) timestamp within minChargeSeconds', () => {
            const adapter = createAdapter();
            adapter.minChargeSeconds = 300;
            const now = new Date();
            const chargeTimestamp = new Date(now.getTime() - 60 * 1000); // 1 min ago
            expect(adapter.isContinueDueToMinChargingTime(now, chargeTimestamp)).to.equal(true);
        });

        it('returns false once the timestamp was cleared (null)', () => {
            const adapter = createAdapter();
            adapter.minChargeSeconds = 300;
            const now = new Date();
            expect(adapter.isContinueDueToMinChargingTime(now, null)).to.equal(false);
        });
    });

    describe('PV automatics off -> on re-anchors the minimum-charge-time timer', () => {
        it('clears a stale chargeTimestamp when PV automatics turns on during an active session', () => {
            const adapter = createAdapter();
            adapter.minChargeSeconds = 300;

            // Active charging session: chargeTimestamp was set in the past, within minChargeSeconds.
            const chargeTs = new Date(Date.now() - 60 * 1000);
            adapter.setStateInternal(adapter.stateChargeTimestamp, chargeTs.toString());

            // PV automatics is currently off.
            adapter.setStateInternal(adapter.statePvAutomatic, false);

            // Sanity: with the stale timestamp the override would keep charging alive.
            expect(adapter.isContinueDueToMinChargingTime(new Date(), adapter.getStateAsDate(adapter.stateChargeTimestamp))).to.equal(true);

            // User toggles PV automatics ON mid-session.
            firePvAutomaticChange(adapter, true);

            // Fix: the min-charge-time anchor was cleared, so the next regulation cycle with
            // negative surplus will reach stopCharging() instead of forcing getMinCurrent().
            expect(adapter.getStateAsDate(adapter.stateChargeTimestamp)).to.equal(null);
            expect(adapter.isContinueDueToMinChargingTime(new Date(), adapter.getStateAsDate(adapter.stateChargeTimestamp))).to.equal(false);
        });

        it('does not touch chargeTimestamp when there is no active session', () => {
            const adapter = createAdapter();
            adapter.minChargeSeconds = 300;
            adapter.setStateInternal(adapter.statePvAutomatic, false);
            // no chargeTimestamp set (session not running)

            firePvAutomaticChange(adapter, true);

            // No session means no anchor to begin with (null or never-set/undefined).
            // eslint-disable-next-line no-unused-expressions
            expect(adapter.getStateAsDate(adapter.stateChargeTimestamp) == null).to.be.true;
        });

        it('does not fire on startup / re-subscription when the value did not change', () => {
            const adapter = createAdapter();
            adapter.minChargeSeconds = 300;

            const chargeTs = new Date(Date.now() - 60 * 1000);
            adapter.setStateInternal(adapter.stateChargeTimestamp, chargeTs.toString());
            // PV automatics is already on (same value will be re-delivered).
            adapter.setStateInternal(adapter.statePvAutomatic, true);

            // Re-subscription delivers the identical value => oldValue == newValue => no change.
            firePvAutomaticChange(adapter, true);

            // The anchor must be preserved because this is not a genuine off->on transition.
            // (Date.toString() drops milliseconds, so compare to second precision.)
            expect(adapter.getStateAsDate(adapter.stateChargeTimestamp)).to.not.equal(null);
            expect(Math.floor(adapter.getStateAsDate(adapter.stateChargeTimestamp).getTime() / 1000)).to.equal(
                Math.floor(chargeTs.getTime() / 1000),
            );
        });

        it('does not clear the anchor when PV automatics is toggled OFF', () => {
            const adapter = createAdapter();
            adapter.minChargeSeconds = 300;

            const chargeTs = new Date(Date.now() - 60 * 1000);
            adapter.setStateInternal(adapter.stateChargeTimestamp, chargeTs.toString());
            adapter.setStateInternal(adapter.statePvAutomatic, true);

            firePvAutomaticChange(adapter, false);

            expect(adapter.getStateAsDate(adapter.stateChargeTimestamp)).to.not.equal(null);
        });
    });

    describe('full regulation cycle after the off -> on toggle must stop, not loop', () => {
        /**
         * Build a Kecontact instance whose leaf methods are stubbed so that a single
         * checkWallboxPower() cycle runs the PV (dynamic) charging branch with a strongly
         * negative surplus, reproducing the exact issue #628 scenario end to end.
         *
         * @returns {{adapter: object, commands: number[]}} the adapter and the list of
         *   milliAmpere values passed to regulateWallbox() during the cycle
         */
        function createFullCycleAdapter() {
            const adapter = createAdapter();

            adapter.minChargeSeconds = 300; // 5 min minimum charge time, > 0
            adapter.minConsumptionSeconds = 0; // no grid-consumption hold
            adapter.underusage = 0; // no under-usage tolerance
            adapter.minAmperage = 6000;
            adapter.isMaxPowerCalculation = false;
            adapter.isPassive = false; // PV-automatics user, not passive mode
            adapter.lastCalculating = null; // force a real calculation this cycle
            adapter.intervalCalculating = 25 * 1000;
            adapter.maxGridPowerActive = false;
            adapter.maxAmperageActive = false;
            adapter.config = { authChargingTime: 0, lessInfoLogs: false };

            // The off -> on toggle runs the handler and then forceUpdateOfCalculation(); drive the
            // real regulation cycle directly so the top-of-function re-anchor guard is exercised.
            adapter.forceUpdateOfCalculation = () => adapter.checkWallboxPower();

            // Leaf stubs describing: PV automatics active, vehicle plugged and physically charging,
            // dynamic (PV) charging branch, no 1p/3p automatic, no battery-minimum strategy, and a
            // strongly negative surplus so the computed amperage is far below the minimum.
            adapter.getMaxCurrent = () => 16000;
            adapter.getMinCurrent = () => 6000;
            adapter.get1p3pPhases = () => 3;
            adapter.getMaxCurrentEnWG = () => -1;
            adapter.getTotalPowerAvailable = () => 0;
            adapter.check1p3pSwitching = () => false;
            adapter.has1P3PAutomatic = () => false;
            adapter.isUsingBatteryForMinimumChargingOfVehicle = () => false;
            adapter.isPvAutomaticsActive = () => true;
            adapter.isVehiclePlugged = () => true;
            adapter.isVehicleCharging = () => true; // > 1000 W at the toggle instant
            adapter.isDynamicChargingActive = () => true;
            adapter.getSurplusWithoutWallbox = () => -4000; // hard-negative grid draw
            adapter.getAmperage = () => -6000; // negative amperage => below minimum
            adapter.getVehicleSoC = () => adapter.NO_SOC_DEFINED;
            adapter.isNoChargingDueToInteruptedStateOfWallbox = () => false;
            adapter.set1p3pSwitching = () => false;
            adapter.isX2PhaseSwitch = () => false;
            adapter.sendUdpDatagram = () => {};

            const commands = [];
            adapter.regulateWallbox = milliAmpere => commands.push(milliAmpere);

            return { adapter, commands };
        }

        it('stops charging (currtime 0) instead of forcing getMinCurrent() on the first post-toggle cycle', () => {
            const { adapter, commands } = createFullCycleAdapter();

            // Active session started with PV automatics OFF: chargeTimestamp set in the past but
            // still within minChargeSeconds, and chargingToBeStarted latched true (the max-power
            // branch sets it at the end of each cycle).
            const chargeTs = new Date(Date.now() - 60 * 1000);
            adapter.setStateInternal(adapter.stateChargeTimestamp, chargeTs.toString());
            adapter.setStateInternal(adapter.statePvAutomatic, false);
            adapter.chargingToBeStarted = true;

            // User toggles PV automatics ON mid-session -> handler + one regulation cycle.
            firePvAutomaticChange(adapter, true);

            // With the fix the regulation cycle reaches stopCharging() -> regulateWallbox(0).
            // Without the fix the stale/re-anchored timestamp forces getMinCurrent() (6000).
            expect(commands).to.include(0);
            expect(commands).to.not.include(6000);

            // stopCharging() clears the anchor via resetChargingSessionData().
            expect(adapter.getStateAsDate(adapter.stateChargeTimestamp)).to.equal(null);
        });
    });
});
