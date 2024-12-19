/* eslint-disable import/order */
// @ts-check
/* global setTimeout, fetch */
// XXX what's the state-of-the-art in ava setup?
// eslint-disable-next-line import/order
import { test as anyTest } from '../prepare-test-env-ava.js';

import { createRequire } from 'module';
import { env as ambientEnv } from 'node:process';
import * as ambientChildProcess from 'node:child_process';
import * as ambientFsp from 'node:fs/promises';
import { E, passStyleOf } from '@endo/far';
import { extract } from '@agoric/vats/src/core/utils.js';
import {
  makeTerms,
  permit,
  main,
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
import { makeMockTools, mockBootstrapPowers } from '../../tools/boot-tools.js';
import { merkleTreeAPI } from '../../src/merkle-tree/index.js';
import { makeStableFaucet } from '../mintStable.js';
import {
  makeAsyncObserverObject,
  makeOfferArgs,
  simulateClaim,
} from './actors.js';
import { oneDay } from '../../src/helpers/time.js';
import { merkleTreeObj } from './generated_keys.js';
import { AmountMath } from '@agoric/ertp';
import '../types.js';
import { Observable } from '../../src/helpers/adts.js';
import { createStore } from '../../src/tribbles/utils.js';
import { head } from '../../src/helpers/objectTools.js';

const traceFn = label => value => {
  console.log(label, '::::', value);
  return value;
};

const AIRDROP_TIERS_STATIC = [9000n, 6500n, 3500n, 1500n, 750n].map(
  x => x * 1_000_000n,
);

const { accounts } = merkleTreeObj;
// import { makeAgdTools } from '../agd-tools.js';

/** @type {import('ava').TestFn<Awaited<ReturnType<makeTestContext>>>} */
const test = anyTest;

const nodeRequire = createRequire(import.meta.url);

const bundleRoots = {
  tribblesAirdrop: nodeRequire.resolve('../../src/airdrop.contract.js'),
};

const scriptRoots = {
  tribblesAirdrop: nodeRequire.resolve('../../src/airdrop.local.proposal.js'),
};

/** @param {import('ava').ExecutionContext} t */
const makeTestContext = async t => {
  const bc = await makeBundleCacheContext(t);

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
const containsSubstring = (substring, string) =>
  new RegExp(substring, 'i').test(string);

test.serial(
  'runCoreEval test ::: deploy contract with core eval: airdrop / airdrop',
  async t => {
    const { runCoreEval } = t.context;
    const { bundles } = t.context.shared;
    const bundleID = getBundleId(bundles.tribblesAirdrop);

    t.deepEqual(
      containsSubstring(bundles.tribblesAirdrop.endoZipBase64Sha512, bundleID),
      true,
    );
    const merkleRoot = merkleTreeAPI.generateMerkleRoot(
      accounts.map(x => x.pubkey.key),
    );
    console.log('inside deploy test::', bundleID);
    // this runCoreEval does not work
    const name = 'tribblesAirdrop';
    const result = await runCoreEval({
      name,
      behavior: main,
      entryFile: scriptRoots.tribblesAirdrop,
      config: {
        options: {
          customTerms: {
            ...makeTerms(),
            merkleRoot: merkleTreeObj.root,
          },
          tribblesAirdrop: { bundleID },
          merkleRoot,
        },
      },
    });

    t.log(result.voting_end_time, '#', result.proposal_id, name);
    t.like(result, {
      content: {
        '@type': '/agoric.swingset.CoreEvalProposal',
      },
      status: 'PROPOSAL_STATUS_PASSED',
    });
  },
);

// test.serial('checkBundle()', async t => {
//   const { tribblesAirdrop } = t.context.shared.bundles;
//   t.deepEqual(await checkBundle(tribblesAirdrop), '');
// });
const makeMakeOfferSpec = instance => (account, feeAmount) => ({
  id: `${account.address}-offer-${Date.now()}`,
  invitationSpec: {
    source: 'contract',
    instance,
    publicInvitationMaker: 'makeClaimTokensInvitation',
  },
  proposal: { give: { Fee: feeAmount } },
  offerArgs: { ...makeOfferArgs(account) },
});
test.serial('E2E test', async t => {
  const merkleRoot = merkleTreeAPI.generateMerkleRoot(
    accounts.map(x => x.pubkey.key),
  );
  const { bundleCache } = t.context;

  t.log('starting contract with merkleRoot:', merkleRoot);
  // Is there a better way to obtain a reference to this bundle???
  // or is this just fine??
  const { tribblesAirdrop } = t.context.shared.bundles;

  const bundleID = getBundleId(tribblesAirdrop);
  const { powers, vatAdminState, makeMockWalletFactory } = await makeMockTools(
    t,
    bundleCache,
  );
  const { feeMintAccess, zoe, chainTimerService } = powers.consume;

  vatAdminState.installBundle(bundleID, tribblesAirdrop);
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

  /** @type {import('../../src/airdrop.local.proposal.js').AirdropSpace} */
  // @ts-expeimport { merkleTreeObj } from '@agoric/orchestration/src/examples/airdrop/generated_keys.js';
  const airdropSpace = powers;
  const instance = await airdropSpace.instance.consume.tribblesAirdrop;

  const terms = await E(zoe).getTerms(instance);
  const { issuers, brands } = terms;

  const walletFactory = makeMockWalletFactory({
    Tribbles: issuers.Tribbles,
    Fee: issuers.Fee,
  });

  console.log('BRANDS::', brands);
  const wallets = {
    alice: await walletFactory.makeSmartWallet(accounts[4].address),
    bob: await walletFactory.makeSmartWallet(accounts[2].address),
  };

  const { faucet, mintBrandedPayment } = makeStableFaucet({
    bundleCache,
    feeMintAccess,
    zoe,
  });

  await Object.values(wallets).map(async wallet => {
    const pmt = await mintBrandedPayment(10n);
    console.log('payment::', pmt);
    await E(wallet.deposit).receive(pmt);
  });
  const makeOfferSpec = makeMakeOfferSpec(instance);

  // Now that we have the instance, resume testing as above.

  // TODO: update simulateClaim to construct claimArgs object.
  // see makeOfferArgs function for reference.

  const feePurse = await faucet(5n * 1_000_000n);

  const makeFeeAmount = () => AmountMath.make(brands.Fee, 5n);

  /**
   * @summary this creates an  AsyncGenerator object that emits values in the code blocks that follow.
   *
   * @example the first value is recieved as a  result of the following code
   *
   * await E(alicesOfferUpdates).next()
   * .then(res => {
   *    console.log('update res', res);
   *    return res;
   * });
   */

  const [aliceTier, bobTier] = [0, 2];
  const [alicesOfferUpdates, alicePurse] = [
    E(wallets.alice.offers).executeOffer(
      makeOfferSpec({ ...accounts[4], tier: 0 }, makeFeeAmount(), 0),
    ),
    E(wallets.alice.peek).purseUpdates(brands.Tribbles),
  ];

  /**
   * @typedef {{value: { updated: string, status: { id: string, invitationSpec: import('../../tools/wallet-tools.js').InvitationSpec, proposal:Proposal, offerArgs: {key: string, proof: []}}}}} OfferResult
   */

  await makeAsyncObserverObject(alicesOfferUpdates).subscribe({
    next: traceFn('SUBSCRIBE.NEXT'),
    error: traceFn('AliceOffer Error'),
    complete: ({ message, values }) => {
      t.deepEqual(message, 'Iterator lifecycle complete.');
      t.deepEqual(values.length, 4);
    },
  });

  await makeAsyncObserverObject(
    alicePurse,
    'AsyncGenerator alicePurse has fufilled its requirements.',
    1,
  ).subscribe({
    next: traceFn('TRIBBLES_WATCHER ### SUBSCRIBE.NEXT'),
    error: traceFn('TRIBBLES_WATCHER #### SUBSCRIBE.ERROR'),
    complete: ({ message, values }) => {
      t.deepEqual(
        message,
        'AsyncGenerator alicePurse has fufilled its requirements.',
      );
      t.deepEqual(
        head(values),
        AmountMath.make(brands.Tribbles, AIRDROP_TIERS_STATIC[aliceTier]),
      );
    },
  });
  const [alicesSecondClaim] = [
    E(wallets.alice.offers).executeOffer(
      makeOfferSpec({ ...accounts[4], tier: 0 }, makeFeeAmount(), 0),
    ),
  ];

  const alicesSecondOfferSubscriber = makeAsyncObserverObject(
    alicesSecondClaim,
  ).subscribe({
    next: traceFn('alicesSecondClaim ### SUBSCRIBE.NEXT'),
    error: traceFn('alicesSecondClaim #### SUBSCRIBE.ERROR'),
    complete: traceFn('alicesSecondClaim ### SUBSCRIBE.COMPLETE'),
  });
  await t.throwsAsync(alicesSecondOfferSubscriber, {
    message: `Allocation for address ${accounts[4].address} has already been claimed.`,
  });
  const [bobsOfferUpdate, bobsPurse] = [
    E(wallets.bob.offers).executeOffer(
      makeOfferSpec({ ...accounts[2], tier: bobTier }, makeFeeAmount(), 0),
    ),
    E(wallets.bob.peek).purseUpdates(brands.Tribbles),
  ];

  await makeAsyncObserverObject(
    bobsOfferUpdate,
    'AsyncGenerator bobsOfferUpdate has fufilled its requirements.',
  ).subscribe({
    next: traceFn('BOBS_OFFER_UPDATE:::: SUBSCRIBE.NEXT'),
    error: traceFn('BOBS_OFFER_UPDATE:::: SUBSCRIBE.ERROR'),
    complete: ({ message, values }) => {
      t.deepEqual(
        message,
        'AsyncGenerator bobsOfferUpdate has fufilled its requirements.',
      );
      t.deepEqual(values.length, 4);
    },
  });

  await makeAsyncObserverObject(
    bobsPurse,
    'AsyncGenerator bobsPurse has fufilled its requirements.',
    1,
  ).subscribe({
    next: traceFn('TRIBBLES_WATCHER ### SUBSCRIBE.NEXT'),
    error: traceFn('TRIBBLES_WATCHER #### SUBSCRIBE.ERROR'),
    complete: ({ message, values }) => {
      t.deepEqual(
        message,
        'AsyncGenerator bobsPurse has fufilled its requirements.',
      );
      t.deepEqual(
        head(values),
        AmountMath.make(brands.Tribbles, AIRDROP_TIERS_STATIC[bobTier]),
      );
    },
  });
});

test.serial('agoricNames.instances has contract: airdrop', async t => {
  const { makeQueryTool } = t.context;
  const hub0 = makeAgoricNames(makeQueryTool());

  const agoricNames = makeNameProxy(hub0);
  console.log({ agoricNames });
  await null;
  const instance = await E(agoricNames).lookup('instance', 'tribblesAirdrop');
  t.is(passStyleOf(instance), 'remotable');
  t.log(instance);
});
