// @ts-check

/* eslint-disable import/order -- https://github.com/endojs/endo/issues/1235 */
import { test as anyTest } from '../prepare-test-env-ava.js';

import { createRequire } from 'module';
import { E } from '@endo/far';
import { makeNodeBundleCache } from '@endo/bundle-source/cache.js';
import { makeZoeKitForTest } from '@agoric/zoe/tools/setup-zoe.js';
import { AmountMath } from '@agoric/ertp';

import { makeStableFaucet } from '../mintStable.js';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { oneDay, TimeIntervals } from '../../src/helpers/time.js';
import { extract } from '@agoric/vats/src/core/utils.js';
import { makeMockTools, mockBootstrapPowers } from '../../tools/boot-tools.js';
import { getBundleId } from '../../tools/bundle-tools.js';
import { head } from '../../src/helpers/objectTools.js';

import { simulateClaim } from './actors.js';
import { OPEN } from '../../src/airdrop.contract.js';
import {
  startAirdrop,
  permit,
  makeTerms,
} from '../../src/airdrop.local.proposal.js';
import { makeFakeVatAdmin } from '@agoric/zoe/tools/fakeVatAdmin.js';
import { merkleTreeObj } from './generated_keys.js';

const { accounts } = merkleTreeObj;
/** @typedef {typeof import('../../src/airdrop.contract.js').start} AssetContractFn */

const myRequire = createRequire(import.meta.url);
const contractPath = myRequire.resolve(`../../src/airdrop.contract.js`);
const AIRDROP_TIERS_STATIC = [9000n, 6500n, 3500n, 1500n, 750n];

/** @type {import('ava').TestFn<Awaited<ReturnType<makeTestContext>>>} */
const test = anyTest;

const defaultCustomTerms = {
  initialPayoutValues: AIRDROP_TIERS_STATIC,
  targetNumberOfEpochs: 5,
  targetEpochLength: TimeIntervals.SECONDS.ONE_DAY,
  targetTokenSupply: 10_000_000n,
  tokenName: 'Tribbles',
  startTime: oneDay,
  merkleRoot: merkleTreeObj.root,
};

const UNIT6 = 1_000_000n;

const timerTracer = label => value => {
  console.log(label, '::: latest #### ', value);
  return value;
};
const makeLocalTimer = async (
  createTimerFn = buildManualTimer(timerTracer('default timer'), 5n),
) => {
  const timer = createTimerFn();

  const timerBrand = await E(timer).getTimerBrand();

  return {
    timer,
    timerBrand,
  };
};
/**
 * Tests assume access to the zoe service and that contracts are bundled.
 *
 * See test-bundle-source.js for basic use of bundleSource().
 * Here we use a bundle cache to optimize running tests multiple times.
 *
 * @param {import('ava').TestFn} t
 *
 */

const makeTestContext = async t => {
  const { admin, vatAdminState } = makeFakeVatAdmin();
  const { zoeService: zoe, feeMintAccess } = makeZoeKitForTest(admin);

  const invitationIssuer = zoe.getInvitationIssuer();
  console.log('------------------------');
  console.log('invitationIssuer::', invitationIssuer);
  const bundleCache = await makeNodeBundleCache('bundles/', {}, s => import(s));
  const bundle = await bundleCache.load(contractPath, 'assetContract');
  const {} = makeMockTools(t, bundleCache);

  const testFeeIssuer = await E(zoe).getFeeIssuer();
  const testFeeBrand = await E(testFeeIssuer).getBrand();

  const testFeeTokenFaucet = await makeStableFaucet({
    feeMintAccess,
    zoe,
    bundleCache,
  });
  console.log('bundle:::', { bundle, bundleCache });
  return {
    invitationIssuer,
    zoe,
    bundle,
    bundleCache,
    makeLocalTimer,
    testFeeTokenFaucet,
    faucet: testFeeTokenFaucet.faucet,
    testFeeBrand,
    testFeeIssuer,
  };
};

test.before('before hook', async t => {
  const { admin, vatAdminState } = makeFakeVatAdmin();
  const { zoeService: zoe, feeMintAccess } = makeZoeKitForTest(admin);

  const invitationIssuer = zoe.getInvitationIssuer();
  console.log('------------------------');
  console.log('invitationIssuer::', invitationIssuer);
  const bundleCache = await makeNodeBundleCache('bundles/', {}, s => import(s));
  const bundle = await bundleCache.load(contractPath, 'assetContract');
  const {} = makeMockTools(t, bundleCache);

  const testFeeIssuer = await E(zoe).getFeeIssuer();
  const testFeeBrand = await E(testFeeIssuer).getBrand();

  const testFeeTokenFaucet = await makeStableFaucet({
    feeMintAccess,
    zoe,
    bundleCache,
  });
  console.log('bundle:::', { bundle, bundleCache });
  t.context = {
    invitationIssuer,
    zoe,
    bundle,
    bundleCache,
    makeLocalTimer,
    testFeeTokenFaucet,
    faucet: testFeeTokenFaucet.faucet,
    testFeeBrand,
    testFeeIssuer,
  };
});

// IDEA: use test.serial and pass work products
// between tests using t.context.

test('Install the contract', async t => {
  const { zoe, bundle } = t.context;

  const installation = await E(zoe).install(bundle);
  t.log(installation);
  t.is(typeof installation, 'object');
});

const startLocalInstance = async (
  t,
  bundle,
  { issuers: { Fee: feeIssuer }, zoe, terms: customTerms },
) => {
  const timer = buildManualTimer();

  /** @type {ERef<Installation<AssetContractFn>>} */
  const installation = await E(zoe).install(bundle);

  const { instance, publicFacet, creatorFacet } = await E(zoe).startInstance(
    installation,
    { Fee: feeIssuer },
    {
      ...customTerms,
    },
    { timer },
  );

  t.log('instance', { instance });

  return { instance, installation, timer, publicFacet, creatorFacet };
};

test.serial('Start the contract', async t => {
  const {
    zoe: zoeRef,
    bundle,
    bundleCache,
    feeMintAccess,
    testFeeBrand,
  } = t.context;

  const testFeeIssuer = await E(zoeRef).getFeeIssuer();

  const testFeeTokenFaucet = await makeStableFaucet({
    feeMintAccess,
    zoe: zoeRef,
    bundleCache,
  });
  console.log('context:', { testFeeTokenFaucet });

  const localTestConfig = {
    zoe: zoeRef,
    issuers: { Fee: testFeeIssuer },
    terms: {
      ...defaultCustomTerms,
      feeAmount: AmountMath.make(testFeeBrand, 5n),
    },
  };

  const { instance } = await startLocalInstance(t, bundle, localTestConfig);
  t.log(instance);
  t.is(typeof instance, 'object');
});

test('Airdrop ::: happy paths', async t => {
  const { zoe: zoeRef, bundle, faucet, testFeeBrand } = await t.context;
  console.log(t.context);
  const { instance, publicFacet, timer } = await startLocalInstance(t, bundle, {
    zoe: zoeRef,
    issuers: { Fee: await E(zoeRef).getFeeIssuer() },
    terms: {
      ...defaultCustomTerms,
      feeAmount: AmountMath.make(testFeeBrand, 5n),
    },
  });

  await E(timer).advanceBy(oneDay * (oneDay / 2n));

  t.deepEqual(await E(publicFacet).getStatus(), OPEN);

  t.log({ faucet });
  await E(timer).advanceBy(oneDay);
  const feePurse = await faucet(5n * UNIT6);
  t.log(feePurse);
  await t.deepEqual(
    feePurse.getCurrentAmount(),
    AmountMath.make(t.context.testFeeBrand, 5_000_000n),
  );

  await simulateClaim(t, zoeRef, instance, feePurse, head(accounts));

  await E(timer).advanceBy(oneDay);

  await simulateClaim(t, zoeRef, instance, feePurse, accounts[2]);

  await E(timer).advanceBy(oneDay);

  t.deepEqual(await E(publicFacet).getStatus(), 'claim-window-open');

  await E(timer).advanceBy(oneDay);
});

test.serial('delegate pause access :: makePauseContractInvitation', async t => {
  const {
    zoe: zoeRef,
    invitationIssuer: zoeIssuer,
    bundle,
    faucet,
    testFeeBrand,
  } = await t.context;
  console.log(t.context);

  const invitationPurse = await E(zoeIssuer).makeEmptyPurse();
  const depositOnlyFacet = invitationPurse.getDepositFacet();

  const { instance, publicFacet, timer, creatorFacet } =
    await startLocalInstance(t, bundle, {
      zoe: zoeRef,
      issuers: { Fee: await E(zoeRef).getFeeIssuer() },
      terms: {
        ...defaultCustomTerms,
        feeAmount: AmountMath.make(testFeeBrand, 5n),
      },
    });

  await E(creatorFacet).makePauseContractInvitation(depositOnlyFacet);

  const pauseInvitationAmt = invitationPurse.getCurrentAmount();

  t.deepEqual(
    pauseInvitationAmt.brand,
    await E(zoeIssuer).getBrand(),
    'makePauseContractInvitation given a valid depositFacet should deposit an invitation into its purse.',
  );

  const pauseOffersPayment = invitationPurse.withdraw(pauseInvitationAmt);

  // Claming is not yet active in contract.
  // Code below produces: "Illegal state transition. Can not transition from state: prepared to state paused."
  //  await E(zoeRef).offer(pauseOffersPayment, undefined, undefined);

  await E(timer).advanceBy(oneDay * (oneDay / 2n));

  t.deepEqual(await E(publicFacet).getStatus(), OPEN);

  await E(timer).advanceBy(oneDay);
  const feePurse = await faucet(5n * UNIT6);

  await simulateClaim(t, zoeRef, instance, feePurse, accounts[2]);

  const adminSeat = await E(zoeRef).offer(
    pauseOffersPayment,
    undefined,
    undefined,
  );

  t.deepEqual(
    await adminSeat.hasExited(),
    true,
    'adminSeat.hasExited() should return true following a succesful offer to pause the contract.',
  );

  await E(timer).advanceBy(oneDay);

  await E(timer).advanceBy(oneDay);

  t.deepEqual(await E(publicFacet).getStatus(), 'paused');

  // TODO: Validate that an offer make to contract fails when offer filter is present
});

test.serial(
  'MN-2 Task: Add a deployment test that exercises the core-eval that will be used to install & start the contract on chain.',
  async t => {
    const { bundle, testFeeBrand } = t.context;

    const bundleID = getBundleId(bundle);
    const { powers, vatAdminState } = await mockBootstrapPowers(t.log);
    const { feeMintAccess, zoe } = powers.consume;

    // When the BLD staker governance proposal passes,
    // the startup function gets called.
    vatAdminState.installBundle(bundleID, bundle);
    const airdropPowers = extract(permit, powers);
    await startAirdrop(airdropPowers, {
      merkleRoot: merkleTreeObj.root,
      options: {
        customTerms: {
          ...makeTerms(),
          merkleRoot: merkleTreeObj.root,
        },
        tribblesAirdrop: { bundleID },
        merkleRoot: merkleTreeObj.root,
      },
    });
    const sellSpace = powers;
    const instance = await sellSpace.instance.consume.tribblesAirdrop;
    console.log({ powers });

    // Now that we have the instance, resume testing as above.
    const { bundleCache } = t.context;
    const { faucet } = makeStableFaucet({ bundleCache, feeMintAccess, zoe });

    await simulateClaim(
      t,
      zoe,
      instance,
      await faucet(5n * UNIT6),
      accounts[3],
    );
  },
);
