/**
 * @file contract.test.js
 * @description this test file demonstrates behavior for all contract interaction.
 */

/* eslint-disable import/order */
// @ts-check
/* global setTimeout, fetch */
// XXX what's the state-of-the-art in ava setup?
// eslint-disable-next-line import/order
import { test as anyTest } from '../prepare-test-env-ava.js';
import { TimeMath } from '@agoric/time';

import { createRequire } from 'module';
import { env as ambientEnv } from 'node:process';
import * as ambientChildProcess from 'node:child_process';
import * as ambientFsp from 'node:fs/promises';
import { E, passStyleOf } from '@endo/far';
import { extract } from '@agoric/vats/src/core/utils.js';
import {
  makeTerms,
  permit,
  startAirdrop,
} from '../../src/airdrop.local.proposal.js';
import {
  makeBundleCacheContext,
  getBundleId,
} from '../../tools/bundle-tools.js';
import { makeE2ETools } from '../../tools/e2e-tools.js';
import {
  makeNameProxy,
  makeAgoricNames,
} from '../../tools/ui-kit-goals/name-service-client.js';
import { makeMockTools } from '../../tools/boot-tools.js';
import { makeStableFaucet } from '../mintStable.js';
import {
  AIRDROP_AMOUNT_VALUES,
  makeAsyncObserverObject,
  makeOfferArgs,
  traceFn,
  makeTestWallets,
  makeMakeContractPauseOfferSpecs,
} from './test-utils.js';
import { merkleTreeObj } from './generated_keys.js';
import { AmountMath } from '@agoric/ertp';
import { head } from '../../src/helpers/index.js';
import {
  messagesObject,
  OPEN,
  PAUSED,
  PREPARED,
} from '../../src/airdrop.contract.js';

const { accounts } = merkleTreeObj;
// import { makeAgdTools } from '../agd-tools.js';

/** @type {import('ava').TestFn<Awaited<ReturnType<makeTestContext>>>} */
const test = anyTest;

const nodeRequire = createRequire(import.meta.url);

const bundleRoots = {
  tribblesAirdrop: nodeRequire.resolve('../../src/airdrop.contract.js'),
};

const { E2E } = ambientEnv;
const { execFileSync, execFile } = ambientChildProcess;

const { writeFile } = ambientFsp;
/** @type {import('../../tools/agd-lib.js').ExecSync} */
const dockerExec = (file, args, opts = { encoding: 'utf-8' }) => {
  const workdir = '/workspace/contract';
  const execArgs = ['compose', 'exec', '--workdir', workdir, 'agd'];
  opts.verbose &&
    console.log('docker compose exec', JSON.stringify([file, ...args]));
  return execFileSync('docker', [...execArgs, file, ...args], opts);
};

/** @param {import('ava').ExecutionContext} t */
const makeTestContext = async t => {
  const bc = await makeBundleCacheContext(t);

  console.time('makeTestTools');
  console.timeLog('makeTestTools', 'start');
  // installBundles,
  // runCoreEval,
  // provisionSmartWallet,
  // runPackageScript???
  const tools = await (E2E
    ? makeE2ETools(t, bc.bundleCache, {
        execFileSync: dockerExec,
        execFile,
        fetch,
        setTimeout,
        writeFile,
      })
    : makeMockTools(t, bc.bundleCache));
  console.timeEnd('makeTestTools');

  return { ...tools, ...bc };
};

test.before(async t => (t.context = await makeTestContext(t)));

//  console.log('after makeAgdTools:::', { context: t.context });

test.serial('we1ll-known brand (ATOM) is available', async t => {
  const { makeQueryTool } = t.context;
  const hub0 = makeAgoricNames(makeQueryTool());
  const agoricNames = makeNameProxy(hub0);
  await null;
  const brand = {
    ATOM: await agoricNames.brand.ATOM,
  };
  t.log(brand);
  t.is(passStyleOf(brand.ATOM), 'remotable');
});

test.serial('install bundle: airdrop / tribblesAirdrop', async t => {
  const { installBundles } = t.context;
  console.time('installBundles');
  console.timeLog('installBundles', Object.keys(bundleRoots).length, 'todo');
  const bundles = await installBundles(bundleRoots, (...args) =>
    console.timeLog('installBundles', ...args),
  );

  console.timeEnd('installBundles');

  const id = getBundleId(bundles.tribblesAirdrop);
  const shortId = id.slice(0, 8);
  t.log('bundleId', shortId);
  t.is(id.length, 3 + 128, 'bundleID length');
  t.regex(id, /^b1-.../);
  console.groupEnd();
  Object.assign(t.context.shared, { bundles });
  t.truthy(
    t.context.shared.bundles.tribblesAirdrop,
    't.context.shared.bundles should contain a property "tribblesAirdrop"',
  );
});

let defaultId = 0;
const makeMutableId = () => {
  defaultId += 1;
  return defaultId;
};
const makeMakeOfferSpec =
  instance =>
  (account, feeAmount, id = makeMutableId()) => ({
    id: `offer-${id}`,
    invitationSpec: {
      source: 'contract',
      instance,
      publicInvitationMaker: 'makeClaimTokensInvitation',
    },
    proposal: { give: { Fee: feeAmount } },
    offerArgs: { ...makeOfferArgs(account) },
  });

/**
 * @test Verifies that the airdrop contract correctly handles state transitions through multiple states
 * @summary Tests the complete lifecycle of pausing and resuming an airdrop contract, specifically:
 * 1. Admin can pause a contract in PREPARED state using makeSetOfferFilterInvitation
 * 2. Pausing prevents automatic transition to OPEN state when startTime is reached
 * 3. Admin can unpause the contract by transitioning back to PREPARED state
 * 4. After unpausing, contract correctly transitions to OPEN state when startTime is reached
 * 5. Users can successfully claim tokens after the full state transition sequence
 * 6. Claimed token amounts are correctly calculated based on the user's tier and current epoch
 * @param {import('ava').TestFn} t - AVA's test context object. Provides assertion methods and other utilities.
 * @async
 */
test.serial(
  'contract state transitions: PREPARED -> PAUSED -> PREPARED -> OPEN -> PAUSED -> OPEN should work correctly',
  async t => {
    const merkleRoot = merkleTreeObj.root;
    const { bundleCache } = t.context;

    t.log('starting contract with merkleRoot:', merkleRoot);
    // Is there a better way to obtain a reference to this bundle???
    // or is this just fine??
    const { tribblesAirdrop } = t.context.shared.bundles;

    const bundleID = getBundleId(tribblesAirdrop);
    const {
      powers,
      vatAdminState,
      makeMockWalletFactory,
      provisionSmartWallet,
    } = await makeMockTools(t, bundleCache);

    const { feeMintAccess, zoe } = powers.consume;

    vatAdminState.installBundle(bundleID, tribblesAirdrop);
    const adminWallet = await provisionSmartWallet(
      'agoric1jng25adrtpl53eh50q7fch34e0vn4g72j6zcml',
      {
        BLD: 10n,
      },
    );

    const zoeIssuer = await E(zoe).getInvitationIssuer();

    const zoeBrand = await zoeIssuer.getBrand();
    const adminZoePurse = E(adminWallet.peek).purseUpdates(zoeBrand);

    const airdropPowers = extract(permit, powers);

    const { chainTimerService } = airdropPowers.consume;

    const timerBrand = await E(chainTimerService).getTimerBrand();

    await startAirdrop(airdropPowers, {
      options: {
        customTerms: {
          ...makeTerms(), // default terms meaning contract will last 5 epochs.
          startTime: 4600n, // Contract will be in "PREPARED" stae for 6 hours (21_600n seconds).
          targetEpochLength: 86_400n / 4n, // Contract will have 4 hour epochs.
          merkleRoot: merkleTreeObj.root,
        },
        tribblesAirdrop: { bundleID },
      },
    });

    const t0 = await E(chainTimerService).getCurrentTimestamp();

    const expectedStartTime = TimeMath.addAbsRel(
      t0,

      harden({ relValue: 4600n, timerBrand }),
    );

    const expectedEndTime = TimeMath.addAbsRel(
      expectedStartTime,
      harden({ relValue: 86_400n, timerBrand }),
    );

    t.log(
      `expectedEndTime::: contract state transitions: PREPARED -> PAUSED -> PREPARED -> OPEN should work correctly`,
      expectedEndTime,
    );

    // INVESTIGATION
    // Looking into the mount of time it takes for 1 `tick` to ake place.
    //
    await E(chainTimerService).tickN(50n);
    const t2 = await E(chainTimerService).getCurrentTimestamp();

    await makeAsyncObserverObject(
      adminZoePurse,
      'invitation recieved',
      1,
    ).subscribe({
      next: traceFn('ADMIN_WALLET::: NEXT'),
      error: traceFn('ADMIN WALLET::: ERROR'),
      complete: async ({ message, values }) => {
        const [pauseInvitationDetails] = values;
        t.deepEqual(message, 'invitation recieved');
        t.deepEqual(pauseInvitationDetails.brand, zoeBrand);
        t.deepEqual(
          head(pauseInvitationDetails.value).description,
          'set offer filter',
        );
      },
    });
    /** @type {import('../../src/airdrop.local.proposal.js').AirdropSpace} */
    // @ts-expeimport { merkleTreeObj } from '@agoric/orchestration/src/examples/airdrop/generated_keys.js';
    const airdropSpace = powers;
    const instance = await airdropSpace.instance.consume.tribblesAirdrop;

    // Invoked when the contract is in the "PREPARED" state.
    const pauseOffer = {
      id: 'pause-prepared-contract-0',
      invitationSpec: {
        source: 'purse',
        instance,
        description: 'set offer filter',
      },
      proposal: {},
      offerArgs: {
        nextState: PAUSED,
        filter: [messagesObject.makeClaimInvitationDescription()],
      },
    };
    const pauseOfferUpdater = E(adminWallet.offers).executeOffer(pauseOffer);

    await makeAsyncObserverObject(pauseOfferUpdater).subscribe({
      next: traceFn('pauseOfferUpdater ## next'),
      error: traceFn('pauseOfferUpdater## Error'),
      complete: traceFn('pauseOfferUpdater ## complete'),
    });

    // Confirms that the admin recieves a new invitation upon using `makeSetOfferFilterInvitation`
    await E(chainTimerService).advanceBy(TimeMath.absValue(t2) + 4600n);
    await makeAsyncObserverObject(
      adminZoePurse,
      'invitation recieved',
      1,
    ).subscribe({
      next: traceFn('ADMIN_WALLET::: NEXT'),
      error: traceFn('ADMIN WALLET::: ERROR'),
      complete: async ({ message, values }) => {
        const [pauseInvitationDetails] = values;
        t.deepEqual(message, 'invitation recieved');
        t.deepEqual(pauseInvitationDetails.brand, zoeBrand);
        t.deepEqual(
          head(pauseInvitationDetails.value).description,
          'set offer filter',
        );
      },
    });

    // Simulates time passing to demonstrate that the initial TimerWaker does not get invoked due to it being cancelled.
    await E(chainTimerService).tickN(575n);

    const t3 = await E(chainTimerService).getCurrentTimestamp();

    t.deepEqual(
      TimeMath.compareAbs(t3, expectedStartTime),
      1,
      'Absolute timestamp contract initially expected to open claiming windo',
    );
    const removePauseOffer = {
      id: 'pause-removal-0',
      invitationSpec: {
        source: 'purse',
        instance,
        description: 'set offer filter',
      },
      proposal: {},
      offerArgs: {
        nextState: PREPARED,
        filter: [],
      },
    };
    const removePauseOfferUpdater = E(adminWallet.offers).executeOffer(
      removePauseOffer,
    );

    await makeAsyncObserverObject(removePauseOfferUpdater).subscribe({
      next: traceFn('removePauseOfferUpdater ## next'),
      error: traceFn('removePauseOfferUpdater## Error'),
      complete: traceFn('removePauseOfferUpdater ## complete'),
    });

    const t4 = await E(chainTimerService).getCurrentTimestamp();

    t.log('t4 timestamp:: after removing pause', t4);
    // ensure that the contract MUST have transitioned from "PREPARED" to "OPEN" state.
    await E(chainTimerService).advanceBy(TimeMath.absValue(t4) + 4600n);
    await E(chainTimerService).tickN(1200n);

    t.log(
      `after 
      await E(chainTimerService).advanceBy(TimeMath.absValue(t4) + 4600n);
     await E(chainTimerService).tickN(1200n)
      `,
      await E(chainTimerService).getCurrentTimestamp(),
    );
    const terms = await E(zoe).getTerms(instance);

    const { issuers, brands } = terms;

    const walletFactory = makeMockWalletFactory({
      Tribbles: issuers.Tribbles,
      Fee: issuers.Fee,
    });
    const wallets = await makeTestWallets(walletFactory.makeSmartWallet);

    const { alice: aliceAccount } = wallets;

    const { faucet, mintBrandedPayment } = makeStableFaucet({
      bundleCache,
      feeMintAccess,
      zoe,
    });

    await Object.values(wallets).map(async account => {
      const pmt = await mintBrandedPayment(10n);
      console.log('payment::', pmt);
      await E(account.wallet.deposit).receive(pmt);
    });
    const makeOfferSpec = makeMakeOfferSpec(instance);

    await faucet(5n * 1_000_000n);

    const makeFeeAmount = () => AmountMath.make(brands.Fee, 5n);

    const aliceTier = 0;

    t.log(
      'demonstrating a claim after contract has transitioned: PREPARED -> PAUSED -> PREPARED -> OPEN',
    );
    const alice = [
      E(aliceAccount.wallet.offers).executeOffer(
        makeOfferSpec({ ...aliceAccount }, makeFeeAmount(), 0),
      ),
      E(aliceAccount.wallet.peek).purseUpdates(brands.Tribbles),
    ];

    const [alicesOfferUpdates, alicesPurse] = alice;

    /**
     */
    await makeAsyncObserverObject(alicesOfferUpdates).subscribe({
      next: traceFn('AliceOffer::1 ### SUBSCRIBE.NEXT'),
      error: traceFn('AliceOffer::1 ### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(message, 'Iterator lifecycle complete.');
        t.deepEqual(values.length, 4);
      },
    });

    await makeAsyncObserverObject(
      alicesPurse,
      'AsyncGenerator alicePurse has fufilled its requirements.',
      1,
    ).subscribe({
      next: traceFn('alicesPurse ### SUBSCRIBE.NEXT'),
      error: traceFn('alicesPurse #### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(
          message,
          'AsyncGenerator alicePurse has fufilled its requirements.',
        );
        t.deepEqual(
          head(values),
          AmountMath.make(brands.Tribbles, AIRDROP_AMOUNT_VALUES[aliceTier]),
          'alicesPurse should receive the correct number of tokens allocated to tier 0  claimants who claiming during the 2nd epoch',
        );
      },
    });

    await E(chainTimerService).tickN(4000n);
  },
);

/**
 * @test Verifies that the airdrop contract correctly handles state transitions through multiple states
 * @summary Tests the complete lifecycle of pausing and resuming an airdrop contract, specifically:
 * 1. Admin can pause a contract in PREPARED state using makeSetOfferFilterInvitation
 * 2. Pausing prevents automatic transition to OPEN state when startTime is reached
 * 3. Admin can unpause the contract by transitioning back to PREPARED state
 * 4. After unpausing, contract correctly transitions to OPEN state when startTime is reached
 * 5. Users can successfully claim tokens after the full state transition sequence
 * 6. Claimed token amounts are correctly calculated based on the user's tier and current epoch
 * @param {import('ava').TestFn} t - AVA's test context object. Provides assertion methods and other utilities.
 * @async
 */
test.serial(
  'contract state transitions: CLAIM-WINDOW-OPEN -> PAUSED -> CLAIM-WINDOW-OPEN',
  async t => {
    const merkleRoot = merkleTreeObj.root;
    const { bundleCache } = t.context;

    t.log('starting contract with merkleRoot:', merkleRoot);
    // Is there a better way to obtain a reference to this bundle???
    // or is this just fine??
    const { tribblesAirdrop } = t.context.shared.bundles;

    const bundleID = getBundleId(tribblesAirdrop);
    const {
      powers,
      vatAdminState,
      makeMockWalletFactory,
      provisionSmartWallet,
    } = await makeMockTools(t, bundleCache);

    const { feeMintAccess, zoe } = powers.consume;

    vatAdminState.installBundle(bundleID, tribblesAirdrop);
    const adminWallet = await provisionSmartWallet(
      'agoric1jng25adrtpl53eh50q7fch34e0vn4g72j6zcml',
      {
        BLD: 10n,
      },
    );

    const zoeIssuer = await E(zoe).getInvitationIssuer();

    const zoeBrand = await zoeIssuer.getBrand();
    const adminZoePurse = E(adminWallet.peek).purseUpdates(zoeBrand);

    const airdropPowers = extract(permit, powers);

    const { chainTimerService } = airdropPowers.consume;

    const timerBrand = await E(chainTimerService).getTimerBrand();

    await startAirdrop(airdropPowers, {
      options: {
        customTerms: {
          ...makeTerms(), // default terms meaning contract will last 5 epochs.
          startTime: 0n, // Contract will be in "PREPARED" stae for 6 hours (21_600n seconds).
          targetEpochLength: 43200n, // Contract will have 4 hour epochs.
          merkleRoot: merkleTreeObj.root,
        },
        tribblesAirdrop: { bundleID },
      },
    });

    const t0 = await E(chainTimerService).getCurrentTimestamp();
    const expectedEndTime = TimeMath.addAbsRel(
      t0,
      harden({ relValue: 43200n * 5n, timerBrand }),
    );
    t.log(
      `expectedEndTime::: contract state transitions: CLAIM-WINDOW-OPEN -> PAUSED -> CLAIM-WINDOW-OPEN`,
      expectedEndTime,
    );
    // INVESTIGATION
    // Looking into the mount of time it takes for 1 `tick` to ake place.
    //
    await E(chainTimerService).tickN(50n);
    const t2 = await E(chainTimerService).getCurrentTimestamp();

    await makeAsyncObserverObject(
      adminZoePurse,
      'invitation recieved',
      1,
    ).subscribe({
      next: traceFn('ADMIN_WALLET::: NEXT'),
      error: traceFn('ADMIN WALLET::: ERROR'),
      complete: async ({ message, values }) => {
        const [pauseInvitationDetails] = values;
        t.deepEqual(message, 'invitation recieved');
        t.deepEqual(pauseInvitationDetails.brand, zoeBrand);
        t.deepEqual(
          head(pauseInvitationDetails.value).description,
          'set offer filter',
        );
      },
    });
    /** @type {import('../../src/airdrop.local.proposal.js').AirdropSpace} */
    // @ts-expeimport { merkleTreeObj } from '@agoric/orchestration/src/examples/airdrop/generated_keys.js';
    const airdropSpace = powers;
    const instance = await airdropSpace.instance.consume.tribblesAirdrop;

    const terms = await E(zoe).getTerms(instance);
    const { issuers, brands } = terms;

    const makeFeeAmount = () => AmountMath.make(brands.Fee, 5n);

    const walletFactory = makeMockWalletFactory({
      Tribbles: issuers.Tribbles,
      Fee: issuers.Fee,
    });

    const wallets = await makeTestWallets(walletFactory.makeSmartWallet);

    const {
      alice: aliceAccount,
      bob: bobAccount,
      carol: carolAccount,
    } = wallets;

    const { faucet, mintBrandedPayment } = makeStableFaucet({
      bundleCache,
      feeMintAccess,
      zoe,
    });

    await Object.values(wallets).map(async account => {
      const pmt = await mintBrandedPayment(10n);
      console.log('payment::', pmt);
      await E(account.wallet.deposit).receive(pmt);
    });
    await faucet(5n * 1_000_000n);
    const {
      pauseContract: makePauseContractOffer,
      unpauseContract: makeResumeContractOffer,
    } = makeMakeContractPauseOfferSpecs(instance);
    const makeOfferSpec = makeMakeOfferSpec(instance);
    const bob = [
      E(bobAccount.wallet.offers).executeOffer(
        makeOfferSpec({ ...bobAccount }, makeFeeAmount(), 0),
      ),
      E(bobAccount.wallet.peek).purseUpdates(brands.Tribbles),
    ];

    const [bobsOfferUpdates, bobsPurse] = bob;

    await makeAsyncObserverObject(bobsOfferUpdates).subscribe({
      next: traceFn('BobOffer::1 ### SUBSCRIBE.NEXT'),
      error: traceFn('BobOffer::1 ### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(message, 'Iterator lifecycle complete.');
        t.deepEqual(values.length, 4);
      },
    });

    await makeAsyncObserverObject(
      bobsPurse,
      'AsyncGenerator bobsPurse has fufilled its requirements.',
      1,
    ).subscribe({
      next: traceFn('bobsPurse ### SUBSCRIBE.NEXT'),
      error: traceFn('bobsPurse #### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(
          message,
          'AsyncGenerator bobsPurse has fufilled its requirements.',
        );
        t.deepEqual(
          head(values),
          AmountMath.make(brands.Tribbles, AIRDROP_AMOUNT_VALUES[0]),
          'bobsPurse should receive the correct number of tokens allocated to tier 0  claimants who claiming during the 1st epoch',
        );
      },
    });

    t.log(
      'Successfully verified user ability to claim tokens from airdrop while claiming window is open.',
    );

    const pauseOfferUpdater = E(adminWallet.offers).executeOffer(
      makePauseContractOffer(),
    );

    await makeAsyncObserverObject(pauseOfferUpdater).subscribe({
      next: traceFn('pauseOfferUpdater ## next'),
      error: traceFn('pauseOfferUpdater## Error'),
      complete: traceFn('pauseOfferUpdater ## complete'),
    });

    // Confirms that the admin recieves a new invitation upon using `makeSetOfferFilterInvitation`
    await E(chainTimerService).advanceTo(TimeMath.absValue(t2) + 4600n);
    await makeAsyncObserverObject(
      adminZoePurse,
      'invitation recieved',
      1,
    ).subscribe({
      next: traceFn('ADMIN_WALLET::: NEXT'),
      error: traceFn('ADMIN WALLET::: ERROR'),
      complete: async ({ message, values }) => {
        const [pauseInvitationDetails] = values;
        t.deepEqual(message, 'invitation recieved');
        t.deepEqual(pauseInvitationDetails.brand, zoeBrand);
        t.deepEqual(
          head(pauseInvitationDetails.value).description,
          'set offer filter',
        );
      },
    });

    // Simulates time passing to demonstrate that the initial TimerWaker does not get invoked due to it being cancelled.
    await E(chainTimerService).tickN(1575n);

    const t3 = await E(chainTimerService).getCurrentTimestamp();

    t.log('t3', t3);
    const startTimeRecord = harden({ relValue: 4600n, timerBrand });

    const initialStartTime = TimeMath.addAbsRel(t0, startTimeRecord);

    const disallowedClaimAttempt = await E(
      bobAccount.wallet.offers,
    ).executeOffer(
      makeOfferSpec({ ...accounts[5], tier: 0 }, makeFeeAmount(), 0),
    );

    const { subtractAbsAbs } = TimeMath;

    await E(chainTimerService).tick();
    // const oneTime = subtractAbsAbs(t3);
    t.throwsAsync(
      makeAsyncObserverObject(disallowedClaimAttempt).subscribe({
        next: traceFn('disallowedClaimAttempt ## next'),
        error: traceFn('disallowedClaimAttempt## error'),
        complete: traceFn('disallowedClaimAttempt ## complete'),
      }),
      {
        message: 'Airdrop can not be claimed when contract status is: paused.',
      },
    );

    t.log('Successfully verified the inability to claim airdrop while paused.');

    t.deepEqual(
      TimeMath.compareAbs(t3, initialStartTime),
      1,
      'Absolute timestamp contract initially expected to open claiming windo',
    );
    const removePauseOffer = {
      id: 'pause-removal-0',
      invitationSpec: {
        source: 'purse',
        instance,
        description: 'set offer filter',
      },
      proposal: {},
      offerArgs: {
        nextState: OPEN,
        filter: [],
      },
    };
    const removePauseOfferUpdater = E(adminWallet.offers).executeOffer(
      removePauseOffer,
    );

    await makeAsyncObserverObject(removePauseOfferUpdater).subscribe({
      next: traceFn('removePauseOfferUpdater ## next'),
      error: traceFn('removePauseOfferUpdater## Error'),
      complete: traceFn('removePauseOfferUpdater ## complete'),
    });

    const aliceTier = 0;

    t.log(
      'demonstrating a claim after contract has transitioned: PREPARED -> PAUSED -> PREPARED -> OPEN',
    );

    await E(chainTimerService).tickN(250n);
    const alice = [
      E(aliceAccount.wallet.offers).executeOffer(
        makeOfferSpec({ ...aliceAccount }, makeFeeAmount(), 0),
      ),
      E(aliceAccount.wallet.peek).purseUpdates(brands.Tribbles),
    ];

    const [alicesOfferUpdates, alicesPurse] = alice;

    /**
     */
    await makeAsyncObserverObject(alicesOfferUpdates).subscribe({
      next: traceFn('AliceOffer::1 ### SUBSCRIBE.NEXT'),
      error: traceFn('AliceOffer::1 ### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(message, 'Iterator lifecycle complete.');
        t.deepEqual(values.length, 4);
      },
    });

    t.log(
      '------- Contract state transitions: PREPARED --> PAUSED --> PREPARED --> OPEN -------',
    );
    t.log('Demonstrated claiming tokens during 1st epoch.');

    await makeAsyncObserverObject(
      alicesPurse,
      'AsyncGenerator alicePurse has fufilled its requirements.',
      1,
    ).subscribe({
      next: traceFn('alicesPurse ### SUBSCRIBE.NEXT'),
      error: traceFn('alicesPurse #### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(
          message,
          'AsyncGenerator alicePurse has fufilled its requirements.',
        );
        t.deepEqual(
          head(values),
          AmountMath.make(
            brands.Tribbles,
            AIRDROP_AMOUNT_VALUES[aliceTier] / 2n,
          ),
          'alicesPurse should receive the correct number of tokens allocated to tier 0 claimants who claiming during the 2nd epoch',
        );
      },
    });

    // Invoked when the contract is in the "PREPARED" state.

    const secondPauseOfferUpdater = E(adminWallet.offers).executeOffer(
      makePauseContractOffer('pause-contract-1'),
    );

    await makeAsyncObserverObject(secondPauseOfferUpdater).subscribe({
      next: traceFn('pauseOfferUpdater ## next'),
      error: traceFn('pauseOfferUpdater## Error'),
      complete: traceFn('pauseOfferUpdater ## complete'),
    });

    // Confirms that the admin recieves a new invitation upon using `makeSetOfferFilterInvitation`
    await E(chainTimerService).advanceBy(TimeMath.absValue(t2) + 4600n);
    await makeAsyncObserverObject(
      adminZoePurse,
      'invitation recieved',
      1,
    ).subscribe({
      next: traceFn('ADMIN_WALLET::: NEXT'),
      error: traceFn('ADMIN WALLET::: ERROR'),
      complete: async ({ message, values }) => {
        const [pauseInvitationDetails] = values;
        t.deepEqual(message, 'invitation recieved');
        t.deepEqual(pauseInvitationDetails.brand, zoeBrand);
        t.deepEqual(
          head(pauseInvitationDetails.value).description,
          'set offer filter',
        );
      },
    });

    // Simulates time passing to demonstrate that the initial TimerWaker does not get invoked due to it being cancelled.
    await E(chainTimerService).advanceBy(43200n);

    t.log('');

    const resumeContractOfferUpdater = E(adminWallet.offers).executeOffer(
      makeResumeContractOffer('pause-removal-1', OPEN),
    );

    t.log(
      '------- Contract state transitions: PREPARED --> PAUSED --> PREPARED --> OPEN --> PAUSED --> OPEN -------',
    );

    await makeAsyncObserverObject(resumeContractOfferUpdater).subscribe({
      next: traceFn('removePauseOfferUpdater ## next'),
      error: traceFn('removePauseOfferUpdater## Error'),
      complete: traceFn('removePauseOfferUpdater ## complete'),
    });

    // ensure that the contract MUST have transitioned from "PREPARED" to "OPEN" state.

    const carol = [
      E(carolAccount.wallet.offers).executeOffer(
        makeOfferSpec({ ...carolAccount }, makeFeeAmount(), 0),
      ),
      E(carolAccount.wallet.peek).purseUpdates(brands.Tribbles),
    ];

    const [carolsOfferUpdater, carolsPurse] = carol;

    await makeAsyncObserverObject(carolsOfferUpdater).subscribe({
      next: traceFn('CarolOffer::1 ### SUBSCRIBE.NEXT'),
      error: traceFn('CarolOffer::1 ### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(message, 'Iterator lifecycle complete.');
        t.deepEqual(values.length, 4);
      },
    });

    await makeAsyncObserverObject(
      carolsPurse,
      'AsyncGenerator carolsPurse has fufilled its requirements.',
      1,
    ).subscribe({
      next: traceFn('carolsPurse ### SUBSCRIBE.NEXT'),
      error: traceFn('carolsPurse #### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(
          message,
          'AsyncGenerator carolsPurse has fufilled its requirements.',
        );
        t.deepEqual(
          head(values),
          AmountMath.make(brands.Tribbles, AIRDROP_AMOUNT_VALUES[4] / 2n / 2n), // Second epoch (1), tier 4
          'carolsPurse should receive the correct number of tokens allocated to tier 4 claimants who claiming during the 2nd epoch',
        );
      },
    });

    await E(chainTimerService).advanceBy(43200n);

    const t5 = await E(chainTimerService).getCurrentTimestamp();

    t.log('current timestamp > ex');
    t.deepEqual(TimeMath.compareAbs(t5, expectedEndTime), 1);

    t.log('pause contract test complet');
    t.log('----------------------');
    t.log('expected end time::', expectedEndTime);
    t.log('actual end time', t5);
    t.log('number of pauses:::', 2);
    const exitMessage = await E(vatAdminState).getExitMessage();

    t.deepEqual(
      exitMessage === 'Airdrop complete',
      true,
      'should shutdown properly.',
    );
  },
);
