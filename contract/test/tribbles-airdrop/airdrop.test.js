// @ts-nocheck
import { test as anyTest } from '../prepare-test-env-ava.js';
import { makeDoOffer } from './tools/e2e-tools.js';
import { commonSetup } from './support.js';
import {
  agoricGenesisAccounts as agoricAccounts,
  pubkeys,
} from '../airdrop-data/genesis.keys.js';
import { merkleTreeAPI } from '../airdrop-data/merkle-tree/index.js';

/** @type {import('ava').TestFn<Awaited<ReturnType<makeTestContext>>>} */
const test = anyTest;

const contractName = 'tribblesAirdrop';
const contractBuilder = './builder/start-tribbles-airdrop.js';

const generateInt = x => () => Math.floor(Math.random() * (x + 1));

const createTestTier = generateInt(4); // ?

const accounts = ['alice', 'bob', 'carol'];

test.before(async t => {
  const { deleteTestKeys, setupTestKeys, ...rest } = await commonSetup(t);
  deleteTestKeys(accounts).catch();
  const wallets = await setupTestKeys(accounts);
  t.context = { ...rest, wallets, deleteTestKeys };
  const { startContract } = rest;

  console.group(
    '################ START inside test.before logger ##############',
  );
  console.log('----------------------------------------');
  console.log('t.context ::::', t.context);
  console.log('----------------------------------------');
  console.log('wallets ::::', wallets);

  console.log(
    '--------------- END insi ®de test.before logger -------------------',
  );
  console.groupEnd();
  await startContract(contractName, contractBuilder);
});

test.after(async t => {
  const { deleteTestKeys } = t.context;
  deleteTestKeys(accounts);
});
const makeMakeOfferArgs =
  (keys = pubkeys) =>
  ({ pubkey: { key = '' }, address = 'agoric12d3fault' }) => ({
    key,
    proof: merkleTreeAPI.generateMerkleProof(key, keys),
    address,
    tier: createTestTier(),
  });
const makeOfferArgs = makeMakeOfferArgs(pubkeys);

const simulatreClaim = test.macro({
  title: (_, agoricAccount) =>
    `Simulate claim for account ${agoricAccount.name} with address ${agoricAccount.address}`,
  exec: async (t, agoricAccount) => {
    console.log(t.context);
    const { pubkey } = agoricAccount;
    console.log(
      `testing makeCreateAndFundScenario for account ${agoricAccount.name}, and pubkey ${pubkey}`,
    );
    const { wallets, provisionSmartWallet, vstorageClient } = t.context;

    t.log(
      wallets[accounts[0]],
      Object.values(wallets).map(x => x),
    );

    const [brands, instances] = await Promise.all([
      vstorageClient.queryData('published.agoricNames.brand'),
      vstorageClient.queryData('published.agoricNames.instance'),
    ]);

    console.log('Brands::', brands);

    const istBrand = Object.fromEntries(brands).IST;

    console.group(
      '################ START AIRDROP.TEST.TS logger ##############',
    );
    console.log('----------------------------------------');
    console.log('brands ::::', brands);
    console.log('----------------------------------------');
    console.log('instances ::::', Object.fromEntries(instances));
    console.log('----------------------------------');
    console.log(
      '--------------- END AIRDROP.TEST.TS logger -------------------',
    );
    console.groupEnd();
    const feeAmount = harden({
      brand: istBrand,
      value: 5n,
    });

    // const testAddresses = await Promise.all(
    //   Object.values(wallets).map(async x => {
    //     await null;
    //     const newWallet = await provisionSmartWallet(x, {
    //       IST: 100n,
    //       BLD: 50n,
    //     });
    //     t.log('provisioned wallet for address::', x);
    //     return newWallet;
    //   }),
    // );

    const currentAcct = agoricAccount;

    const alicesWallet = await provisionSmartWallet(currentAcct.address, {
      IST: 10n,
      BLD: 30n,
    });

    const doOffer = makeDoOffer(alicesWallet);
    const offerId = `offer-${Date.now()}`;
    await doOffer({
      id: offerId,
      invitationSpec: {
        source: 'agoricContract',
        instancePath: [contractName],
        callPipe: [['makeClaimTokensInvitation']],
      },
      offerArgs: {
        ...makeOfferArgs(currentAcct),
        proof: merkleTreeAPI.generateMerkleProof(
          currentAcct.pubkey.key,
          agoricAccounts.map(x => x.pubkey.key),
        ),
        tier: 3,
      },
      proposal: {
        give: { Fee: feeAmount },
      },
    });
    const walletViewResults = await Promise.all(
      Object.values(wallets).map(x => vstorageClient.walletView(x)),
    );

    console.group(
      '################ START walletViewResults logger ##############',
    );
    console.log('----------------------------------------');
    console.log('walletViewResults ::::', walletViewResults);
    console.log('----------------------------------------');
    console.log('alicesWallet ::::', alicesWallet);
    console.log(
      '--------------- END walletViewResults logger -------------------',
    );
    console.groupEnd();

    const walletCurrent = await vstorageClient.queryData(
      `published.wallet.${currentAcct.address}.current`,
    );
    t.like(walletCurrent, { liveOffers: [], offerToPublicSubscriberPaths: [] });
  },
});
test.serial(simulatreClaim, agoricAccounts[agoricAccounts.length - 1]);
