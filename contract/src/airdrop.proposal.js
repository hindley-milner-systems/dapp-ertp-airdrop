// @ts-check
import { E } from '@endo/far';
import { makeMarshal } from '@endo/marshal';
import { makeHelpers } from '@agoric/deploy-script-support';
import { makeTracer, deeplyFulfilledObject } from '@agoric/internal';
import { makeStorageNodeChild } from '@agoric/internal/src/lib-chainStorage.js';
import { TimeIntervals } from './airdrop/helpers/time.js';
import { AIRDROP_TIERS_STATIC } from '../test/data/account.utils.js';
import './airdrop/types.js';

const { Fail } = assert;

// vstorage paths under published.*
const BOARD_AUX = 'boardAux';

const marshalData = makeMarshal(_val => Fail`data only`);

const IST_UNIT = 1_000_000n;

/**
 * @import {ERef} from '@endo/far';
 * @import {StorageNode} from '@agoric/internal/src/lib-chainStorage.js';
 * @import {BootstrapManifest} from '@agoric/vats/src/core/lib-boot.js';
 */

/**
 * Make a storage node for auxilliary data for a value on the board.
 *
 * @param {ERef<StorageNode>} chainStorage
 * @param {string} boardId
 */
const makeBoardAuxNode = async (chainStorage, boardId) => {
  const boardAux = E(chainStorage).makeChildNode(BOARD_AUX);
  return E(boardAux).makeChildNode(boardId);
};

const publishBrandInfo = async (chainStorage, board, brand) => {
  const [id, displayInfo] = await Promise.all([
    E(board).getId(brand),
    E(brand).getDisplayInfo(),
  ]);
  const node = makeBoardAuxNode(chainStorage, id);
  const aux = marshalData.toCapData(harden({ displayInfo }));
  await E(node).setValue(JSON.stringify(aux));
};

const trace = makeTracer('tribbles airdrop');
/** @import { StartArgs } from './platform-goals/start-contract.js'; */

const relTimeMaker = (timerBrand, x = 0n) =>
  harden({ timerBrand, relValue: x });

export const defaultCustomTerms = {
  initialPayoutValues: harden(AIRDROP_TIERS_STATIC),
  targetNumberOfEpochs: 5,
  targetEpochLength: TimeIntervals.SECONDS.ONE_DAY,
  targetTokenSupply: 10_000_000n,
  tokenName: 'Tribbles',
};

export const makeTerms = (terms = {}) => ({
  ...defaultCustomTerms,
  ...terms,
});

harden(makeTerms);

const contractName = 'tribblesAirdrop';

/**
 * Core eval script to start contract
 *
 * @param {BootstrapPowers } permittedPowers
 * @param {*} config
 *
 * @typedef {{
 *   brand: PromiseSpaceOf<{ Tribbles: import('@agoric/ertp/src/types.js').Brand }>;
 *   issuer: PromiseSpaceOf<{ Tribbles: import('@agoric/ertp/src/types.js').Issuer }>;
 *   instance: PromiseSpaceOf<{ [contractName]: Instance }>
 * }} AirdropSpace
 */
export const startAirdrop = async (
  {
    consume: { board, chainTimerService, chainStorage, startUpgradable, zoe },
    installation: {
      consume: { [contractName]: airdropInstallationP },
    },
    instance: {
      produce: { [contractName]: produceInstance },
    },
    issuer: {
      consume: { IST: istIssuer },
      produce: { Tribbles: produceTribblesIssuer },
    },
    issuer: {
      produce: { Tribbles: produceTribblesBrand },
    },
  },
  config,
) => {
  trace('######## inside startAirdrop ###########');
  trace('config ::::', config);
  trace('----------------------------------');

  const storageNode = makeStorageNodeChild(chainStorage, contractName);

  const [issuerIST, timer] = await Promise.all([istIssuer, chainTimerService]);

  const { customTerms } = config.options;

  /** @type {CustomContractTerms} */
  const terms = {
    ...customTerms,
  };
  trace('BEFORE assert(config?.options?.merkleRoot');
  assert(
    customTerms?.merkleRoot,
    'can not start contract without merkleRoot???',
  );
  trace('AFTER assert(config?.options?.merkleRoot');

  const marshaller = await E(board).getReadonlyMarshaller();

  const startArgs = {
    installation: airdropInstallationP,
    label: contractName,
    terms,
    issuerKeywordRecord: {
      Fee: issuerIST,
    },
    issuerNames: ['Tribbles'],
    privateArgs: await deeplyFulfilledObject(
      harden({
        timer,
        storageNode,
        marshaller,
      }),
    ),
  };
  trace('BEFORE astartContract(permittedPowers, startArgs);');

  const { instance } = await E(startUpgradable)(startArgs);
  trace('contract installation started');
  trace(instance);
  const instanceTerms = await E(zoe).getTerms(instance);
  trace('instanceTerms::', instanceTerms);
  const {
    brands: { Tribbles: tribblesBrand },
    issuers: { Item: tribblesIssuer },
  } = instanceTerms;

  produceInstance.reset();
  produceInstance.resolve(instance);

  produceTribblesBrand.reset();
  produceTribblesIssuer.reset();
  produceTribblesBrand.resolve(tribblesBrand);
  produceTribblesIssuer.resolve(tribblesIssuer);

  await publishBrandInfo(chainStorage, board, tribblesBrand);
  trace('deploy script complete.');
};

/** @type { import("@agoric/vats/src/core/lib-boot").BootstrapManifest } */
const airdropManifest = {
  [startAirdrop.name]: {
    consume: {
      board: true,
      chainStorage: true,
      chainTimerService: true,
      agoricNames: true,
      brandAuxPublisher: true,
      startUpgradable: true, // to start contract and save adminFacet
      zoe: true, // to get contract terms, including issuer/brand,
    },
    installation: {
      consume: { [contractName]: true },
      produce: { [contractName]: true },
    },
    issuer: { consume: { IST: true }, produce: { Tribbles: true } },
    brand: { consume: { IST: true }, produce: { Tribbles: true } },
    instance: { produce: { [contractName]: true } },
  },
};
harden(airdropManifest);

export const permit = airdropManifest[startAirdrop.name];

export const getManifestForAirdrop = (
  { restoreRef },
  { installKeys, ...options },
) => {
  return harden({
    manifest: airdropManifest,
    installations: {
      [contractName]: restoreRef(installKeys[contractName]),
    },
    options,
  });
};

/** @type {import('@agoric/deploy-script-support/src/externalTypes.js').CoreEvalBuilder} */
export const defaultProposalBuilder = async ({ publishRef, install }) => {
  harden({
    // Somewhat unorthodox, source the exports from this builder module
    getManifestCall: [
      'getManifestForContract',
      {
        installKeys: {
          [contractName]: publishRef(install('./airdrop.contract.js')),
        },
      },
    ],
  });
};
export default async (homeP, endowments) => {
  // import dynamically so the module can work in CoreEval environment
  //  const dspModule = await import('@agoric/deploy-script-support');
  const { writeCoreEval } = await makeHelpers(homeP, endowments);
  await writeCoreEval(startAirdrop.name, defaultProposalBuilder);
};
