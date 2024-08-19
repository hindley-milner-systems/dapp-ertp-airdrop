// @ts-check
/* eslint-disable-next-line import/order */
import { test as anyTest } from '../prepare-test-env-ava.js';
import path from 'path';
import bundleSource from '@endo/bundle-source';
import { E } from '@endo/far';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { AmountMath } from '@agoric/ertp';
import { TimeMath } from '@agoric/time';
import { setup } from '../setupBasicMints.js';
import { eventLoopIteration } from './utils.js';
import {
  getTokenQuantity,
  getWindowLength,
} from '../../src/airdrop/helpers/objectTools.js';
import { createClaimSuccessMsg } from '../../src/airdrop/helpers/messages.js';

/** @import { Amount, AssetKind, Brand } from '@agoric/ertp/src/types.js'; */
const filename = new URL(import.meta.url).pathname;
const dirname = path.dirname(filename);

/** @type {import('ava').TestFn<Awaited<ReturnType<makeTestContext>>>} */
const test = anyTest;

const root = `${dirname}/../../src/airdrop/prepare.js`;

const defaultIntervals = [2_300n, 3_500n, 5_000n, 11_000n, 150_000n, 175_000n];

const DAY = 60n * 60n * 24n;

/**
 * The default value for the array parameter, if not provided.
 *
 * @type {Array<{windowLength: bigint, tokenQuantity: import('@agoric/ertp/src/types.js').NatValue}>}
 */
const defaultDistributionArray = [
  // 159_200n = 1 day, 20:13:20
  { windowLength: 159_200n, tokenQuantity: 10_000n },
  { windowLength: 10n * DAY, tokenQuantity: 6_000n },
  { windowLength: 10n * DAY, tokenQuantity: 3_000n },
  { windowLength: 10n * DAY, tokenQuantity: 1_500n },
  { windowLength: 10n * DAY, tokenQuantity: 750n },
];

/**
 * @typedef {object} EpochDetails
 * @property {bigint} windowLength Length of epoch in seconds. This value is used by the contract's timerService to schedule a wake up that will fire once all of the seconds in an epoch have elapsed
 * @property {import('@agoric/ertp/src/types.js').NatValue} tokenQuantity The total number of tokens recieved by each user who claims during a particular epoch.
 * @property {bigint} index The index of a particular epoch.
 * @property {number} inDays Length of epoch formatted in total number of days
 */

/** @param {Brand} tokenBrand the brand of tokens being distributed to addresses marked as eligible to claim. */
export const createDistributionConfig =
  tokenBrand =>
  /**
   * Creates an array of epoch details for context.
   *
   * @param {Array<{windowLength: bigint, tokenQuantity: import('@agoric/ertp/src/types.js').NatValue}>} [array]
   * @returns {EpochDetails[]} An array containing the epoch details.
   */
  (array = defaultDistributionArray) =>
    harden(
      array.map(({ windowLength, tokenQuantity }, index) => ({
        windowLength, // TODO: use a timerBrand just like tokenBrand
        tokenQuantity: AmountMath.make(tokenBrand, tokenQuantity),
        index: BigInt(index),
        inDays: Number(windowLength / DAY),
      })),
    );

harden(createDistributionConfig);
const AIRDROP_STATES = {
  INITIALIZED: 'initialized',
  PREPARED: 'prepared',
  OPEN: 'claim-window-open',
  EXPIRED: 'claim-window-expired',
  CLOSED: 'claiming-closed',
  RESTARTING: 'restarting',
};
const { OPEN, EXPIRED, PREPARED, INITIALIZED, RESTARTING } = AIRDROP_STATES;

const startState = INITIALIZED;
const allowedTransitions = [
  [startState, [PREPARED]],
  [PREPARED, [OPEN]],
  [OPEN, [EXPIRED, RESTARTING]],
  [RESTARTING, [OPEN]],
  [EXPIRED, []],
];

/** @type {<T>(x: T[]) => T} */
const head = ([x] = []) => x;
/** @type {<T>(xs: T[]) => T[]} */
const tail = ([_, ...xs]) => xs;

const ONE_THOUSAND = 1_000n; // why?

const makeTimer = (logFn, startTime, opts = { eventLoopIteration }) =>
  buildManualTimer(logFn, startTime, opts);
const noop = () => {};
const modernTime = BigInt(new Date(2024, 6, 1, 9).valueOf() / 1000);
const chainTimerService = buildManualTimer(noop, modernTime, {
  timeStep: 60n,
});
const makeTestContext = async t => {
  const { memeMint, memeIssuer, memeKit, memes, zoe, vatAdminState } = setup();

  const TOTAL_SUPPLY = memes(10_000_000n);
  const createMemeTokenDistributionSchedule = createDistributionConfig(
    memeKit.brand,
  );
  const AIRDROP_PAYMENT = memeMint.mintPayment(TOTAL_SUPPLY);
  const AIRDROP_PURSE = memeIssuer.makeEmptyPurse();
  AIRDROP_PURSE.deposit(AIRDROP_PAYMENT);
  const timer = chainTimerService;
  const targetStartTime = 1000n;
  const timerBrand = await E(timer).getTimerBrand();
  const startTime = harden({
    timerBrand,
    relValue: targetStartTime,
  });
  t.deepEqual(TimeMath.relValue(startTime), targetStartTime);
  const isFrozen = x => Object.isFrozen(x);

  t.deepEqual(
    isFrozen(AIRDROP_PURSE),
    true,
    'Purse being passed into contract via privateArgs must be frozen.',
  );
  t.deepEqual(
    isFrozen(timer),
    true,
    'Timer being passed into contract via privateArgs must be frozen.',
  );

  const invitationIssuer = await E(zoe).getInvitationIssuer();
  const invitationBrand = await E(invitationIssuer).getBrand();

  // Pack the contract.
  const bundle = await bundleSource(root);
  vatAdminState.installBundle('b1-ownable-Airdrop', bundle);
  /** @type { Installation<typeof import('../../src/airdropCampaign.js').start> } */
  const installation = await E(zoe).installBundleID('b1-ownable-Airdrop');
  const schedule = createMemeTokenDistributionSchedule(); // harden at creation, not consumption
  const instance = await E(zoe).startInstance(
    installation,
    harden({ Token: memeIssuer }),
    harden({
      basePayoutQuantity: memes(ONE_THOUSAND),
      startTime,
      schedule,
    }),
    harden({
      purse: AIRDROP_PURSE,
      timer,
    }),
    'c1-ownable-Airdrop',
  );

  // Alice will create and fund a call spread contract, and give the invitations
  // to Bob and Carol. Bob and Carol will promptly schedule collection of funds.
  // The spread will then mature at a low price, and carol will get paid.

  // Setup Alice
  // Setup Bob
  // Setup Carol

  // // underlying is 2 Simoleans, strike range is 30-50 (doubled)
  // const terms = harden({
  //   expiration: 2n,
  //   underlyingAmount: simoleans(2n),
  //   priceAuthority,
  //   strikePrice1: moola(60n),
  //   strikePrice2: moola(100n),
  //   settlementAmount: bucks(300n),
  //   timer: manualTimer,
  // });
  return {
    memeIssuer,
    memeKit,
    memes,
    timeIntervals: defaultIntervals,
    instance,
    creatorFacet: instance.creatorFacet,
    publicFacet: instance.publicFacet,
    invitationIssuer,
    invitationBrand,
    zoe,
    timer,
    installation,
    bundle,
    schedule,
  };
};

test.beforeEach('setup', async t => {
  t.context = await makeTestContext(t);
  console.log('CONTEXT:::', t.context);
});

const simulateClaim = async (t, invitation, expectedPayout) => {
  const { zoe, memeIssuer: tokenIssuer } = t.context;
  /** @type {UserSeat} */
  const claimSeat = await E(zoe).offer(invitation);

  t.log('------------ testing claim capabilities -------');
  t.log('-----------------------------------------');
  t.log('AirdropResult', claimSeat);
  t.log('-----------------------------------------');
  t.log('expectedPayout value', expectedPayout);
  t.log('-----------------------------------------');

  //
  t.deepEqual(
    await E(claimSeat).getOfferResult(),
    // Need
    createClaimSuccessMsg(expectedPayout),
  );

  const claimPayment = await E(claimSeat).getPayout('Payment');

  t.deepEqual(await E(tokenIssuer).isLive(claimPayment), true); // any particular reason for isLive check? getAmountOf will do that.
  t.deepEqual(await E(tokenIssuer).getAmountOf(claimPayment), expectedPayout);
};

test('zoe - ownable-Airdrop contract', async t => {
  const {
    schedule: distributionSchedule,
    timeIntervals,
    creatorFacet,
    publicFacet,
    timer,
    memes,
  } = t.context;

  t.is(
    await E(publicFacet).getStatus(),
    AIRDROP_STATES.PREPARED,
    'Contract state machine should update from initialized to prepared upon successful startup.',
  );
  t.deepEqual(
    head(timeIntervals),
    2_300n,
    // are we really testing the head() function here? why not in its own test?
    'head function given an array should return the first item in the array.',
  );
  // the following tests could invoke `creatorFacet` and `publicFacet`
  // synchronously. But we don't in order to better model the user
  // code that might be remote.
  const [TWENTY_THREE_HUNDRED, ELEVEN_THOUSAND] = [2_300n, 11_000n]; // why?

  await E(timer).tickN(20n);
  t.deepEqual(
    await E(publicFacet).getStatus(),
    AIRDROP_STATES.OPEN,
    `Contract state machine should update from ${AIRDROP_STATES.PREPARED} to ${AIRDROP_STATES.OPEN} when startTime is reached.`,
  );

  let schedule = distributionSchedule;
  const startTime = await E(timer).getCurrentTimestamp(); // why scrape off the timerBrand?

  const add = x => y => x + y; // why?

  let bonusTokenQuantity = getTokenQuantity(schedule);
  const firstEpochLength = getWindowLength(schedule);

  const createDistrubtionWakeupTime = TimeMath.addAbsRel(
    startTime,
    firstEpochLength,
  );
  // lastTimestamp = TimeMath.coerceTimestampRecord(lastTimestamp);

  t.deepEqual(
    createDistrubtionWakeupTime.absValue,
    ELEVEN_THOUSAND + TWENTY_THREE_HUNDRED + firstEpochLength,
  );
  t.deepEqual(bonusTokenQuantity, memes(10_000n));

  await simulateClaim(
    t,
    await E(publicFacet).claim(),
    AmountMath.add(bonusTokenQuantity, memes(ONE_THOUSAND)),
  );
  schedule = tail(distributionSchedule);
  bonusTokenQuantity = getTokenQuantity(schedule);
  await E(timer).advanceBy(180_000n);

  t.deepEqual(
    await E(publicFacet).getStatus(),
    AIRDROP_STATES.OPEN,
    `Contract state machine should update from ${AIRDROP_STATES.PREPARED} to ${AIRDROP_STATES.OPEN} when startTime is reached.`,
  );
  t.deepEqual(bonusTokenQuantity, memes(6_000n));

  await simulateClaim(
    t,
    await E(publicFacet).claim(),
    AmountMath.add(bonusTokenQuantity, memes(ONE_THOUSAND)),
  );

  await E(timer).advanceBy(2_660_000n);
  schedule = tail(distributionSchedule);

  t.log('inside test utilities');

  t.deepEqual(
    head(timeIntervals),
    2_300n,
    // are we really testing the head() function here? why not in its own test?
    'head function given an array should return the first item in the array.',
  );

  await simulateClaim(
    t,
    await E(publicFacet).claim(),
    AmountMath.add(memes(3000n), memes(ONE_THOUSAND)),
  );
});
