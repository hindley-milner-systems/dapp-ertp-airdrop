import { uncurry } from './lenses.js';

const getKey = map => key => map.get(key);
const setKeyedValue = map => key => value => map.set(key, value);
const flip = fn => a => b => fn(b, a);

const STATE_MACHINE_STATUS_KEY = 'currentStatus';
const EPOCH_TRACKER_KEY = 'epoch tracker';
const getKeyAlt = flip(getKey);

/**
 * @name makeStateMachine
 * @description makeStateMachine is a factory function for creating state machines that are constrained to a pre-determined set of possibile state transitions. This function keeps the `state` variable private by encapsulating it within the function's closure scope.
 *
 * The return value is an object containing the following methods:
 *
 * 1. `canTransitionTo::(nextState:string)=>bool` - takes in a string that expected to correspond to a pre-defined states and checks if a transition from the current `state` value to the value of `nextState` is valid before returning true|false.
 *
 * 2. `transitionTo::(nextState:string)=>undefined` - asserts whether or not the transition from the current state to the state passed as input is allowed. if yes, `state` is updated to equal `nextState`.
 *
 * 3. `getStatus::()=>string` - returns the current value assigned to the (private) `state` variable.
 *
 * @param {string} initialState the value assigned to the state machine that the state machine will "state" the "state" declaration
 *
 * Ex. `const initialState = 'open'`
 * @param {Array} allowedTransitionsArray allowedTransitions is an array of arrays which gets turned into a map. The map maps string states to an array of potential next states.
 *
 * Ex. `const allowedTransitions = [['open', ['closed']], ['closed', []], ];`
 *
 * @param {import("@agoric/ertp").Baggage} baggage
 * @returns {{canTransitionTo, transitionTo, getStatus}}
 */
const makeStateMachine = (
  initialState,
  allowedTransitionsArray,
  statusTracker,
) => {
  let state = initialState;
  const allowedTransitions = new Map(allowedTransitionsArray);

  statusTracker.init(STATE_MACHINE_STATUS_KEY, initialState);
  statusTracker.init(EPOCH_TRACKER_KEY, null);
  return harden({
    canTransitionTo: nextState =>
      allowedTransitions.get(state).includes(nextState),
    transitionTo: nextState => {
      console.group('INSIDE makeStateMachine scope');
      console.log(
        'currentStatus ::::',
        statusTracker.get(STATE_MACHINE_STATUS_KEY),
      );
      console.log('----------------------------------');
      console.log('------- BEFORE setStatus -----------');
      assert(allowedTransitions.get(state).includes(nextState));
      state = nextState;
      statusTracker.set(STATE_MACHINE_STATUS_KEY, state);
      console.log('currentState::', { state });
      console.log('----------------------------------');
      console.log('------- AFTER setStatus -----------');
      console.groupEnd();
    },
    getStatus: () => statusTracker.get(STATE_MACHINE_STATUS_KEY),
  });
};
harden(makeStateMachine);

export { makeStateMachine };
