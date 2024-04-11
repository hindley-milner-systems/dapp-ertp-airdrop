import { M, mustMatch } from '@endo/patterns';
import { makeDurableZone } from '@agoric/zone/durable.js';
import { E } from '@endo/far';
import { AmountMath, AmountShape, IssuerShape, PurseShape } from '@agoric/ertp';
import { TimeMath } from '@agoric/time';
import { TimerShape } from '@agoric/zoe/src/typeGuards';
import { depositToSeat } from '@agoric/zoe/src/contractSupport/zoeHelpers.js';
import { makeWaker } from './helpers/time.js';
import {
  handleFirstIncarnation,
  makeCancelTokenMaker,
} from './helpers/validation.js';
import { makeStateMachine } from './helpers/stateMachine.js';
import './types.js';
import '../../types.js';
import { createClaimSuccessMsg } from './helpers/messages.js';
import { getTokenQuantity } from './helpers/objectTools.js';

const privateArgsShape = harden({
  purse: PurseShape,
  timer: TimerShape,
});

const customTermsShape = harden({
  startTime: M.gte(0n),
  initialState: M.string(),
  stateTransitions: M.arrayOf(M.array()),
  states: M.record(),
  schedule: M.array(),
  basePayoutQuantity: AmountShape,
});

/** @type {import('../../types.js').ContractMeta} */
export const meta = {
  customTermsShape,
  privateArgsShape,
  upgradability: 'canUpgrade',
};

/**
 *
 * @typedef {object} ContractTerms
 * @property {object} states Object holding each possible airdrop state. Properties that exisit within this object help mitigate states being misspelled used when transitioning between states.
 * @property {bigint} startTime Length of time (denoted in seconds) between the time in which the contract is started and the time at which users can begin claiming tokens.
 * @property {string} initialState the state in which the contract's stateMachine will begin in.
 * @property {Array} stateTransitions An array of arrays specifying all possibile state transitions that may occur within the contract's state machine. This value is passed into makeStateMachine a
 * @property {[EpochDetails]} schedule
 * @property {bigint} basePayoutQuantity
 * @property {Object.<import('@agoric/ertp').IssuerRecord<import('@agoric/ertp/src/types.js').NatValue>, import('@agoric/ertp/exported.js').Brand>} brands 
  @property {Object.<import('@agoric/ertp').IssuerRecord<import('@agoric/ertp/src/types.js').NatValue>, import('@agoric/ertp/exported.js').Issuer>} issuers  */

/**
 * @param {import('@agoric/zoe/exported.js').zcf} zcf
 * @param {{ purse: import('@agoric/ertp/src/types.js').Purse, timer: import('@agoric/swingset-vat/tools/manual-timer.js').TimerService,}} privateArgs
 * @param {import('@agoric/vat-data').Baggage} baggage
 */
export const start = async (zcf, privateArgs, baggage) => {
  handleFirstIncarnation(baggage, 'LifecycleIteration');
  const zone = makeDurableZone(baggage, 'rootZone');

  const { purse: airdropPurse, timer } = privateArgs;

  /** @type {ContractTerms} */
  const {
    startTime,
    initialState,
    stateTransitions,
    states,
    schedule: distributionSchedule,
    basePayoutQuantity,
    brands: { Token: tokenBrand },
    issuers: { Token: tokenIssuer },
  } = zcf.getTerms();

  const claimedAccountsStore = zone.setStore('claimed users');
  // TODO: Inquire about handling state machine operations using a `Map` or `Set` from the Zone API.
  const contractStateStore = zone.setStore('contract status');

  const stateMachine = makeStateMachine(initialState, stateTransitions);

  const cancelTokenMaker = makeCancelTokenMaker('airdrop-campaign');

  const makeUnderlyingAirdropKit = zone.exoClassKit(
    'Airdrop Campaign',
    {
      helper: M.interface('Helper', {
        combineAmounts: M.call().returns(AmountShape),
        cancelTimer: M.call().returns(M.promise()),
        updateDistributionMultiplier: M.call(M.any()).returns(M.promise()),
        updateEpochDetails: M.call(M.any(), M.any()).returns(),
      }),
      creator: M.interface('Creator', {
        createPayment: M.call().returns(M.any()),
        prepareAirdropCampaign: M.call().returns(M.promise()),
      }),
      claimer: M.interface('Claimer', {
        claim: M.call().returns(M.promise()),
        getAirdropTokenIssuer: M.call().returns(IssuerShape),
        getStatus: M.call().returns(M.string()),
      }),
    },
    /**
     * @param {import('@agoric/ertp/src/types.js').Purse} tokenPurse
     * @param {[EpochDetails]} schedule
     * @param {import('@endo/patterns').CopySet} store
     */
    (tokenPurse, schedule, store) => ({
      currentCancelToken: null,
      currentEpoch: 0,
      distributionSchedule: schedule,
      currentEpochEndTime: 0n,
      basePayout: basePayoutQuantity,
      earlyClaimBonus: getTokenQuantity(schedule),
      internalPurse: tokenPurse,
      claimedAccounts: store,
    }),
    {
      helper: {
        combineAmounts() {
          const { earlyClaimBonus, basePayout } = this.state;
          mustMatch(
            earlyClaimBonus,
            AmountShape,
            'earlyClaimBonus must be an amount.',
          );
          mustMatch(basePayout, AmountShape, 'basePayout must be an amount.');

          return AmountMath.add(earlyClaimBonus, basePayout);
        },
        async cancelTimer() {
          await E(timer).cancel(this.state.currentCancelToken);
        },
        updateEpochDetails(absTime, epochIdx) {
          const newEpochDetails = this.state.distributionSchedule[epochIdx];

          this.state.currentEpochEndTime =
            absTime + newEpochDetails.windowLength;
          this.state.earlyClaimBonus = newEpochDetails.tokenQuantity;

          this.facets.helper.updateDistributionMultiplier(newEpochDetails);
        },
        async updateDistributionMultiplier(newEpochDetails) {
          const { facets } = this;
          const epochDetails = newEpochDetails;

          const { absValue } = await E(timer).getCurrentTimestamp();
          this.state.currentCancelToken = cancelTokenMaker();

          void E(timer).setWakeup(
            TimeMath.absValue(absValue + epochDetails.windowLength),
            makeWaker(
              'updateDistributionEpochWaker',
              ({ absValue: latestTsValue }) => {
                this.state.currentEpoch += 1;
                facets.helper.updateEpochDetails(
                  latestTsValue,
                  this.state.currentEpoch,
                );
              },
            ),
          );
          return 'wake up successfully set.';
        },
      },
      creator: {
        createPayment() {
          return this.state.internalPurse.withdraw(
            this.facets.helper.combineAmounts(),
          );
        },
        async prepareAirdropCampaign() {
          this.state.currentCancelToken = cancelTokenMaker();
          const { facets } = this;
          console.groupEnd();
          await E(timer).setWakeup(
            TimeMath.absValue(startTime),
            makeWaker('claimWindowOpenWaker', ({ absValue }) => {
              stateMachine.transitionTo(states.OPEN);
              facets.helper.updateEpochDetails(
                absValue,
                this.state.currentEpoch,
              );
            }),
            this.state.cancelToken,
          );
        },
      },
      claimer: {
        getStatus() {
          // premptively exposing status for UI-related purposes.
          return stateMachine.getStatus();
        },
        getAirdropTokenIssuer() {
          return tokenIssuer;
        },
        claim() {
          assert(
            stateMachine.getStatus() === states.OPEN,
            'Claim attempt failed.',
          );
          /**
           * @param {import('@agoric/ertp/src/types.js').Payment} payment
           */
          const claimHandler =
            payment =>
            // TODO: figure out type import issue.
            // Unable to get [OfferHandler](https://github.com/Agoric/agoric-sdk/blob/c74c62863bb9de77e66f8d909058804912e72528/packages/zoe/src/contractFacet/types-ambient.d.ts#L214)
            //
            async (seat, offerArgs) => {
              const amount = await E(tokenIssuer).getAmountOf(payment);

              await depositToSeat(
                zcf,
                seat,
                { Payment: amount },
                { Payment: payment },
              );
              seat.exit();
              return createClaimSuccessMsg(amount);
            };
          return zcf.makeInvitation(
            claimHandler(this.facets.creator.createPayment()),
            'airdrop claim handler',
          );
        },
      },
    },
  );

  const { creator, claimer } = makeUnderlyingAirdropKit(
    airdropPurse,
    distributionSchedule,
    claimedAccountsStore,
  );

  // transition from the "initial" state to "prepared" state following the success of `makeUnderlyingAirdropKit`.
  stateMachine.transitionTo(states.PREPARED);

  return harden({
    creatorFacet: creator,
    publicFacet: claimer,
  });
};
harden(start);