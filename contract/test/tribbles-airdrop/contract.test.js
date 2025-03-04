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
import { makeOfferArgs } from './actors.js';
import { merkleTreeObj } from './generated_keys.js';
import { AmountMath } from '@agoric/ertp';
import { Observable, Task } from '../../src/helpers/adts.js';
import { createStore } from '../../src/tribbles/utils.js';
import { head } from '../../src/helpers/objectTools.js';
import { messagesObject, OPEN, PAUSED } from '../../src/airdrop.contract.js';

const reducerFn = (state = [], action) => {
  const { type, payload } = action;
  switch (type) {
    case 'NEW_RESULT':
      return [...state, payload];
    default:
      return state;
  }
};
const handleNewResult = result => ({
  type: 'NEW_RESULT',
  payload: result.value,
});

const makeAsyncObserverObject = (
  generator,
  completeMessage = 'Iterator lifecycle complete.',
  maxCount = Infinity,
) =>
  Observable(async observer => {
    const iterator = E(generator);
    const { dispatch, getStore } = createStore(reducerFn, []);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // eslint-disable-next-line @jessie.js/safe-await-separator
      const result = await iterator.next();
      if (result.done) {
        console.log('result.done === true #### breaking loop');
        break;
      }
      dispatch(handleNewResult(result));
      if (getStore().length === maxCount) {
        console.log('getStore().length === maxCoutn');
        break;
      }
      observer.next(result.value);
    }
    observer.complete({ message: completeMessage, values: getStore() });
  });

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

const makeMakeOfferSpec = instance => (account, feeAmount, id) => ({
  id: `offer-${id}`,
  invitationSpec: {
    source: 'contract',
    instance,
    publicInvitationMaker: 'makeClaimTokensInvitation',
  },
  proposal: { give: { Fee: feeAmount } },
  offerArgs: { ...makeOfferArgs(account) },
});

test.serial('makeClaimTokensInvitation happy path::', async t => {
  const merkleRoot = merkleTreeObj.root;
  const { bundleCache } = t.context;

  t.log('starting contract with merkleRoot:', merkleRoot);
  // Is there a better way to obtain a reference to this bundle???
  // or is this just fine??
  const { tribblesAirdrop } = t.context.shared.bundles;

  const bundleID = getBundleId(tribblesAirdrop);
  const { powers, vatAdminState, makeMockWalletFactory, provisionSmartWallet } =
    await makeMockTools(t, bundleCache);

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

  await startAirdrop(airdropPowers, {
    options: {
      customTerms: {
        ...makeTerms(),
        targetEpochLength: 100n,
        merkleRoot: merkleTreeObj.root,
      },
      tribblesAirdrop: { bundleID },
    },
  });

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

  const walletFactory = makeMockWalletFactory({
    Tribbles: issuers.Tribbles,
    Fee: issuers.Fee,
  });

  const wallets = {
    alice: await walletFactory.makeSmartWallet(accounts[4].address),
    bob: await walletFactory.makeSmartWallet(accounts[2].address),
    carol: await walletFactory.makeSmartWallet(accounts[10].address),
    dave: await walletFactory.makeSmartWallet(accounts[5].address),
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

  await faucet(5n * 1_000_000n);

  const makeFeeAmount = () => AmountMath.make(brands.Fee, 5n);

  const [aliceTier, bobTier, carolTier, daveTier] = [0, 2, 2, 4];
  const [alice, bob, carol, dave] = [
    [
      E(wallets.alice.offers).executeOffer(
        makeOfferSpec({ ...accounts[4], tier: 0 }, makeFeeAmount(), 0),
      ),
      E(wallets.alice.peek).purseUpdates(brands.Tribbles),
    ],
    [
      E(wallets.bob.offers).executeOffer(
        makeOfferSpec({ ...accounts[2], tier: bobTier }, makeFeeAmount(), 0),
      ),
      E(wallets.bob.peek).purseUpdates(brands.Tribbles),
    ],
    [
      E(wallets.carol.offers).executeOffer(
        makeOfferSpec({ ...accounts[10], tier: carolTier }, makeFeeAmount(), 0),
      ),
      E(wallets.carol.peek).purseUpdates(brands.Tribbles),
    ],
    [
      E(wallets.dave.offers).executeOffer(
        makeOfferSpec({ ...accounts[20], tier: daveTier }, makeFeeAmount(), 0),
      ),
      E(wallets.dave.peek).purseUpdates(brands.Tribbles),
    ],
  ];

  const [alicesOfferUpdates, alicesPurse] = alice;
  const [bobsOfferUpdate, bobsPurse] = bob;
  const [carolsOfferUpdate, carolsPurse] = carol;
  const [davesOfferUpdater, davesPurse] = dave;
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
    alicesPurse,
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
    message: 'Token allocation has already been claimed.',
  });

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

  await makeAsyncObserverObject(
    carolsOfferUpdate,
    'AsyncGenerator carolsOfferUpdate has fufilled its requirements.',
  ).subscribe({
    next: traceFn('CAROLS_OFFER_UPDATE:::: SUBSCRIBE.NEXT'),
    error: traceFn('CAROLS_OFFER_UPDATE:::: SUBSCRIBE.ERROR'),
    complete: ({ message, values }) => {
      t.deepEqual(
        message,
        'AsyncGenerator carolsOfferUpdate has fufilled its requirements.',
      );
      t.deepEqual(values.length, 4);
    },
  });

  await makeAsyncObserverObject(
    carolsPurse,
    'AsyncGenerator carolPurse has fufilled its requirements.',
    1,
  ).subscribe({
    next: traceFn('TRIBBLES_WATCHER ### SUBSCRIBE.NEXT'),
    error: traceFn('TRIBBLES_WATCHER #### SUBSCRIBE.ERROR'),
    complete: ({ message, values }) => {
      t.deepEqual(
        message,
        'AsyncGenerator carolPurse has fufilled its requirements.',
      );
      t.deepEqual(
        head(values),
        AmountMath.make(brands.Tribbles, AIRDROP_TIERS_STATIC[bobTier]),
      );
    },
  });
});

test.serial(
  'makeClaimTokensInvitation:: after executing makeSetOfferFilterInvitation',
  async t => {
    const merkleRoot = merkleTreeAPI.generateMerkleRoot(
      accounts.map(x => x.pubkey.key),
    );
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
    await startAirdrop(airdropPowers, {
      options: {
        customTerms: {
          ...makeTerms(),
          startTime: 250n,
          targetEpochLength: 150n,
          targetNumberOfEpochs: 3n,
          merkleRoot: merkleTreeObj.root,
        },
        tribblesAirdrop: { bundleID },
      },
    });

    await E(chainTimerService).advanceBy(275n);
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

    const walletFactory = makeMockWalletFactory({
      Tribbles: issuers.Tribbles,
      Fee: issuers.Fee,
    });

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

    await faucet(5n * 1_000_000n);

    const makeFeeAmount = () => AmountMath.make(brands.Fee, 5n);

    const pauseOffer = {
      id: 'admin-pause-0',
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

    const removePauseOffer = {
      id: 'admin-pause-5',
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
    const secondPauseOfferUpdater = E(adminWallet.offers).executeOffer(
      pauseOffer,
    );
    await makeAsyncObserverObject(secondPauseOfferUpdater).subscribe({
      next: traceFn('secondPauseOfferUpdater ## next'),
      error: traceFn('secondPauseOfferUpdater## Error'),
      complete: traceFn('secondPauseOfferUpdater ## complete'),
    });

    const [aliceTier, bobTier] = [0, 2];
    const [alice, bob] = [
      [
        E(wallets.alice.offers).executeOffer(
          makeOfferSpec(
            { ...accounts[4], tier: aliceTier },
            makeFeeAmount(),
            0,
          ),
        ),
        E(wallets.alice.peek).purseUpdates(brands.Tribbles),
      ],
      [
        E(wallets.bob.offers).executeOffer(
          makeOfferSpec({ ...accounts[2], tier: bobTier }, makeFeeAmount(), 0),
        ),
        E(wallets.bob.peek).purseUpdates(brands.Tribbles),
      ],
    ];

    const [alicesOfferUpdates, alicesPurse] = alice;
    const [bobsOfferUpdate, bobsPurse] = bob;
    /**
     * @typedef {{value: { updated: string, status: { id: string, invitationSpec: import('../../tools/wallet-tools.js').InvitationSpec, proposal:Proposal, offerArgs: {key: string, proof: []}}}}} OfferResult
     */

    t.throwsAsync(E(alicesOfferUpdates).next(), {
      message: 'Airdrop can not be claimed when contract status is: paused.',
    });

    await makeAsyncObserverObject(
      alicesPurse,
      'alicePurse after attempting to claim while paused should contain 0n tokens.',
      1,
    ).subscribe({
      next: traceFn('TRIBBLES_WATCHER ### SUBSCRIBE.NEXT'),
      error: traceFn('TRIBBLES_WATCHER #### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(
          message,
          'alicePurse after attempting to claim while paused should contain 0n tokens.',
        );
        t.deepEqual(head(values), AmountMath.make(brands.Tribbles, 0n));
      },
    });
    await E(chainTimerService).tickN(900n);
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
      message: 'Airdrop can not be claimed when contract status is: paused.',
    });

    t.throwsAsync(E(bobsOfferUpdate).next(), {
      message: 'Airdrop can not be claimed when contract status is: paused.',
    });

    await makeAsyncObserverObject(
      bobsPurse,
      'bobsPurse after attempting to claim while paused should contain 0n tokens.',
      1,
    ).subscribe({
      next: traceFn('TRIBBLES_WATCHER ### SUBSCRIBE.NEXT'),
      error: traceFn('TRIBBLES_WATCHER #### SUBSCRIBE.ERROR'),
      complete: ({ message, values }) => {
        t.deepEqual(
          message,
          'bobsPurse after attempting to claim while paused should contain 0n tokens.',
        );
        t.deepEqual(head(values), AmountMath.make(brands.Tribbles, 0n));
      },
    });
  },
);
