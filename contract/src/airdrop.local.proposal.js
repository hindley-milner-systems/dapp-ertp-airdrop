// @ts-check
import { E } from '@endo/far';
import { Fail } from '@endo/errors';
import { makeMarshal } from '@endo/marshal';
import { makeTracer } from '@agoric/internal';
import { installContract } from './platform-goals/start-contract.js';
import { fixHub } from './fixHub.js';
import './types.js';

const contractName = 'tribblesAirdrop';

const trace = makeTracer('startAirdrop script');
/** @import { StartArgs } from './platform-goals/start-contract.js'; */
const AIRDROP_TIERS_STATIC = [9000n, 6500n, 3500n, 1500n, 750n].map(
  x => x * 1_000_000n,
);

/**
 * @typedef {{
 *   startTime: bigint;
 *   initialPayoutValues: any;
 *   targetNumberOfEpochs: bigint;
 *   targetEpochLength: bigint;
 *   targetTokenSupply: bigint;
 *   tokenName: string;
 * }} CustomContractTerms
 */

export const defaultCustomTerms = {
  startTime: 0n,
  initialPayoutValues: harden(AIRDROP_TIERS_STATIC),
  targetNumberOfEpochs: 5n,
  targetEpochLength: 12_000n / 2n,
  targetTokenSupply: 10_000_000n * 1_000_000n,
  tokenName: 'Tribbles',
};

export const makeTerms = (terms = {}) => ({
  ...defaultCustomTerms,
  ...terms,
});
harden(makeTerms);

// vstorage paths under published.*
const BOARD_AUX = 'boardAux';

const marshalData = makeMarshal(_val => Fail`data only`);

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
  trace('publishing info for brand', brand);
  const [id, displayInfo] = await Promise.all([
    E(board).getId(brand),
    E(brand).getDisplayInfo(),
  ]);
  trace('E(board).getId(brand)', id);
  const node = makeBoardAuxNode(chainStorage, id);
  trace('boardAuxNode ####', node);
  const aux = marshalData.toCapData(harden({ displayInfo }));

  const stringifiedAux = JSON.stringify(aux);
  trace('JSON.stringify(aux)', stringifiedAux);
  await E(node).setValue(stringifiedAux);
};

// const prepareForExecutionEnv = ()
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

/**
 * Core eval script to start contract
 *
 * @param {BootstrapPowers & AirdropSpace} powers
 * @param {{
 *   options: { tribblesAirdrop: { bundleID: string }; customTerms: any };
 * }} config
 *   XXX export AirdropTerms record from contract
 */
export const startAirdrop = async (powers, config) => {
  trace('######## inside startAirdrop ###########');
  trace('config ::::', config);
  trace('----------------------------------');
  trace('powers::', powers);
  trace('powers.installation', powers.installation.consume);
  trace('powers.installation', powers.installation.consume[contractName]);
  const {
    consume: {
      namesByAddressAdmin: namesByAddressAdminP,
      //  namesByAddress,
      //  bankManager,
      board,
      chainTimerService,
      chainStorage,
      //  startUpgradable,
      zoe,
    },
    instance: {
      produce: { [contractName]: produceInstance },
    },
    issuer: {
      consume: { IST: istIssuer },
      produce: { Tribbles: produceTribblesIssuer },
    },
    brand: {
      consume: { IST: istBrand },
      produce: { Tribbles: produceTribblesBrand },
    },
  } = powers;

  const [issuerIST, feeBrand, timer, namesByAddressAdmin] = await Promise.all([
    istIssuer,
    istBrand,
    chainTimerService,
    namesByAddressAdminP,
  ]);

  const { customTerms } = config.options;

  /** @type {CustomContractTerms} */
  const terms = {
    ...customTerms,
    feeAmount: harden({
      brand: feeBrand,
      value: 5n,
    }),
  };
  assert(
    customTerms?.merkleRoot,
    'can not start contract without merkleRoot???',
  );
  const namesByAddress = await fixHub(namesByAddressAdmin);

  const installation = await installContract(powers, {
    name: contractName,
    bundleID: config.options.tribblesAirdrop.bundleID,
  });
  const startOpts = {
    installation,
    label: contractName,
    name: contractName,
    terms,
    issuerKeywordRecord: {
      Fee: issuerIST,
    },
    issuerNames: ['Tribbles'],
    privateArgs: harden({
      timer,
      namesByAddress,
    }),
  };
  trace('BEFORE astartContract(permittedPowers, startOpts);', { startOpts });

  const { instance, creatorFacet } = await E(zoe).startInstance(
    installation,
    startOpts.issuerKeywordRecord,
    startOpts.terms,
    startOpts.privateArgs,
    startOpts.label,
  );
  // const { instance, creatorFacet } = await E(zoe).startInstance(
  //   bundle,
  //   startOpts.issuerKeywordRecord,
  //   startOpts.terms,
  //   startOpts.privateArgs,
  //   startOpts.label,
  // );
  trace('contract installation started');
  trace(instance);
  const instanceTerms = await E(zoe).getTerms(instance);
  trace('instanceTerms::', instanceTerms);
  const {
    brands: { Tribbles: tribblesBrand },
    issuers: { Tribbles: tribblesIssuer },
  } = instanceTerms;

  produceInstance.reset();
  produceInstance.resolve(instance);

  produceTribblesBrand.reset();
  produceTribblesIssuer.reset();
  produceTribblesBrand.resolve(tribblesBrand);
  produceTribblesIssuer.resolve(tribblesIssuer);

  // Sending invitation for pausing contract to a specific wallet
  // TODO: add correct wallet address
  const adminWallet = 'agoric1jng25adrtpl53eh50q7fch34e0vn4g72j6zcml';
  await E(namesByAddressAdmin).reserve(adminWallet);
  const adminDepositFacet = E(namesByAddress).lookup(
    adminWallet,
    'depositFacet',
  );

  await E(creatorFacet).makeSetOfferFilterInvitation(adminDepositFacet);

  // prepareForExecutionEnv(creatorFacet, tribblesBrand, tribblesIssuer, tribblesMint, chainStorage, board)
  // Add utribbles token to vbank
  // const tribblesMint = await E(creatorFacet).getBankAssetMint();

  // await E(bankManager).addAsset(
  //   'utribbles',
  //   'Tribbles',
  //   'Tribbles Intersubjective Token',
  //   harden({
  //     issuer: tribblesIssuer,
  //     brand: tribblesBrand,
  //     mint: tribblesMint,
  //   }),
  // );
  await publishBrandInfo(chainStorage, board, tribblesBrand);
  trace('deploy script complete.');
};

/** @type {import('@agoric/vats/src/core/lib-boot').BootstrapManifest} */
const airdropManifest = harden({
  [startAirdrop.name]: {
    consume: {
      namesByAddress: true,
      namesByAddressAdmin: true,
      bankManager: true,
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
    issuer: {
      consume: { IST: true, Tribbles: true },
      produce: { Tribbles: true },
    },
    brand: {
      consume: { IST: true, Tribbles: true },
      produce: { Tribbles: true },
    },
    instance: { produce: { [contractName]: true } },
  },
});

export const permit = Object.values(airdropManifest)[0];

export const main = (
  permittedPowers,

  config = {
    options: Fail`missing options config`,
  },
) => {
  startAirdrop(permittedPowers, config);
};

export const getManifestForAirdrop = ({ restoreRef }, { airdropRef }) => {
  return harden({
    manifest: airdropManifest,
    installations: {
      airdrop: restoreRef(airdropRef),
    },
  });
};
