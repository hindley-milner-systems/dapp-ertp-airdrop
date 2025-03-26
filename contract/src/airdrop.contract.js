// @ts-nocheck
import { M } from '@agoric/store';
import { makeDurableZone } from '@agoric/zone/durable.js';
import { E } from '@endo/far';
import { AmountMath, AmountShape, AssetKind, MintShape } from '@agoric/ertp';
import { TimeMath, TimestampShape } from '@agoric/time';
import { TimerShape } from '@agoric/zoe/src/typeGuards.js';
import { bech32 } from 'bech32';
import { sha256 } from '@noble/hashes/sha256';
import { ripemd160 } from '@noble/hashes/ripemd160';
import {
  atomicRearrange,
  makeRatio,
  withdrawFromSeat,
} from '@agoric/zoe/src/contractSupport/index.js';
import { decodeBase64 } from '@endo/base64';
import { divideBy } from '@agoric/zoe/src/contractSupport/ratio.js';
import { makeTracer, mustMatch } from '@agoric/internal';
import { makeWaker, oneDay } from './helpers/time.js';
import {
  handleFirstIncarnation,
  makeCancelTokenMaker,
} from './helpers/validation.js';
import { makeStateMachine } from './helpers/stateMachine.js';
import { objectToMap } from './helpers/objectTools.js';
import { getMerkleRootFromMerkleProof } from './merkle-tree/index.js';
import '@agoric/zoe/exported.js';

const ProofDataShape = harden({
  hash: M.string({ stringLengthLimit: 64 }),
  direction: M.string({ stringLengthLimit: 5 }),
});

const OfferArgsShape = harden({
  tier: M.number(),
  key: M.string({ stringLengthLimit: 44 }),
  proof: M.arrayOf(ProofDataShape),
});

const compose =
  (...fns) =>
  args =>
    fns.reduceRight((x, f) => f(x), args);

const toAgoricBech = (data, limit) =>
  bech32.encode('agoric', bech32.toWords(data), limit);

/**
 * Creates a digest function for a given hash function.
 *
 * @param {object} hashFn - The hash function object (e.g., sha256, ripemd160).  It must implement `create()` and the resulting object must implement `update()` and `digest()`.
 * @returns {function(Uint8Array): Uint8Array} - A function that takes data and returns the digest.
 */
const createDigest =
  hashFn =>
  /**
   * @param {Uint8Array} data - The data to hash.
   * @returns {Uint8Array} - The hash digest.
   */
  data =>
    hashFn.create().update(data).digest();

const createSha256Digest = createDigest(sha256);
const createRipe160Digest = createDigest(ripemd160);

const computeAddress = compose(
  toAgoricBech,
  createRipe160Digest,
  createSha256Digest,
  decodeBase64,
);

const TT = makeTracer('ContractStartFn');

export const messagesObject = {
  makeClaimInvitationDescription: () => 'claim airdrop',
  makeIllegalActionString: status =>
    `Airdrop can not be claimed when contract status is: ${status}.`,
};
harden(messagesObject);

const AIRDROP_TIERS_STATIC = [9000n, 6500n, 3500n, 1500n, 750n];

const cancelTokenMaker = makeCancelTokenMaker('airdrop-campaign');

const AIRDROP_STATES = {
  CLOSED: 'claiming-closed',
  EXPIRED: 'claim-window-expired',
  INITIALIZED: 'initialized',
  OPEN: 'claim-window-open',
  PAUSED: 'paused',
  PREPARED: 'prepared',
};
export const { CLOSED, EXPIRED, INITIALIZED, OPEN, PAUSED, PREPARED } =
  AIRDROP_STATES;
harden(PAUSED);
harden(CLOSED);
harden(OPEN);
harden(EXPIRED);
harden(PREPARED);
harden(INITIALIZED);

/** @import {AssetKind, Brand, Issuer, NatValue, Purse} from '@agoric/ertp/src/types.js'; */
/** @import {CancelToken, TimerService, TimestampShape, TimestampRecord} from '@agoric/time/src/types.js'; */
/** @import {Baggage} from '@agoric/vat-data'; */
/** @import {Zone} from '@agoric/base-zone'; */
/** @import {ContractMeta} from './@types/zoe-contract-facet.d'; */
/** @import {Remotable} from '@endo/marshal' */

export const privateArgsShape = {
  namesByAddress: M.remotable('marshaller'),
  timer: TimerShape,
};
harden(privateArgsShape);

export const customTermsShape = {
  targetEpochLength: M.bigint(),
  initialPayoutValues: M.arrayOf(M.bigint()),
  tokenName: M.string(),
  targetTokenSupply: M.bigint(),
  targetNumberOfEpochs: M.bigint(),
  startTime: M.bigint(),
  feeAmount: AmountShape,
  merkleRoot: M.string(),
};
harden(customTermsShape);

export const divideAmountByTwo = brand => amount =>
  divideBy(amount, makeRatio(200n, brand), 0n);
harden(divideAmountByTwo);

const handleUpdateCancelToken = (makeCancelTokenFn = cancelTokenMaker) => {
  const cancelToken = makeCancelTokenFn();
  TT('created new cancel token');
  return cancelToken;
};
harden(handleUpdateCancelToken);

/**
 * Utility function that encapsulates the process of creates a token mint, and
 * gathers its associated rand and issuer.
 *
 * @async
 * @param {ZCF} zcf
 * @param {string} tokenName
 * @param {AssetKind} assetKind
 * @param {{ decimalPlaces: number }} displayInfo
 * @returns {{ mint: ZCFMint; brand: Brand; issuer: Issuer }}
 */
const tokenMintFactory = async (
  zcf,
  tokenName,
  assetKind = AssetKind.NAT,
  displayInfo = { decimalPlaces: 6 },
) => {
  const mint = await zcf.makeZCFMint(tokenName, assetKind, {
    ...displayInfo,
    assetKind,
  });
  const { brand, issuer } = await mint.getIssuerRecord();
  return {
    mint,
    brand,
    issuer,
  };
};

const makeToRT = timerBrand => value =>
  TimeMath.coerceRelativeTimeRecord(value, timerBrand);

/**
 * @param {TimestampRecord} sourceTs Base timestamp used to as the starting time
 *   which a new Timestamp will be created against.
 * @param {RelativeTimeRecordShape} inputTs Relative timestamp spanning the
 *   interval of time between sourceTs and the newly created timestamp
 */

const createFutureTs = (sourceTs, inputTs) =>
  TimeMath.absValue(sourceTs) + TimeMath.relValue(inputTs);

const SIX_DIGITS = 1_000_000n;
/**
 * @param {ZCF<ContractTerms>} zcf
 * @param {{ marshaller: Remotable; timer: TimerService }} privateArgs
 * @param {Baggage} baggage
 */
export const start = async (zcf, privateArgs, baggage) => {
  TT('launching contract');
  TT('privateArgs', privateArgs);
  TT('baggage', baggage);
  handleFirstIncarnation(baggage, 'LifecycleIteration');
  // XXX why is type not inferred from makeDurableZone???
  /** @type {Zone} */
  const zone = makeDurableZone(baggage, 'rootZone');

  const { timer, namesByAddress } = privateArgs;

  /**
   * @param {string} addr
   * @returns {ERef<DepositFacet>}
   */
  const getDepositFacet = addr => {
    assert.typeof(addr, 'string');
    return E(namesByAddress).lookup(addr, 'depositFacet');
  };

  /** @type {import('./airdrop.proposal.js').CustomContractTerms} */
  const {
    startTime = 120n,
    targetEpochLength = oneDay,
    targetTokenSupply = 10_000_000n * SIX_DIGITS,
    tokenName = 'Tribbles',
    targetNumberOfEpochs = 5n,
    merkleRoot,
    initialPayoutValues = AIRDROP_TIERS_STATIC.map(x => x * 1_000_000n),
    feeAmount,
    _brands,
  } = zcf.getTerms();

  const airdropStatusTracker = zone.mapStore('airdrop claim window status');

  const accountStore = zone.setStore('claim accounts');
  const stateMachine = makeStateMachine(
    INITIALIZED,
    [
      [INITIALIZED, [PREPARED]],
      [PREPARED, [OPEN, PAUSED]],
      [OPEN, [EXPIRED, PAUSED]],
      [PAUSED, [OPEN, PREPARED]],
      [EXPIRED, []],
    ],
    airdropStatusTracker,
  );

  const [
    timerBrand,
    t0,
    { mint: tokenMint, brand: tokenBrand, issuer: tokenIssuer },
  ] = await Promise.all([
    E(timer).getTimerBrand(),
    E(timer).getCurrentTimestamp(),
    tokenMintFactory(zcf, tokenName),
  ]);

  const toRT = makeToRT(timerBrand);

  let cancelToken = null;
  const makeNewCancelToken = () => {
    cancelToken = handleUpdateCancelToken(cancelTokenMaker);
    TT('Reassigned cancelToken', cancelToken);
  };

  TT('t0', t0);

  const rearrange = transfers => atomicRearrange(zcf, transfers);

  const tokenHolderSeat = tokenMint.mintGains({
    Tokens: AmountMath.make(tokenBrand, targetTokenSupply),
  });

  const halvePayoutAmount = divideAmountByTwo(tokenBrand);

  const startTimestamp = createFutureTs(
    t0,
    harden({ relValue: startTime, timerBrand }),
  );

  const epochLengthTs = toRT(targetEpochLength);

  await objectToMap(
    {
      merkleRoot,
      targetNumberOfEpochs,
      payouts: harden(
        initialPayoutValues.map(x => AmountMath.make(tokenBrand, x)),
      ),
      epochLengthInSeconds: targetEpochLength,
      // Do I need to store tokenIssuer and tokenBrand in baggage?
      tokenIssuer,
      tokenBrand,
      startTime,
    },
    baggage,
  );

  const interfaceGuard = {
    helper: M.interface('Helper', {
      updatePayoutArray: M.call().returns(M.string()),
      cancelTimer: M.call().returns(M.promise()),
      updateDistributionMultiplier: M.call(M.any()).returns(M.promise()),
      updateEpochDetails: M.call(TimestampShape, M.bigint()).returns(
        M.undefined(),
      ),
    }),
    public: M.interface('public facet', {
      makeClaimTokensInvitation: M.call().returns(M.promise()),
    }),
    creator: M.interface('creator', {
      getAirdropTimeDetails: M.call().returns(M.any()),
      makeSetOfferFilterInvitation: M.call(
        M.promise(M.remotable('depositFacet')),
      ).returns(M.promise()),
      getBankAssetMint: M.call().returns(MintShape),
      reconfigureWakers: M.call(M.string(), M.promise()).returns(M.any()),
    }),
  };

  const prepareContract = zone.exoClassKit(
    'Tribble Token Distribution',
    interfaceGuard,
    (store, genesisTimestamp, epochLengthRelTimeRecord, numberOfEpochs) => ({
      claimCount: 0,
      epochLength: epochLengthRelTimeRecord,
      epochStartTime: genesisTimestamp,
      epochEndTime: TimeMath.addAbsRel(
        genesisTimestamp,
        epochLengthRelTimeRecord,
      ),
      lastRecordedTimestamp: null,
      remainingTime: TimeMath.subtractAbsRel(
        genesisTimestamp,
        epochLengthRelTimeRecord,
      ),
      claimedAccounts: store,
      targetNumberOfEpochs: numberOfEpochs,
      payoutArray: baggage.get('payouts'),
      currentEpoch: null,
    }),
    {
      helper: {
        /**
         * @param {TimestampRecord} absTime
         * @param {bigint} nextEpoch
         * @param epochLength
         */
        updateEpochDetails(
          absTime,
          nextEpoch,
          epochLength = targetEpochLength,
        ) {
          TT('nextEpoch', nextEpoch);
          const { helper } = this.facets;
          console.log('targetNumberOfEpochs', targetNumberOfEpochs);
          console.log(
            '(this.state.targetNumberOfEpochs)',
            this.state.targetNumberOfEpochs,
          );
          if (nextEpoch > targetNumberOfEpochs) {
            makeNewCancelToken();
            void E(timer).setWakeup(
              TimeMath.addAbsRel(absTime, toRT(epochLength)),
              makeWaker(
                'claimPeriodEndedWaker',
                /** @param {TimestampRecord} latestTs */
                ({ absValue: latestTs }) => {
                  console.log(
                    'Airdrop complete. ',
                    TimeMath.absValue(latestTs),
                  );
                  return zcf.shutdown(
                    `Airdrop complete. ${TimeMath.absValue(latestTs)}`,
                  );
                },
                cancelToken,
              ),
            );
          } else {
            this.state.currentEpoch = nextEpoch;

            void helper.updateDistributionMultiplier(
              TimeMath.addAbsRel(absTime, toRT(epochLength)),
            );
          }
        },
        /**
         * Configures and manages timer wake-up events for epoch transitions and token distribution updates.
         *
         * This method is responsible for configuring the various "wake-ups" that the timer
         * experiences throughout the contract's lifecycle. To achieve the desired behavior,
         * it utilizes the native `setWakeup` method present on the `chainTimerService`.
         *
         * Regarding `setWakeup`, the contract relies upon the `waker` function's scope to
         * isolate logic that is required to run at the set time (e.g. changing epochs,
         * claim decay, etc).
         *
         * The method performs several key operations:
         * 1. Updates the contract's timestamp records
         * 2. Sets up the next wake-up event
         * 3. Handles token distribution adjustments
         * 4. Manages epoch transitions
         *
         * @param {TimestampRecord} wakeTime - The absolute timestamp at which the timer should wake
         * @returns {Promise<string>} Confirmation message when wake-up is successfully set
         * @throws {Error} If timer setup fails or state transitions are invalid
         *
         * @example
         * await helper.updateDistributionMultiplier(nextWakeTime);
         */
        async updateDistributionMultiplier(wakeTime) {
          const { facets } = this;
          makeNewCancelToken();
          const currentTimestamp = await E(timer).getCurrentTimestamp();
          this.state.lastRecordedTimestamp = currentTimestamp;
          TT('new timestamp:', this.state.lastRecordedTimestamp);
          TT('wakeTime', wakeTime);
          void E(timer).setWakeup(
            wakeTime,
            makeWaker(
              'updateDistributionEpochWaker',
              /** @param {TimestampRecord} latestTs */
              ({ absValue: latestTs }) => {
                console.log('this.state.currentEpoch', this.state.currentEpoch);

                // At this point of execution we are transitioning to the next epoch
                // Before we do that we need to check if the previous epoch was the last one

                facets.helper.updatePayoutArray();
                facets.helper.updateEpochDetails(
                  latestTs,
                  this.state.currentEpoch + 1n,
                  this.state.epochLength,
                );
              },
              cancelToken,
            ),
          );

          return 'wake up successfully set.';
        },
        async cancelTimer() {
          await E(timer).cancel(cancelToken);
        },
        updatePayoutArray() {
          this.state.payoutArray = harden(
            this.state.payoutArray.map(x => halvePayoutAmount(x)),
          );

          return `Successfully updated payoutArray`;
        },
      },
      public: {
        makeClaimTokensInvitation() {
          console.log('CURRENT EPOCH:::', this.state.currentEpoch);
          assert(
            airdropStatusTracker.get('currentStatus') === AIRDROP_STATES.OPEN,
            messagesObject.makeIllegalActionString(
              airdropStatusTracker.get('currentStatus'),
            ),
          );
          /**
           * @param {UserSeat} claimSeat
           * @param {{
           *   proof: Array;
           *   address: string;
           *   key: string;
           *   tier: number;
           * }} offerArgs
           */
          const claimHandler = async (claimSeat, offerArgs) => {
            mustMatch(
              offerArgs,
              OfferArgsShape,
              'offerArgs does not contain the correct data.',
            );

            if (accountStore.has(offerArgs.key)) {
              claimSeat.exit();
              throw new Error('Token allocation has already been claimed.');
            }
            const { proof, key: pubkey, tier } = offerArgs;

            const derivedAddress = computeAddress(pubkey);

            assert.equal(
              getMerkleRootFromMerkleProof(proof),
              merkleRoot,
              'Computed proof does not equal the correct root hash. ',
            );

            const payment = await withdrawFromSeat(zcf, tokenHolderSeat, {
              Tokens: this.state.payoutArray[tier],
            });

            accountStore.add(pubkey, {
              address: derivedAddress,
              pubkey,
              tier,
              amountAllocated: payment.value,
              epoch: this.state.currentEpoch,
            });

            const depositFacet = await getDepositFacet(derivedAddress);
            await Promise.all([
              Object.values(payment).map(pmtP =>
                E.when(pmtP, pmt => E(depositFacet).receive(pmt)),
              ),
            ]);

            rearrange(
              harden([
                [
                  claimSeat,
                  tokenHolderSeat,
                  { Fee: claimSeat.getProposal().give.Fee },
                ],
              ]),
            );

            claimSeat.exit();
            return 'makeClaimTokenInvitation success';
          };

          return zcf.makeInvitation(
            claimHandler,
            messagesObject.makeClaimInvitationDescription(),
            {
              currentEpoch: this.state.currentEpoch,
            },
            M.splitRecord({
              give: { Fee: feeAmount },
            }),
          );
        },
      },
      creator: {
        getAirdropTimeDetails() {
          const {
            remainingTime,
            lastRecordedTimestamp,
            epochStartTime,
            epochEndTime,
            epochLength,
          } = this.state;
          return {
            remainingTime,
            lastRecordedTimestamp,
            epochStartTime,
            epochEndTime,
            epochLength,
          };
        },
        getBankAssetMint() {
          return tokenMint;
        },
        async reconfigureWakers(nextState, currentTimestampP) {
          const currentTimestamp = await currentTimestampP;

          stateMachine.transitionTo(nextState);

          switch (nextState) {
            case PREPARED:
              TT('START TIME', baggage.get('startTime'));
              this.facets.helper.cancelTimer();
              console.log('------------------------');
              console.log('{startTimestamp, currentTimestamp}::', {
                previousStartTimestamp: startTimestamp,
                currentTimestamp,
                newWakeupTimestamp: TimeMath.addAbsRel(
                  currentTimestamp,
                  this.state.remainingTime,
                ),
              });
              void E(timer).setWakeup(
                TimeMath.addAbsRel(currentTimestamp, this.state.remainingTime),
                makeWaker('claimWindowOpenWaker', ({ absValue }) => {
                  TT('claimwindowOpenWaker fired:::', {
                    absValue,
                    remainingTime: this.state.remainingTime,
                    epochLength: this.state.epochLength,
                  });
                  airdropStatusTracker.init('currentEpoch', 1n);
                  this.state.remainingTime = this.state.epochLength;
                  this.facets.helper.updateEpochDetails(absValue, 1n);
                  stateMachine.transitionTo(OPEN);
                }),
                cancelToken,
              );
              break;
            case PAUSED:
              await this.facets.helper.cancelTimer();

              if (
                TimeMath.compareAbs(
                  currentTimestamp,
                  this.state.epochStartTime,
                ) === 1
              ) {
                console.group(`TimeMath.compareAbs(
                  currentTimestamp,
                  this.state.epochStartTime,
                ) === 1:: === TRUE`);
                this.state.remainingTime = TimeMath.subtractAbsAbs(
                  currentTimestamp,
                  this.state.epochStartTime,
                );

                console.log('------------------------');
                console.log(
                  'this.state.remainingTime::',
                  this.state.remainingTime,
                );
                console.groupEnd();
              } else {
                console.group(`TimeMath.compareAbs(
                  currentTimestamp,
                  this.state.epochStartTime,
                ) === 1:: !== TRUE `);
                this.state.remainingTime = TimeMath.subtractAbsAbs(
                  this.state.epochEndTime,
                  currentTimestamp,
                );
                console.log('------------------------');
                console.log(
                  'this.state.remainingTime::',
                  this.state.remainingTime,
                );
                console.groupEnd();
              }

              this.state.lastRecordedTimestamp = currentTimestamp;

              break;
            case OPEN:
              this.facets.helper.cancelTimer();
              this.state.epochEndTime = TimeMath.addAbsRel(
                currentTimestamp,
                this.state.remainingTime.relValue,
              );

              void this.facets.helper.updateEpochDetails(
                TimeMath.absValue(currentTimestamp),
                this.state.currentEpoch,
                this.state.remainingTime.relValue,
              );

              break;
            default:
              break;
          }
        },

        makeSetOfferFilterInvitation(adminDepositFacet) {
          const depositInvitation = async depositFacet => {
            const pauseInvitation = await zcf.makeInvitation(
              // Is this UserSeat argument necessary????
              /** @type {UserSeat} */
              (seat, offerArgs) => {
                assert(
                  stateMachine.canTransitionTo(offerArgs.nextState),
                  `Illegal state transition. Can not transition from state: ${stateMachine.getStatus()} to state ${offerArgs.nextState}`,
                );

                seat.exit('Exiting pause invitation');

                zcf.setOfferFilter(offerArgs.filter);
                void depositInvitation(adminDepositFacet);
                void this.facets.creator.reconfigureWakers(
                  offerArgs.nextState,
                  E(timer).getCurrentTimestamp(),
                );
              },
              'set offer filter',
            );
            E(depositFacet).receive(pauseInvitation);
          };
          const recievedPause = depositInvitation(adminDepositFacet);
          return recievedPause;
        },
      },
    },
  );

  const {
    creator: creatorFacet,
    helper,
    public: publicFacet,
  } = prepareContract(
    airdropStatusTracker,
    startTimestamp,
    epochLengthTs,
    targetNumberOfEpochs,
  );

  TT('START TIME', baggage.get('startTime'));
  makeNewCancelToken();
  void E(timer).setWakeup(
    startTimestamp,
    makeWaker('claimWindowOpenWaker', ({ absValue }) => {
      airdropStatusTracker.init('currentEpoch', 1n);
      helper.updateEpochDetails(absValue, 1n);
      stateMachine.transitionTo(OPEN);
    }),
    cancelToken,
  );

  stateMachine.transitionTo(PREPARED);

  return harden({
    creatorFacet,
    publicFacet,
  });
};

harden(start);
