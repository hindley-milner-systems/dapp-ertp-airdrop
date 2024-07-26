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
import { makeIssuerKit } from '@agoric/ertp';


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
import {
  permit as airdropPermit,
  startAirdropCampaignContract,
} from '../src/airdrop.proposal.js';

/** @type {import('ava').TestFn<Awaited<ReturnType<setupTestContext>>>} */
const test = anyTest;

const nodeRequire = createRequire(import.meta.url);

const bundleRoots = {
  postalService: nodeRequire.resolve('../src/postal-service.contract.js'),
  airdrop: nodeRequire.resolve('../src/airdrop.contract.js'),
};

const scriptRoots = {
  postalService: nodeRequire.resolve('../src/postal-service.proposal.js'),
  airdrop: nodeRequire.resolve('../src/airdrop.proposal.js'),
};

/** @param {import('ava').ExecutionContext} t */
const setupTestContext = async t => {
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

  return { ...tools, ...bc };
};

test.before(async t => (t.context = await setupTestContext(t)));

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

test.serial('install bundle: airdrop / send', async t => {
  const { installBundles } = t.context;
  console.time('installBundles');
  console.timeLog('installBundles', Object.keys(bundleRoots).length, 'todo');
  const bundles = await installBundles(bundleRoots, (...args) =>
    console.timeLog('installBundles', ...args),
  );
  console.timeEnd('installBundles');

  const id = getBundleId(bundles.airdrop);
  const shortId = id.slice(0, 8);
  t.log('postalService', shortId);
  t.is(id.length, 3 + 128, 'bundleID length');
  t.regex(id, /^b1-.../);

  Object.assign(t.context.shared, { bundles });
});

test.serial('deploy contract with core eval: airdrop / send', async t => {
  const { runCoreEval } = t.context;
  const { bundles } = t.context.shared;
  const bundleID = getBundleId(bundles.airdrop);

  const name = 'send';
  const result = await runCoreEval({
    name,
    behavior: startAirdropCampaignContract,
    entryFile: scriptRoots.airdrop,
    config: {
      options: { airdrop: { bundleID }, tokenKit: makeIssuerKit('Tribbles') },
    },
  });

  t.log(result.voting_end_time, '#', result.proposal_id, name);
  t.like(result, {
    content: {
      '@type': '/agoric.swingset.CoreEvalProposal',
    },
    status: 'PROPOSAL_STATUS_PASSED',
  });
});

test.serial('agoricNames.instances has contract: airdrop', async t => {
  const { makeQueryTool } = t.context;
  const hub0 = makeAgoricNames(makeQueryTool());

  const agoricNames = makeNameProxy(hub0);
  console.log({ agoricNames });
  await null;
  const instance = await agoricNames.instance.produce.airdrop;
  t.deepEqual(instance, '');
  t.log(instance);
  t.is(passStyleOf(instance), 'remotable');
});

test.todo('deliver payment using offer with non-fungible');

test.serial('deliver payment using offer', async t => {
  const { provisionSmartWallet, makeQueryTool } = t.context;
  const qt = makeQueryTool();
  const hub0 = makeAgoricNames(qt);
  /** @type {import('./market-actors.js').WellKnown} */
  const agoricNames = makeNameProxy(hub0);

  await null;
  const { make: amt } = AmountMath;
  const shared = {
    rxAddr: 'agoric1aap7m84dt0rwhhfw49d4kv2gqetzl56vn8aaxj',
    toSend: {
      Pmt: amt(await agoricNames.brand.ATOM, 3n),
    },
    issuers: [await agoricNames.issuer.ATOM],
  };

  const wallet = {
    pete: await provisionSmartWallet(
      'agoric1xe269y3fhye8nrlduf826wgn499y6wmnv32tw5',
      { ATOM: 10n, BLD: 75n },
    ),
    rose: await provisionSmartWallet(shared.rxAddr, {
      BLD: 20n,
    }),
  };
  const pqt = makeQueryTool();
  for (const kind of ['instance', 'brand']) {
    const entries = await E(E(hub0).lookup(kind)).entries();
    pqt.fromCapData(qt.toCapData(entries));
  }

  await Promise.all([
    payerPete(t, { wallet: wallet.pete, queryTool: pqt }, shared),
    receiverRose(t, { wallet: wallet.rose }, shared),
  ]);
});

test.todo('E2E: send using publicFacet using contract');

test('send invitation* from contract using publicFacet of airdrop', async t => {
  const { powers, bundles } = await bootAndInstallBundles(t, bundleRoots);

  const bID = `b1-${bundles.airdrop.endoZipBase64Sha512}`;

  const bundleID = bID;
  const postalPowers = extract(airdropPermit, powers);

  console.log({ bundleID });
  console.log({
    postalPowers,
  });
  await startAirdropCampaignContract(postalPowers, {
    options: {
      airdrop: { bundleID },
    },
  });

  const { zoe, namesByAddressAdmin } = powers.consume;
  const smartWalletIssuers = {
    Invitation: await E(zoe).getInvitationIssuer(),
    IST: await E(zoe).getFeeIssuer(),
  };

  // TODO: use CapData across vats
  // const boardMarshaller = await E(board).getPublishingMarshaller();
  const walletFactory = mockWalletFactory(
    { zoe, namesByAddressAdmin },
    smartWalletIssuers,
  );

  /** @type {StartedInstanceKit<import('../src/postal-service.contract.js').PostalServiceFn>['instance']} */
  // @ts-expect-error not (yet?) in BootstrapPowers
  const instance = await powers.instance.consume.postalService;

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
  const terms = { postalService: instance, destAddr: shared.rxAddr };
  await Promise.all([
    senderContract(t, { zoe, terms }),
    receiverRex(t, { wallet }, shared),
  ]);
});

test.todo('partial failure: send N+1 payments where >= 1 delivery fails');
