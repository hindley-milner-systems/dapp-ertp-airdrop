// @ts-check
/* global setTimeout, fetch */
// XXX what's the state-of-the-art in ava setup?
// eslint-disable-next-line import/order
import { test as anyTest } from './prepare-test-env-ava.js';

import { createRequire } from 'module';
import { env as ambientEnv } from 'node:process';
import * as ambientChildProcess from 'node:child_process';
import * as ambientFsp from 'node:fs/promises';
import { E, passStyleOf } from '@endo/far';
import { AmountMath } from '@agoric/ertp/src/amountMath.js';
import { extract } from '@agoric/vats/src/core/utils.js';
import process from 'process';
import {
  makeAirdropContextTerms,
  permit,
  startTribblesDistribution,
} from '../src/tribbles-distribution.proposal.js';

import { makeBundleCacheContext, getBundleId } from '../tools/bundle-tools.js';
import { makeE2ETools } from '../tools/e2e-tools.js';
import {
  payerPete,
  receiverRex,
  receiverRose,
  senderContract,
} from './market-actors.js';
import {
  makeNameProxy,
  makeAgoricNames,
} from '../tools/ui-kit-goals/name-service-client.js';
import { mockWalletFactory } from '../tools/wallet-tools.js';
import { bootAndInstallBundles, makeMockTools } from '../tools/boot-tools.js';
import { merkleTreeAPI } from '../src/merkle-tree/index.js';
import { oneDay, TimeIntervals } from '../src/airdrop/helpers/time.js';
import { agdTestKeys } from './eligibility-tree/tree.data.js';
import {
  produceBoardAuxManager,
  permit as boardAuxPermit,
} from '../src/platform-goals/board-aux.core.js';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { makeClientMarshaller } from './marshalTables.js';
import bundleSource from '@endo/bundle-source';
import { makeMarshal } from '@endo/marshal';
import { makeStableFaucet } from './mintStable.js';
const makeRelTimeMaker = brand => nat =>
  harden({ timerBrand: brand, relValue: nat });

/** @type {import('ava').TestFn<Awaited<ReturnType<makeTestContext>>>} */
const test = anyTest;

const AIRDROP_TIERS_STATIC = [9000, 6500, 3500, 1500, 750];
const defaultCustomTerms = {
  tiers: AIRDROP_TIERS_STATIC,
  totalEpochs: 5,
  epochLength: TimeIntervals.SECONDS.ONE_DAY * 10n,
  bonusSupply: 100_000n,
  baseSupply: 10_000_000n,
  tokenName: 'Tribbles',
  startTime: brand =>
    makeRelTimeMaker(brand)(TimeIntervals.SECONDS.ONE_DAY * 3n),
};

const getLastElement = array => array[array.length - 1];

const createTestScenarios = async (t, pubkeys = agdTestKeys) => {
  console.log('t.context ::::', t.context);
  console.log('----------------------------------');
  const {
    generateMerkleProof,
    getMerkleRootFromMerkleProof,
    generateMerkleTree,
    generateMerkleRoot,
  } = merkleTreeAPI;
  const merkleRoot = generateMerkleRoot(pubkeys);

  console.log('pubkeys:::', pubkeys);
  const generatedMerkleProof = generateMerkleProof(pubkeys[4], pubkeys);

  const merkleTree = generateMerkleTree(pubkeys);

  t.deepEqual(getLastElement(merkleTree), merkleRoot);

  console.group('################ inside simulate airdrop ##############');
  console.log('----------------------------------------');
  console.log('merkleTree ::::', merkleTree);
  console.log('----------------------------------------');
  console.log('generatedMerkleProof ::::', generatedMerkleProof);
  console.groupEnd();
  const simulateAirdropDeployment = async (
    t,
    { terms = { ...defaultCustomTerms, rootHash: merkleRoot } },
  ) => {
    t.log('inside simulate deployment:::');
    console.group(
      '################ inside simulateAirdropDeployment ##############',
    );
    console.log('----------------------------------------');
    console.log('merkleRoot ::::', merkleRoot);
    console.log('----------------------------------------');
    console.log('merkleTree ::::', merkleTree);
    console.log('----------------------------------');
    console.log('terms ::::', terms);
    console.log('----------------------------------');
    console.groupEnd();
  };
  const simulateEligibleClaim = t => {};
  const simulateIneligibleClaim = () => {};
  return {
    simulateAirdropDeployment,
    merkleRoot,
    merkleTree,
    getMerkleProof: pk => generateMerkleProof(pk, pubkeys),
    simulateIneligibleClaim,
    simulateEligibleClaim,
  };
};

const nodeRequire = createRequire(import.meta.url);

const bundleRoots = {
  tribblesDistribution: nodeRequire.resolve(
    '../src/tribbles-distribution.contract.js',
  ),
};

const scriptRoots = {
  postalService: nodeRequire.resolve('../src/postal-service.proposal.js'),
  tribblesDistribution: nodeRequire.resolve(
    '../src/tribbles-distribution.proposal.js',
  ),
};

/** @param {import('ava').ExecutionContext} t */
const makeTestContext = async t => {
  const bc = await makeBundleCacheContext(t);

  const { E2E } = ambientEnv;
  const { execFileSync, execFile } = ambientChildProcess;
  const { writeFile } = ambientFsp;

  /** @type {import('../tools/agd-lib.js').ExecSync} */
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

  const { bundles } = bc;
  console.log('bundles ::::', bundles);
  console.log('----------------------------------');
  const runLocalInstallAndStart = async (contractBundle, contractArgs) => {
    const bundle = await bundleSource(bundleRoots.tribblesDistribution);
    const installation = await E(zoe);
    const customTerms = makeAirdropContextTerms(defaultCustomTerms);
    const startArgs = {
      timer: buildManualTimer((x, prev = 'ground zero') => {
        console.log('timer logger:::', {
          previous: (prev = x && prev),
          current: x,
        });
        return x;
      }, 0n),
      marshaller: makeClientMarshaller(),
    };
  };

  console.log('test tools:::', { process, env: process.env });
  const instantiateContractFn =
    process.env.LOCAL_ENV === 'local'
      ? {
          ...tools,
          runCoreEval: runLocalInstallAndStart(
            {},
            {
              terms: defaultCustomTerms,
            },
          ),
        }
      : tools;
  return { ...instantiateContractFn, ...bc };
};

test.before(async t => (t.context = await makeTestContext(t)));

test.serial('well-known brand (ATOM) is available', async t => {
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

test.serial('install bundle: postalService / send', async t => {
  const { installBundles } = t.context;
  console.time('installBundles');
  console.timeLog('installBundles', Object.keys(bundleRoots).length, 'todo');
  const bundles = await installBundles(bundleRoots, (...args) =>
    console.timeLog('installBundles', ...args),
  );

  console.timeEnd('installBundles');

  const id = getBundleId(bundles.tribblesDistribution);
  const shortId = id.slice(0, 8);
  t.log('postalService', shortId);
  t.is(id.length, 3 + 128, 'bundleID length');
  t.regex(id, /^b1-.../);

  Object.assign(t.context.shared, { bundles });
});

test.serial('deploy contract with core eval: postalService / send', async t => {
  const { runCoreEval } = t.context;
  const { bundles } = t.context.shared;
  const bundleID = getBundleId(bundles.tribblesDistribution);

  const { zoe } = await powers.consume;
  const result = await E(zoe).installBundleID(bundleID, 'airdrop');

  t.log(result.voting_end_time, '#', result.proposal_id, 'Airdrop');
  t.like(result, {
    content: {
      '@type': '/agoric.swingset.CoreEvalProposal',
    },
    status: 'PROPOSAL_STATUS_PASSED',
  });
});

test.serial('agoricNames.instances has contract: postalService', async t => {
  const { makeQueryTool } = t.context;
  const hub0 = makeAgoricNames(makeQueryTool());
  const agoricNames = makeNameProxy(hub0);
  await null;
  const instances = await agoricNames.instance;
  console.log('instances::::', { keys: [...instances.keys()] }, instances);
  const instance = await agoricNames.instance.tribblesDistribution;
  t.log(instance);
  t.is(passStyleOf(instance), 'remotable');
});

test.todo('deliver payment using offer with non-fungible');

const tribblesAdmin = (t, { zoe, terms }) => {};
test.todo('E2E: send using publicFacet using contract');

test('send invitation* from contract using publicFacet of postalService', async t => {
  const { powers, bundles } = await bootAndInstallBundles(t, bundleRoots);

  const bundleID = getBundleId(bundles.tribblesDistribution);

  console.log({ powers });
  const postalPowers = extract(permit, powers);
  const { zoe, namesByAddressAdmin, chainTimerService, feeMintAccess } =
    await powers.consume;

  const timer = await chainTimerService;
  const timerBrand = await E(timer).getTimerBrand();
  const relTimeMaker = makeRelTimeMaker(timerBrand);
  const customStartTerms = makeAirdropContextTerms({
    startTime: relTimeMaker(oneDay),
    tiers: AIRDROP_TIERS_STATIC,
    targetEpochLength: oneDay,
    targetNumberOfEpochs: 5,
    tokenName: 'Tribbles',
  });

  const installation = await E(zoe).install(
    await bundleSource(bundleRoots.tribblesDistribution),
  );

  const smartWalletIssuers = {
    Invitation: await E(zoe).getInvitationIssuer(),
    IST: await E(zoe).getFeeIssuer(),
  };

  const instance = await E(zoe).startInstance(
    installation,
    { Fee: smartWalletIssuers.IST },
    { ...customStartTerms, startTime: relTimeMaker(oneDay) },
    { timer },
  );

  console.log('instance ::::', instance);
  console.log('----------------------------------');
  // TODO: use CapData across vats
  // const boardMarshaller = await E(board).getPublishingMarshaller();
  const walletFactory = mockWalletFactory(
    { zoe, namesByAddressAdmin },
    smartWalletIssuers,
  );

  /** @type {StartedInstanceKit<import('../src/postal-service.contract.js').tribblesDistributionFn>['instance']} */
  // @ts-expect-error not (yet?) in BootstrapPowers

  const shared = {
    rxAddr: 'agoric1receiverRex',
    toSend: {
      ToDoNothing: AmountMath.make(
        await powers.brand.consume.Invitation,
        harden([]),
      ),
    },
  };

  const wallet = await walletFactory.makeSmartWallet(shared.rxAddr);

  await E(timer).advanceTo(oneDay * (oneDay / 2n));

  await E(timer).tickN(10n);

  const feeAmt = (x = 5n) => AmountMath.make(smartWalletIssuers.IST, x);

  const stableFaucet = makeStableFaucet({
    feeMintAccess,
    zoe,
    bundleCache: t.context.bundleCache,
  });
  const simulateClaim = async invitation => {
    const seat = await E(zoe).offer(
      invitation,
      harden({
        give: {
          Fee: AmountMath.make(smartWalletIssuers.IST, 5n),
        },
      }),
      harden({
        Fee: stableFaucet.mintBrandedPayment(5n),
      }),
    );
  };

  const [invitation] = await Promise.all([
    E(instance.publicFacet).makeClaimTokensInvitation(),
  ]);
  await simulateClaim(invitation);
});

test.todo('partial failure: send N+1 payments where >= 1 delivery fails');
