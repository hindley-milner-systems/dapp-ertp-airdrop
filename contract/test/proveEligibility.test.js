/* global Buffer */
/* eslint-disable import/order */
// @ts-check
import { test as anyTest } from './airdropData/prepare-test-env-ava.js';
import { createRequire } from 'module';
import { E, Far } from '@endo/far';
import { AmountMath } from '@agoric/ertp/src/amountMath.js';
import { TimeMath } from '@agoric/time';
import {
  bootAndInstallBundles,
  makeSmartWalletFactory,
} from '../tools/boot-tools.js';
import { makeBundleCacheContext } from '../tools/bundle-tools.js';
import { M, makeCopySet, mustMatch } from '@endo/patterns';

/**
 * 1. add getTree and verifyProof method to TreeRemotable
 * 2. verify validity proof against merkle root
 */
import '@agoric/store/exported.js';
import {
  accounts,
  makeSha256Hash,
  preparedAccounts,
  TEST_TREE_DATA,
} from './data/agoric.accounts.js';
import { TimeIntervals } from '../src/airdrop/helpers/time.js';
import { setup } from './setupBasicMints.js';
import { compose, objectToMap } from '../src/airdrop/helpers/objectTools.js';
import { makeMarshal } from '@endo/marshal';
import { createClaimSuccessMsg } from '../src/airdrop/helpers/messages.js';
import { makeTreeRemotable } from './data/tree.utils.js';
import { encodeBase64 } from '@endo/base64';
import { MerkleTree } from 'merkletreejs';
const trace = label => value => {
  console.log(label, '::::', value);
  return value;
};
const Id = value => ({
  value,
  map: f => Id(f(value)),
  chain: f => f(value),
  extract: () => value,
  concat: o => Id(value.concat(o.extract())),
  inspect() {
    console.log(
      'Id(',
      typeof this.value === 'object'
        ? Object.entries(this.value).map(x => x)
        : this.value,
      ')',
    );
    return Id(this.value);
  },
});
Id.of = x => Id(x);

const head = ([x]) => x;
const parseAccountInfo = ({ pubkey, address }) => ({
  pubkey: pubkey.key,
  address,
});

const defaultClaimaint = {
  // @ts-ignore
  ...parseAccountInfo(head(accounts)),
  proof: head(TEST_TREE_DATA.proofs),
};

const getLast = iterable => iterable[iterable.length - 1];
const getTier = compose(head, getLast);

const makeClaimOfferArgs = ({
  pubkey,
  address,
  proof,
  tier,
} = defaultClaimaint) => ({
  pubkey,
  tier,
  address,
  proof,
});
const claimCount = 0;
const simulateClaim = async (
  t,
  invitation,
  expectedPayout,
  claimAccountDetails = {},
) => {
  console.log('inside simulateClaim', { ...claimAccountDetails });
  // claimAccountDetails object holds values that are passed into the offer as offerArgs
  // proof should be used to verify proof against tree (e.g. tree.verify(proof, leafValue, hash) where tree is the merkletree, leafValue is pubkey value, and root hash of tree)
  // address is used in conjunction with namesByAddress/namesByAddressAdmin to send tokens to claimain (see https://docs.agoric.com/guides/integration/name-services.html#namesbyaddress-namesbyaddressadmin-and-depositfacet-per-account-namespace)
  const { zoe, airdropIssuer: tokenIssuer, marshaller } = await t.context;

  t.log('Proof::', claimAccountDetails.proof);
  const offerArgsObject = await E(marshaller).marshall(
    harden({
      ...claimAccountDetails,
      proof: Far('proof remotable', {
        getProof() {
          return claimAccountDetails.proof;
        },
      }),
    }),
  );

  t.log('offerArgsObject', offerArgsObject);

  /** @type {UserSeat} */
  const claimSeat = await E(zoe).offer(
    invitation,
    undefined,
    undefined,
    offerArgsObject,
  );

  t.log('------------ testing claim capabilities -------');
  t.log('-----------------------------------------');
  t.log('AirdropResult', claimSeat);
  t.log('-----------------------------------------');
  t.log('expectedPayout value', expectedPayout);
  t.log('-----------------------------------------');
  const offerResult = await E(claimSeat).getOfferResult();
  //
  t.deepEqual(
    offerResult,
    // Need
    createClaimSuccessMsg(expectedPayout),
  );

  const claimPayment = await E(claimSeat).getPayout('Payment');

  t.deepEqual(await E(tokenIssuer).isLive(claimPayment), true); // any particular reason for isLive check? getAmountOf will do that.
  t.deepEqual(
    await E(tokenIssuer).getAmountOf(claimPayment),
    expectedPayout,
    `claimPayment #${claimCount} should contain the correct payment value.`,
  );

  t.log('tests pass for account:', claimAccountDetails.address);
};
const filename = new URL(import.meta.url).pathname;

/** @type {import('ava').TestFn<Awaited<ReturnType<makeBundleCacheContext>>>} */
const test = anyTest;

test.before(async t => (t.context = await makeBundleCacheContext(t)));

const ONE_THOUSAND = 1000n;
const nodeRequire = createRequire(import.meta.url);
const { memeMint, memeIssuer, memes, moola, zoe } = setup();

// const contractName = 'launchIt';
const airdropName = 'airdropCampaign';
const bundleRoots = {
  // [contractName]: nodeRequire.resolve('../src/launchIt.js'),
  [airdropName]: nodeRequire.resolve('../src/airdrop.contract.js'),
  // contractStarter: nodeRequire.resolve('../src/contractStarter.js'),
};
const createToknSupplyRanges =
  (amountMaker = moola) =>
  (floorSupply, maxCirculatingSupply) => ({
    initialSupply: amountMaker(floorSupply),
    bonusSupply: AmountMath.subtract(
      amountMaker(maxCirculatingSupply),
      amountMaker(floorSupply),
    ),
  });
const makeMemesSupply = createToknSupplyRanges(memes);
test('airdropRanges object', async t => {
  // There are a number of ways to calculate this (most of which are likely better)
  // Arriving at 10_500_00k....
  // - floorSupply: 10 Million
  // - bonus mints: vehice for minor increase in circulating supply of token. 1% per epoch, or 100k per epoch.
  // 10_500_000k = 5 * (1/100 * 10_0000) 1% of floor supply
  //
  const memesSupply = makeMemesSupply(10_000_000n, 10_500_000n);
  t.deepEqual(
    memesSupply.initialSupply,
    memes(10_000_000n),
    'should contain information about the minimum circulating supply',
  );
  t.deepEqual(
    memesSupply.bonusSupply,
    memes(500_000n),
    'should contain information about the maximum ciruclating supply',
  );

  const combinedSupply = AmountMath.add(
    memesSupply.initialSupply,
    memesSupply.bonusSupply,
  );
  t.deepEqual(
    combinedSupply,
    memes(10_500_000n),
    'should expose inputs for calculating the maximum circulating supply.',
  );
});

export const makeRelTimeMaker = brand => nat =>
  harden({ timerBrand: brand, relValue: nat });

const PurseHolder = purse => ({
  purse,
  deposit(payment) {
    console.log('inside deposit', this.purse);
    this.purse.deposit(payment);
    return PurseHolder(this.purse);
  },
  checkBalance() {
    console.log('inside checkBalanace', this.purse);
    return this.purse.getCurrentAmount();
  },
  makePayment(amount) {
    return this.purse.withdraw(amount);
  },
});

const mintToPurse =
  mint =>
  ({ amount, purse }) =>
    purse.deposit(mint.mintPayment(amount));

const mintMemesToPurse = mintToPurse(memeMint);

const id = x => x;

const mintToPurses = ({ primaryPurse, bonusPurse, baseSupply, bonusSupply }) =>
  [
    { amount: memes(baseSupply), purse: bonusPurse },
    { amount: memes(bonusSupply), purse: primaryPurse },
  ]
    .map(trace('befoe mint'))
    .map(x => mintToPurse(memeMint)(x));

// test('Fn', async t => {
//   Fn(x => mintMemesToPurse(x)).run();
// });

const makeTimerPowers = async ({ consume }) => {
  const timer = await consume.chainTimerService;

  const timerBrand = await E(timer).getTimerBrand();
  const relTimeMaker = makeRelTimeMaker(timerBrand);

  const relTime = relTimeMaker(TimeIntervals.SECONDS.ONE_DAY);

  return {
    timer,
    timerBrand,
    relTime,
    relTimeMaker,
  };
};
// Example usage with AIRDROP_TIERS:
const AIRDROP_TIERS = {
  0: [1000, 800, 650, 500, 350],
  1: [600, 480, 384, 307, 245],
  2: [480, 384, 307, 200, 165],
  3: [300, 240, 192, 153, 122],
  4: [100, 80, 64, 51, 40],
  5: [15, 13, 11, 9, 7],
};

const makeTestContext = async t => {
  const bootKit = await bootAndInstallBundles(t, bundleRoots);
  const walletFactory = makeSmartWalletFactory(bootKit.powers);
  const { powers, bundles } = bootKit;

  const { timer, timerBrand, relTimeMaker } = await makeTimerPowers(powers);

  // t.deepEqual(
  //   await MemePurse.map(x => x.deposit(memeMint.mintPayment(memes(10_000n)))),
  //   MemePurse.inspect(),
  // );

  const startTime = relTimeMaker(TimeIntervals.SECONDS.ONE_DAY);
  t.deepEqual(TimeMath.relValue(startTime), TimeIntervals.SECONDS.ONE_DAY);
  const isFrozen = x => Object.isFrozen(x);

  t.deepEqual(
    isFrozen(timer),
    true,
    'Timer being passed into contract via privateArgs must be frozen.',
  );

  const invitationIssuer = await E(zoe).getInvitationIssuer();
  const invitationBrand = await E(invitationIssuer).getBrand();

  const { airdropCampaign } = bundles;

  const airdropInstallation = await E(zoe).install(airdropCampaign);

  const defaultCustomTerms = {
    tiers: AIRDROP_TIERS,
    rootHash: TEST_TREE_DATA.rootHash,
    totalEpochs: 5,
    epochLength: TimeIntervals.SECONDS.ONE_DAY,
    bonusSupply: 100_000n,
    baseSupply: 10_000_000n,
    tokenName: 'Tribbles',
    startTime: relTimeMaker(TimeIntervals.SECONDS.ONE_DAY * 3n),
  };

  const objectToSymbolArray = obj =>
    Object.entries(obj).map(([key, value], index) => [index, value]);

  const makeStartOpts = ({ customTerms = {}, privateArgs = {} }) => ({
    ...harden(customTerms),
    ...harden(privateArgs),
  });

  const testTreeRemotable = makeTreeRemotable(
    TEST_TREE_DATA.tree,
    TEST_TREE_DATA.rootHash,
    MerkleTree,
    makeSha256Hash,
  );
  const { toCapData, fromCapData } = makeMarshal();
  const marshaller = Far('marshaller', {
    marshall(x) {
      return toCapData(x);
    },
    unmarshal(x) {
      return fromCapData(x);
    },
  });
  const instance = await E(zoe).startInstance(
    airdropInstallation,
    undefined,
    harden(defaultCustomTerms),
    harden({
      TreeRemotable: testTreeRemotable,
      timer,
      marshaller,
    }),
    'c1-ownable-Airdrop',
  );

  const airdropIssuer = await E(instance.publicFacet).getIssuer();
  const issuerBrand = await airdropIssuer.getBrand();

  t.context = {
    ...t.context,
    marshaller,
    walletFactory,
    invitationIssuer,
    invitationBrand,
    airdropIssuer,
    airdropAmount: x => AmountMath.make(issuerBrand, x),
    zoe,
    timer,
    testTreeRemotable,
    makeStartOpts,
    airdropInstallation,
    instance,
    publicFacet: instance.publicFacet,
  };
};
// test.before('setup', async t => {
//   await makeTestContext(t);
// });
test('airdrop purses', async t => {
  const { initialSupply, bonusSupply } = makeMemesSupply(
    1_000_000n,
    1_500_000n,
  );

  const [primaryPurse, secondaryPurse] = [
    memeIssuer.makeEmptyPurse().deposit(memeMint.mintPayment(initialSupply)),
    memeIssuer.makeEmptyPurse().deposit(memeMint.mintPayment(bonusSupply)),
  ]
    .map(PurseHolder)
    .map(Id);

  const getProp = prop => obj => obj[prop];
  const getValue = getProp('value');
  const getPurse = getProp('purse');

  const getBalance = compose(getPurse, getValue);

  t.deepEqual([primaryPurse, secondaryPurse].map(getBalance), [
    initialSupply,
    bonusSupply,
  ]);
});

const handleValidateProof =
  (tree = TEST_TREE_DATA.tree, hash = TEST_TREE_DATA.rootHash) =>
  (proof = preparedAccounts[0].proof, nodeValue = '') =>
    tree.verify(proof, nodeValue, hash);

test('merkle tree verification', t => {
  const verifyAgainstTestTree = handleValidateProof();

  t.deepEqual(
    verifyAgainstTestTree() === false,
    true,
    'verifyAgainstTestTree function given default arguments, should return true',
  );

  t.deepEqual(
    verifyAgainstTestTree(
      preparedAccounts[1].proof,
      preparedAccounts[1].pubkey,
    ),
    true,
    'handleValidateProof function given a proof and its corresponding account should return true',
  );

  t.deepEqual(
    verifyAgainstTestTree(preparedAccounts[0].proof, 'notarealpubkey'),
    false,
    'handleValidateProof function given proof and a pubkey value that does not exist in the tree should return false',
  );
});

test('airdrop claim :: eligible participant', async t => {
  await makeTestContext(t);

  const { publicFacet, timer, testTreeRemotable, airdropAmount } =
    await t.context;

  const airdropIssuer = await E(publicFacet).getIssuer();
  const issuerBrand = await airdropIssuer.getBrand();

  const validateFn = await E(testTreeRemotable).getVerificationFn();
  const [alice, bob, carol, dan, eva, ...x] =
    preparedAccounts.map(makeClaimOfferArgs);

  preparedAccounts.map(trace('account'));
  await preparedAccounts.map(({ proof }, index) =>
    proof.map(({ data }) =>
      t.deepEqual(
        Buffer.isBuffer(data),
        true,
        `proof generated for account ${index} should be a Buffer.`,
      ),
    ),
  );

  await preparedAccounts.map(x => {
    t.log('verifying x', x);
    t.deepEqual(
      validateFn(x.proof, x.pubkey),
      true,
      'TreeRemotable should expose function that properly verifies a proof against a Merkle tree',
    );
  });

  await E(timer).advanceTo(2719838800n);

  const getTier = ({ tier }) => tier;

  const toNumber = x => Number(x);

  console.log('alice', alice);
  const formatTierForLookup = compose(toNumber, getTier);

  t.deepEqual(
    formatTierForLookup(alice),
    1,
    `formatTierForLoopp given alice's pubkey should return a value indicating the correct tier for the account.`,
  );

  const toBigInt = x => BigInt(x);
  const getExpectedTokenAMount = epoch =>
    compose(
      toBigInt,
      trace('after tier lookup'),
      x => AIRDROP_TIERS[epoch][x],
      formatTierForLookup,
    );

  const tribbles = x => AmountMath.make(issuerBrand, x);

  await simulateClaim(
    t,
    await E(publicFacet).makeClaimInvitation(),
    tribbles(getExpectedTokenAMount(0)(alice)),
    alice,
  );

  const t0 = await E(timer).getCurrentTimestamp();
  await E(timer).advanceTo(t0.absValue + 86_400n);

  t.deepEqual(
    formatTierForLookup(bob),
    2,
    `formatTierForLoopp given bob's pubkey should return a value indicating the correct tier for the account.`,
  );

  await simulateClaim(
    t,
    await E(publicFacet).makeClaimInvitation(),
    tribbles(getExpectedTokenAMount(1)(bob)),
    bob,
  );
  const t1 = await E(timer).getCurrentTimestamp();

  await simulateClaim(
    t,
    await E(publicFacet).makeClaimInvitation(),
    tribbles(getExpectedTokenAMount(1)(carol)),
    carol,
  );

  await E(timer).advanceBy(90_000n);

  await simulateClaim(
    t,
    await E(publicFacet).makeClaimInvitation(),
    tribbles(getExpectedTokenAMount(2)(dan)),
    dan,
  );
});

test('airdrop claim :: invalid offer args', async t => {
  await makeTestContext(t);

  const { publicFacet, timer, marshaller } = await t.context;

  await E(timer).advanceTo(2719838800n);

  const invitation = await E(publicFacet).makeClaimInvitation();
  const [alice] = preparedAccounts.map(makeClaimOfferArgs);

  const offerArgsObject = await E(marshaller).marshall(
    harden({
      ...alice,
      pubkey: 'IamNotthecorrectpubkey',
      proof: Far('proof remotable', {
        getProof() {
          return Buffer.from('incorrect proof');
        },
      }),
    }),
  );
  const offer = E(zoe).offer(
    invitation,
    undefined,
    undefined,
    harden(offerArgsObject),
  );

  await t.throwsAsync(() => E(offer).getOfferResult(), {
    message: 'Failed to verify the existence of pubkey IamNotthecorrectpubkey.',
  });
});

// test('claim attempts with tiers', async t => {
//   await makeTestContext(t);

//   const { publicFacet, timer, testTreeRemotable } = await t.context;

//   const validateFn = await E(testTreeRemotable).getVerificationFn();
//   const [alice, bob, carol, dan, eva, ...x] =
//     preparedAccounts.map(makeClaimOfferArgs);

//   await E(timer).advanceTo(2719838800n);

//   await simulateClaim(
//     t,
//     await E(publicFacet).makeClaimInvitation(),
//     memes(1000n),
//     alice,
//   );

//   const t0 = await E(timer).getCurrentTimestamp();
//   await E(timer).advanceTo(t0.absValue + 86_400n);

//   await simulateClaim(
//     t,
//     await E(publicFacet).makeClaimInvitation(),
//     memes(1000n),
//     bob,
//   );
//   const t1 = await E(timer).getCurrentTimestamp();
//   await E(timer).advanceTo(t1.absValue + 86_400n);

//   await simulateClaim(
//     t,
//     await E(publicFacet).makeClaimInvitation(),
//     memes(1000n),
//     carol,
//   );
//   await E(timer).advanceTo(t1.absValue + 186_400n);
// });
// test('airdrop claim :: claim attempts with tiers', async t => {});
// // const { publicFacet, timer, testTreeRemotable } = await t.context;

test.todo('claim attempts after the last epoch has ended'); //, async t => {
//   const { context } = await t;

//   t.log(context);
// });

test.todo('bonus mints');

test.todo('token burning mechanisms');
