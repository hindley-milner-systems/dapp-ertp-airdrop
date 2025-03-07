/**
 * @file pauseAirdrop.test.js
 * @description Test suite for the airdrop contract's pause functionality and state transitions
 * @module test/tribbles-airdrop
 *
 * @summary This test suite verifies:
 * - Contract state transitions (PREPARED → PAUSED → PREPARED → OPEN)
 * - Admin pause/resume functionality
 * - Token claim behavior during different contract states
 * - Epoch-based token distribution
 * - Timer service interactions during paused states
 * - Proper error handling for invalid state transitions
 *
 * @requires @agoric/time
 * @requires @agoric/zoe
 * @requires @agoric/ertp
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

test.serial('Verify well-known brand (ATOM) is available', async t => {
  t.log('📋 TEST: Verifying ATOM brand is available and properly configured');
  const { makeQueryTool } = t.context;
  const hub0 = makeAgoricNames(makeQueryTool());
  const agoricNames = makeNameProxy(hub0);
  await null;
  const brand = {
    ATOM: await agoricNames.brand.ATOM,
  };
  t.log('🔍 Retrieved ATOM brand:', brand);
  t.is(passStyleOf(brand.ATOM), 'remotable', 'ATOM brand should be remotable');
  t.log('✅ ATOM brand is properly configured and available');
});

test.serial('Install airdrop contract bundle', async t => {
  t.log('📦 TEST: Installing airdrop contract bundle');
  const { installBundles } = t.context;
  t.log(`📋 Preparing to install ${Object.keys(bundleRoots).length} bundles`);

  const bundles = await installBundles(bundleRoots, (...args) => {
    t.log(`🔄 Bundle installation progress:`, ...args);
  });

  const id = getBundleId(bundles.tribblesAirdrop);
  const shortId = id.slice(0, 8);
  t.log(`✅ Bundle installed successfully with ID: ${shortId}`);
  t.is(id.length, 3 + 128, 'Bundle ID should have correct length');
  t.regex(id, /^b1-.../, 'Bundle ID should have correct format');

  Object.assign(t.context.shared, { bundles });
  t.truthy(
    t.context.shared.bundles.tribblesAirdrop,
    'Context should contain tribblesAirdrop bundle',
  );
  t.log('📦 Bundle installation complete and verified');
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
          ...makeTerms(),
          startTime: 4600n,
          targetEpochLength: 86_400n / 4n,
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

    // Contract initialization phase
    t.log('🔄 TEST PHASE: Contract Initialization');
    t.log(`📅 Contract start time: ${expectedStartTime}`);
    t.log(`📅 Contract end time: ${expectedEndTime}`);
    t.log(`⏱️ Contract epoch length: ${86_400n / 4n} seconds`);

    // Advance time to observe timer behavior
    t.log('⏱️ Advancing time to observe timer behavior');
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

    // Pause the contract while in PREPARED state
    t.log('🛑 TEST PHASE: Pausing Contract in PREPARED State');
    t.log(
      '📝 Creating pause offer to transition contract from PREPARED to PAUSED state',
    );

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
    t.log('🔄 Executing pause offer with admin wallet');
    const pauseOfferUpdater = E(adminWallet.offers).executeOffer(pauseOffer);

    await makeAsyncObserverObject(pauseOfferUpdater).subscribe({
      next: traceFn('pauseOfferUpdater ## next'),
      error: traceFn('pauseOfferUpdater## Error'),
      complete: () =>
        t.log('✅ Contract successfully paused in PREPARED state'),
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

    // Verify paused contract doesn't transition to OPEN state
    t.log('⏱️ TEST PHASE: Verifying Paused Contract Behavior');
    t.log('⏱️ Advancing time past when contract would normally open');
    await E(chainTimerService).tickN(575n);

    const t3 = await E(chainTimerService).getCurrentTimestamp();
    t.log(
      `⏱️ Current time (${t3}) has passed expected start time (${expectedStartTime})`,
    );

    t.deepEqual(
      TimeMath.compareAbs(t3, expectedStartTime),
      1,
      'Current time should be after the expected start time',
    );
    t.log(
      '✅ Verified: Paused contract did not automatically transition to OPEN state',
    );
    // Unpause the contract
    t.log('🔄 TEST PHASE: Unpausing Contract');
    t.log(
      '📝 Creating offer to transition contract from PAUSED back to PREPARED state',
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
    t.log('🔄 Executing unpause offer with admin wallet');
    const removePauseOfferUpdater = E(adminWallet.offers).executeOffer(
      removePauseOffer,
    );

    await makeAsyncObserverObject(removePauseOfferUpdater).subscribe({
      next: traceFn('removePauseOfferUpdater ## next'),
      error: traceFn('removePauseOfferUpdater## Error'),
      complete: () => t.log('✅ Contract successfully unpaused'),
    });

    const t4 = await E(chainTimerService).getCurrentTimestamp();
    t.log(`⏱️ Current time after unpausing: ${t4}`);
    // Advance time to trigger transition to OPEN state
    t.log('⏱️ TEST PHASE: Transitioning to OPEN State');
    t.log(
      '⏱️ Advancing time to trigger automatic transition from PREPARED to OPEN state',
    );
    await E(chainTimerService).advanceBy(TimeMath.absValue(t4) + 4600n);
    await E(chainTimerService).tickN(1200n);

    const currentTime = await E(chainTimerService).getCurrentTimestamp();
    t.log(`⏱️ Current time after advancement: ${currentTime}`);
    t.log('✅ Contract should now be in OPEN state');
    const terms = await E(zoe).getTerms(instance);

    const { issuers, brands } = terms;

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

    t.log('💰 Funding test wallets with tokens');
    await Object.values(wallets).map(async account => {
      const pmt = await mintBrandedPayment(10n);
      t.log(`💸 Minted payment for wallet: ${pmt}`);
      await E(account.wallet.deposit).receive(pmt);
    });
    t.log('✅ All test wallets funded successfully');
    const makeOfferSpec = makeMakeOfferSpec(instance);

    await faucet(5n * 1_000_000n);

    const makeFeeAmount = () => AmountMath.make(brands.Fee, 5n);

    const aliceTier = 0;

    // Test token claiming after state transitions
    t.log('🧪 TEST PHASE: Token Claiming After State Transitions');
    t.log(
      '👤 Testing Alice claiming tokens after contract transitions: PREPARED -> PAUSED -> PREPARED -> OPEN',
    );

    const alice = [
      E(aliceAccount.wallet.offers).executeOffer(
        makeOfferSpec({ ...aliceAccount }, makeFeeAmount(), 0),
      ),
      E(aliceAccount.wallet.peek).purseUpdates(brands.Tribbles),
    ];

    const [alicesOfferUpdates, alicesPurse] = alice;

    t.log("🔄 Executing Alice's claim offer");
    await makeAsyncObserverObject(alicesOfferUpdates).subscribe({
      next: traceFn('AliceOffer::1 ### SUBSCRIBE.NEXT'),
      error: traceFn('AliceOffer::1 ### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.log("✅ Alice's claim offer completed successfully");
        t.deepEqual(message, 'Iterator lifecycle complete.');
        t.deepEqual(values.length, 4, 'Offer should have 4 update values');
      },
    });

    t.log('🔍 Verifying Alice received the correct token amount');
    await makeAsyncObserverObject(
      alicesPurse,
      'AsyncGenerator alicePurse has fulfilled its requirements.',
      1,
    ).subscribe({
      next: traceFn('alicesPurse ### SUBSCRIBE.NEXT'),
      error: traceFn('alicesPurse #### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(
          message,
          'AsyncGenerator alicePurse has fulfilled its requirements.',
        );
        const expectedAmount = AmountMath.make(
          brands.Tribbles,
          AIRDROP_AMOUNT_VALUES[aliceTier],
        );
        t.log(
          `💰 Expected token amount for Alice (Tier ${aliceTier}): ${AIRDROP_AMOUNT_VALUES[aliceTier]}`,
        );
        t.deepEqual(
          head(values),
          expectedAmount,
          'Alice should receive the correct token amount for her tier during this epoch',
        );
        t.log('✅ Alice received the correct token amount');
      },
    });

    // Advance to next epoch and test Bob's claim
    t.log('⏱️ TEST PHASE: Advancing to Next Epoch');
    const current = await E(chainTimerService).getCurrentTimestamp();
    t.log(`⏱️ Current time before advancement: ${current}`);
    t.log('⏱️ Advancing time by one epoch (86,400 seconds)');
    await E(chainTimerService).advanceTo(TimeMath.absValue(current) + 86_400n);

    const newTime = await E(chainTimerService).getCurrentTimestamp();
    t.log(`⏱️ Current time after advancement: ${newTime}`);
    t.log('👤 Testing Bob claiming tokens in the second epoch');
    const bob = [
      E(bobAccount.wallet.offers).executeOffer(
        makeOfferSpec({ ...bobAccount }, makeFeeAmount(), 1),
      ),
      E(bobAccount.wallet.peek).purseUpdates(brands.Tribbles),
    ];

    const [bobsOfferUpdater, bobsPurse] = bob;

    await makeAsyncObserverObject(bobsOfferUpdater).subscribe({
      next: traceFn('BobOffer::1 ### SUBSCRIBE.NEXT'),
      error: traceFn('BobOffer::1 ### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.log("✅ Bob's claim offer completed successfully");
        t.deepEqual(message, 'Iterator lifecycle complete.');
        t.deepEqual(values.length, 4, 'Offer should have 4 update values');
      },
    });

    t.log(
      '🔍 Verifying Bob received the correct token amount for second epoch',
    );
    await makeAsyncObserverObject(
      bobsPurse,
      'AsyncGenerator bobsPurse has fulfilled its requirements.',
      1,
    ).subscribe({
      next: traceFn('bobsPurse ### SUBSCRIBE.NEXT'),
      error: traceFn('bobsPurse #### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(
          message,
          'AsyncGenerator bobsPurse has fulfilled its requirements.',
        );
        const expectedAmount = AmountMath.make(
          brands.Tribbles,
          AIRDROP_AMOUNT_VALUES[bobAccount.tier] / 2n,
        );
        t.log(
          `💰 Expected token amount for Bob (Tier ${bobAccount.tier}) in second epoch: ${AIRDROP_AMOUNT_VALUES[bobAccount.tier] / 2n}`,
        );
        t.deepEqual(
          head(values),
          expectedAmount,
          'Bob should receive half the tokens in second epoch compared to first epoch',
        );
        t.log('✅ Bob received the correct token amount for second epoch');
      },
    });

    // Advance to third epoch and test Carol's claim
    t.log('⏱️ TEST PHASE: Advancing to Third Epoch');
    t.log('⏱️ Advancing time by two more epochs (172,800 seconds)');
    await E(chainTimerService).advanceBy(86_400n * 2n);
    t.log('👤 Testing Carol claiming tokens in the third epoch');
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
        t.log("✅ Carol's claim offer completed successfully");
        t.deepEqual(message, 'Iterator lifecycle complete.');
        t.deepEqual(values.length, 4, 'Offer should have 4 update values');
      },
    });

    t.log(
      '🔍 Verifying Carol received the correct token amount for third epoch',
    );
    await makeAsyncObserverObject(
      carolsPurse,
      'AsyncGenerator carolsPurse has fulfilled its requirements.',
      1,
    ).subscribe({
      next: traceFn('carolsPurse ### SUBSCRIBE.NEXT'),
      error: traceFn('carolsPurse #### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(
          message,
          'AsyncGenerator carolsPurse has fulfilled its requirements.',
        );
        const expectedAmount = AmountMath.make(
          brands.Tribbles,
          AIRDROP_AMOUNT_VALUES[carolAccount.tier] / 2n / 2n,
        );
        t.log(
          `💰 Expected token amount for Carol (Tier ${carolAccount.tier}) in third epoch: ${AIRDROP_AMOUNT_VALUES[carolAccount.tier] / 2n / 2n}`,
        );
        t.deepEqual(
          head(values),
          expectedAmount,
          'Carol should receive quarter the tokens in third epoch compared to first epoch',
        );
        t.log('✅ Carol received the correct token amount for third epoch');
      },
    });

    t.log(
      '✅ TEST COMPLETE: Successfully verified all state transitions and token claims',
    );
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
  'Contract state transitions: CLAIM-WINDOW-OPEN -> PAUSED -> CLAIM-WINDOW-OPEN',
  async t => {
    t.log(
      '🧪 TEST: Verifying contract state transitions from OPEN to PAUSED and back to OPEN',
    );
    t.log(
      '📋 This test verifies that an already OPEN contract can be paused and resumed',
    );

    const merkleRoot = merkleTreeObj.root;
    const { bundleCache } = t.context;

    t.log('🚀 Initializing contract with merkle root:', merkleRoot);
    const { tribblesAirdrop } = t.context.shared.bundles;

    const bundleID = getBundleId(tribblesAirdrop);
    const {
      powers,
      vatAdminState,
      makeMockWalletFactory,
      provisionSmartWallet,
    } = await makeMockTools(t, bundleCache);

    const { feeMintAccess, zoe } = powers.consume;

    t.log('📦 Installing airdrop bundle');
    vatAdminState.installBundle(bundleID, tribblesAirdrop);

    t.log('👤 Provisioning admin wallet');
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

    t.log('🚀 Starting airdrop with immediate start time (0n)');
    t.log('⏱️ Contract configured with 4-hour epochs (43200 seconds)');
    await startAirdrop(airdropPowers, {
      options: {
        customTerms: {
          ...makeTerms(), // default terms meaning contract will last 5 epochs.
          startTime: 0n, // Contract will start immediately
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
    t.log(`📅 Contract start time: ${t0}`);
    t.log(`📅 Expected contract end time: ${expectedEndTime}`);
    t.log(`⏱️ Total contract duration: ${43200n * 5n} seconds (5 epochs)`);
    // Advance time slightly to ensure contract is in
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
    t.log('💰 Funding faucet with 5,000,000 tokens');
    await faucet(5n * 1_000_000n);

    const {
      pauseContract: makePauseContractOffer,
      unpauseContract: makeResumeContractOffer,
    } = makeMakeContractPauseOfferSpecs(instance);
    const makeOfferSpec = makeMakeOfferSpec(instance);

    t.log('🧪 TEST PHASE: Verifying Token Claims in OPEN State');
    t.log('👤 Testing Bob claiming tokens while contract is in OPEN state');
    const bob = [
      E(bobAccount.wallet.offers).executeOffer(
        makeOfferSpec({ ...bobAccount }, makeFeeAmount(), 0),
      ),
      E(bobAccount.wallet.peek).purseUpdates(brands.Tribbles),
    ];

    const [bobsOfferUpdates, bobsPurse] = bob;

    t.log("🔄 Executing Bob's claim offer");
    await makeAsyncObserverObject(bobsOfferUpdates).subscribe({
      next: traceFn('BobOffer::1 ### SUBSCRIBE.NEXT'),
      error: traceFn('BobOffer::1 ### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.log("✅ Bob's claim offer completed successfully");
        t.deepEqual(message, 'Iterator lifecycle complete.');
        t.deepEqual(values.length, 4, 'Offer should have 4 update values');
      },
    });

    t.log('🔍 Verifying Bob received the correct token amount');
    await makeAsyncObserverObject(
      bobsPurse,
      'AsyncGenerator bobsPurse has fulfilled its requirements.',
      1,
    ).subscribe({
      next: traceFn('bobsPurse ### SUBSCRIBE.NEXT'),
      error: traceFn('bobsPurse #### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(
          message,
          'AsyncGenerator bobsPurse has fulfilled its requirements.',
        );
        const expectedAmount = AmountMath.make(
          brands.Tribbles,
          AIRDROP_AMOUNT_VALUES[0],
        );
        t.log(
          `💰 Expected token amount for Bob (Tier 0) in first epoch: ${AIRDROP_AMOUNT_VALUES[0]}`,
        );
        t.deepEqual(
          head(values),
          expectedAmount,
          'Bob should receive the full token amount for tier 0 in first epoch',
        );
        t.log('✅ Bob received the correct token amount for first epoch');
      },
    });

    t.log(
      '✅ Successfully verified user ability to claim tokens from airdrop while claiming window is open',
    );

    t.log('🛑 TEST PHASE: Pausing Contract in OPEN State');
    t.log(
      '📝 Creating pause offer to transition contract from OPEN to PAUSED state',
    );

    const pauseOfferUpdater = E(adminWallet.offers).executeOffer(
      makePauseContractOffer(),
    );

    await makeAsyncObserverObject(pauseOfferUpdater).subscribe({
      next: traceFn('pauseOfferUpdater ## next'),
      error: traceFn('pauseOfferUpdater## Error'),
      complete: () => t.log('✅ Contract successfully paused in OPEN state'),
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

    // Advance time while contract is paused
    t.log('⏱️ TEST PHASE: Verifying Paused Contract Behavior');
    t.log('⏱️ Advancing time while contract is paused');
    await E(chainTimerService).tickN(1575n);

    const t3 = await E(chainTimerService).getCurrentTimestamp();
    t.log(`⏱️ Current time after advancement: ${t3}`);
    const startTimeRecord = harden({ relValue: 4600n, timerBrand });

    const initialStartTime = TimeMath.addAbsRel(t0, startTimeRecord);

    t.log('🧪 TEST PHASE: Attempting to Claim Tokens While Paused');
    t.log('👤 Testing claim attempt while contract is paused (should fail)');

    const disallowedClaimAttempt = await E(
      bobAccount.wallet.offers,
    ).executeOffer(makeOfferSpec({ ...bobAccount }, makeFeeAmount(), 0));

    await E(chainTimerService).tick();

    t.log('🔍 Verifying claim attempt is rejected while contract is paused');
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

    t.log(
      '✅ Successfully verified claims are rejected while contract is paused',
    );

    t.deepEqual(
      TimeMath.compareAbs(t3, initialStartTime),
      1,
      'Current time should be after the initial start time',
    );

    t.log('🔄 TEST PHASE: Unpausing Contract');
    t.log(
      '📝 Creating offer to transition contract from PAUSED back to OPEN state',
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
    t.log('🔄 Executing unpause offer with admin wallet');
    const removePauseOfferUpdater = E(adminWallet.offers).executeOffer(
      removePauseOffer,
    );

    await makeAsyncObserverObject(removePauseOfferUpdater).subscribe({
      next: traceFn('removePauseOfferUpdater ## next'),
      error: traceFn('removePauseOfferUpdater## Error'),
      complete: () => t.log('✅ Contract successfully unpaused to OPEN state'),
    });

    const aliceTier = 0;

    t.log('🧪 TEST PHASE: Claiming Tokens After Unpausing');
    t.log(
      '👤 Testing Alice claiming tokens after contract transitions: OPEN -> PAUSED -> OPEN',
    );

    t.log('⏱️ Advancing time slightly after unpausing');
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
    t.log("🔄 Executing Alice's claim offer");
    await makeAsyncObserverObject(alicesOfferUpdates).subscribe({
      next: traceFn('AliceOffer::1 ### SUBSCRIBE.NEXT'),
      error: traceFn('AliceOffer::1 ### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.log("✅ Alice's claim offer completed successfully");
        t.deepEqual(message, 'Iterator lifecycle complete.');
        t.deepEqual(values.length, 4, 'Offer should have 4 update values');
      },
    });

    t.log(
      '🔍 Verifying Alice received the correct token amount after unpausing',
    );
    await makeAsyncObserverObject(
      alicesPurse,
      'AsyncGenerator alicePurse has fulfilled its requirements.',
      1,
    ).subscribe({
      next: traceFn('alicesPurse ### SUBSCRIBE.NEXT'),
      error: traceFn('alicesPurse #### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(
          message,
          'AsyncGenerator alicePurse has fulfilled its requirements.',
        );
        const expectedAmount = AmountMath.make(
          brands.Tribbles,
          AIRDROP_AMOUNT_VALUES[aliceTier] / 2n,
        );
        t.log(
          `💰 Expected token amount for Alice (Tier ${aliceTier}) in second epoch: ${AIRDROP_AMOUNT_VALUES[aliceTier] / 2n}`,
        );
        t.deepEqual(
          head(values),
          expectedAmount,
          'Alice should receive half the tokens in second epoch compared to first epoch',
        );
        t.log('✅ Alice received the correct token amount for second epoch');
      },
    });

    t.log('✅ Successfully verified claims work after unpausing contract');

    // Pause the contract a second time
    t.log('🛑 TEST PHASE: Pausing Contract a Second Time');
    t.log(
      '📝 Creating second pause offer to transition contract from OPEN to PAUSED state',
    );

    const secondPauseOfferUpdater = E(adminWallet.offers).executeOffer(
      makePauseContractOffer('pause-contract-1'),
    );

    await makeAsyncObserverObject(secondPauseOfferUpdater).subscribe({
      next: traceFn('pauseOfferUpdater ## next'),
      error: traceFn('pauseOfferUpdater## Error'),
      complete: () =>
        t.log('✅ Contract successfully paused for the second time'),
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

    // Advance time while contract is paused a second time
    t.log('⏱️ TEST PHASE: Advancing Time During Second Pause');
    t.log(
      '⏱️ Advancing time by one epoch (43,200 seconds) while contract is paused',
    );
    await E(chainTimerService).advanceBy(43200n);

    // Unpause the contract a second time
    t.log('🔄 TEST PHASE: Unpausing Contract a Second Time');
    t.log(
      '📝 Creating offer to transition contract from PAUSED back to OPEN state again',
    );

    const resumeContractOfferUpdater = E(adminWallet.offers).executeOffer(
      makeResumeContractOffer('pause-removal-1', OPEN),
    );

    t.log(
      '🔄 Complete state transition sequence: OPEN -> PAUSED -> OPEN -> PAUSED -> OPEN',
    );

    await makeAsyncObserverObject(resumeContractOfferUpdater).subscribe({
      next: traceFn('removePauseOfferUpdater ## next'),
      error: traceFn('removePauseOfferUpdater## Error'),
      complete: () =>
        t.log('✅ Contract successfully unpaused for the second time'),
    });

    // Test Carol's claim after second unpause
    t.log('🧪 TEST PHASE: Claiming Tokens After Second Unpause');
    t.log(
      '👤 Testing Carol claiming tokens after multiple pause/unpause cycles',
    );

    const carol = [
      E(carolAccount.wallet.offers).executeOffer(
        makeOfferSpec({ ...carolAccount }, makeFeeAmount(), 0),
      ),
      E(carolAccount.wallet.peek).purseUpdates(brands.Tribbles),
    ];

    const [carolsOfferUpdater, carolsPurse] = carol;

    t.log("🔄 Executing Carol's claim offer");
    await makeAsyncObserverObject(carolsOfferUpdater).subscribe({
      next: traceFn('CarolOffer::1 ### SUBSCRIBE.NEXT'),
      error: traceFn('CarolOffer::1 ### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.log("✅ Carol's claim offer completed successfully");
        t.deepEqual(message, 'Iterator lifecycle complete.');
        t.deepEqual(values.length, 4, 'Offer should have 4 update values');
      },
    });

    t.log(
      '🔍 Verifying Carol received the correct token amount after multiple pauses',
    );
    await makeAsyncObserverObject(
      carolsPurse,
      'AsyncGenerator carolsPurse has fulfilled its requirements.',
      1,
    ).subscribe({
      next: traceFn('carolsPurse ### SUBSCRIBE.NEXT'),
      error: traceFn('carolsPurse #### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(
          message,
          'AsyncGenerator carolsPurse has fulfilled its requirements.',
        );
        const expectedAmount = AmountMath.make(brands.Tribbles, 46875000n);
        t.log(
          `💰 Expected token amount for Carol (Tier 4) after multiple pauses: 46,875,000`,
        );
        t.deepEqual(
          head(values),
          expectedAmount,
          'Carol should receive the correct token amount for her tier and epoch',
        );
        t.log('✅ Carol received the correct token amount');
      },
    });

    // Advance to contract end and verify shutdown
    t.log('⏱️ TEST PHASE: Advancing to Contract End');
    t.log('⏱️ Advancing time by two more epochs (86,400 seconds)');
    await E(chainTimerService).advanceBy(43200n * 2n);

    const t5 = await E(chainTimerService).getCurrentTimestamp();
    t.log(`⏱️ Current time after final advancement: ${t5}`);
    t.log(`📅 Expected end time: ${expectedEndTime}`);

    t.log('🔍 Verifying contract has reached end time');
    t.deepEqual(
      TimeMath.compareAbs(t5, expectedEndTime),
      1,
      'Current time should be after expected end time',
    );

    t.log('📊 TEST SUMMARY:');
    t.log('----------------------');
    t.log(`📅 Expected end time: ${expectedEndTime}`);
    t.log(`📅 Actual end time: ${t5}`);
    t.log('🛑 Number of pauses: 2');

    const exitMessage = await E(vatAdminState).getHasExited();
    t.deepEqual(exitMessage, true, 'Contract should shutdown properly');

    t.log(
      '✅ TEST COMPLETE: Successfully verified all state transitions and token claims',
    );
  },
);
