// @ts-nocheck
import { M } from '@agoric/store';
import { makeDurableZone } from '@agoric/zone/durable.js';
import { E } from '@endo/far';
import { AmountMath, AmountShape, AssetKind, MintShape } from '@agoric/ertp';
import { TimeMath } from '@agoric/time';
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
  hash: M.string(),
  direction: M.string(),
});

const OfferArgsShape = harden({
  tier: M.number(),
  key: M.string(),
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
  RESTARTING: 'restarting',
};
export const {
  CLOSED,
  EXPIRED,
  INITIALIZED,
  OPEN,
  PAUSED,
  PREPARED,
  RESTARTING,
} = AIRDROP_STATES;
harden(PAUSED);

harden(CLOSED);
harden(OPEN);
harden(EXPIRED);
harden(PREPARED);
harden(INITIALIZED);
harden(RESTARTING);

/** @import {AssetKind, Brand, Issuer, NatValue, Purse} from '@agoric/ertp/src/types.js'; */
/** @import {CancelToken, TimerService, TimestampRecord} from '@agoric/time/src/types.js'; */
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
    console.log('geting deposit facet for::', addr);
    const df = E(namesByAddress).lookup(addr, 'depositFacet');
    console.log('------------------------');
    console.log('df::', df);
    return df;
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
      [PREPARED, [OPEN]],
      [OPEN, [EXPIRED, RESTARTING, PAUSED]],
      [RESTARTING, [OPEN]],
      [PAUSED, [OPEN]],
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

  const divideAmount = divideAmountByTwo(tokenBrand);

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
      startTime: createFutureTs(
        t0,
        harden({ relValue: startTime, timerBrand }),
      ),
    },
    baggage,
  );

  const interfaceGuard = {
    helper: M.interface('Helper', {
      cancelTimer: M.call().returns(M.promise()),
      updateDistributionMultiplier: M.call(M.any()).returns(M.promise()),
      updateEpochDetails: M.call(M.any(), M.any()).returns(),
    }),
    public: M.interface('public facet', {
      makeClaimTokensInvitation: M.call().returns(M.promise()),
      getStatus: M.call().returns(M.string()),
      getEpoch: M.call().returns(M.bigint()),
      getPayoutValues: M.call().returns(M.array()),
    }),
    creator: M.interface('creator', {
      makePauseContractInvitation: M.call(M.any()).returns(M.any()),
      getBankAssetMint: M.call().returns(MintShape),
    }),
  };

  const prepareContract = zone.exoClassKit(
    'Tribble Token Distribution',
    interfaceGuard,
    store => ({
      claimCount: 0,
      lastRecordedTimestamp: null,
      claimedAccounts: store,
      payoutArray: baggage.get('payouts'),
      currentEpoch: null,
    }),
    {
      helper: {
        /**
         * @param {TimestampRecord} absTime
         * @param {bigint} epochIdx
         */
        updateEpochDetails(absTime, epochIdx) {
          const { helper } = this.facets;
          TT('epoch Ending:::', this.state.currentEpoch);
          this.state.currentEpoch = epochIdx;
          TT('epoch starting:::', this.state.currentEpoch);
          if (this.state.currentEpoch === targetNumberOfEpochs) {
            TT('Airdrop is ending!', this.state.currentEpoch);
            zcf.shutdown('Airdrop complete');
            stateMachine.transitionTo(EXPIRED);
          }
          void helper.updateDistributionMultiplier(
            TimeMath.addAbsRel(absTime, targetEpochLength),
          );
        },
        async updateDistributionMultiplier(wakeTime) {
          const { facets } = this;
          makeNewCancelToken();
          TT('previous timestamp:', this.state.lastRecordedTimestamp);
          const currentTimestamp = await E(timer).getCurrentTimestamp();
          this.state.lastRecordedTimestamp = currentTimestamp;
          TT('new timestamp:', this.state.lastRecordedTimestamp);

          TT('baggage.keys', [...baggage.keys()]);
          void E(timer).setWakeup(
            wakeTime,
            makeWaker(
              'updateDistributionEpochWaker',
              /** @param {TimestampRecord} latestTs */
              ({ absValue: latestTs }) => {
                this.state.payoutArray = harden(
                  this.state.payoutArray.map(x => divideAmount(x)),
                );

                baggage.set('payouts', this.state.payoutArray);

                facets.helper.updateEpochDetails(
                  latestTs,
                  this.state.currentEpoch + 1n,
                );
              },
            ),
            cancelToken,
          );

          return 'wake up successfully set.';
        },
        async cancelTimer() {
          await E(timer).cancel(cancelToken);
        },
      },
      public: {
        makeClaimTokensInvitation() {
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
              throw new Error(`Token allocation has already been claimed.`);
            }
            const { proof, key: pubkey, tier } = offerArgs;

            const derivedAddress = computeAddress(pubkey);

            assert.equal(
              getMerkleRootFromMerkleProof(proof),
              merkleRoot,
              'Computed proof does not equal the correct root hash. ',
            );

            const depositFacet = await getDepositFacet(derivedAddress);
            const payment = await withdrawFromSeat(zcf, tokenHolderSeat, {
              Tokens: this.state.payoutArray[tier],
            });
            await Promise.all(
              ...[
                Object.values(payment).map(pmtP =>
                  E.when(pmtP, pmt => E(depositFacet).receive(pmt)),
                ),
                Promise.resolve(
                  accountStore.add(pubkey, {
                    address: derivedAddress,
                    pubkey,
                    tier,
                    amountAllocated: payment.value,
                    epoch: this.state.currentEpoch,
                  }),
                ),
              ],
            );

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
        getStatus() {
          return stateMachine.getStatus();
        },
        getEpoch() {
          return this.state.currentEpoch;
        },
        getPayoutValues() {
          return this.state.payoutArray;
        },
      },
      creator: {
        getBankAssetMint() {
          return tokenMint;
        },

        makePauseContractInvitation(adminDepositFacet) {
          const depositInvitation = async depositFacet => {
            const pauseInvitation = await zcf.makeInvitation(
              // Is this UserSeat argument necessary????
              /** @type {UserSeat} */
              (seat, offerArgs) => {
                assert(
                  stateMachine.canTransitionTo(offerArgs.nextState),
                  `Illegal state transition. Can not transition from state: ${stateMachine.getStatus()} to state ${offerArgs.nextState}`,
                );
                stateMachine.transitionTo(offerArgs.nextState);
                seat.exit('Exiting pause invitation');
                zcf.setOfferFilter(offerArgs.filter);
                void depositInvitation(adminDepositFacet);
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
  } = prepareContract(airdropStatusTracker);

  TT('START TIME', baggage.get('startTime'));
  void E(timer).setWakeup(
    baggage.get('startTime'),
    makeWaker('claimWindowOpenWaker', ({ absValue }) => {
      airdropStatusTracker.init('currentEpoch', 0n);
      helper.updateEpochDetails(absValue, 0n);
      stateMachine.transitionTo(OPEN);
    }),
  );

  stateMachine.transitionTo(PREPARED);

  return harden({
    creatorFacet,
    publicFacet,
  });
};

harden(start);
