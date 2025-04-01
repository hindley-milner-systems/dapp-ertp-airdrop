// @ts-check
import { E } from '@endo/far';
import { makeMarshal } from '@endo/marshal';
import { Fail } from '@endo/errors';
import { makeTracer, deeplyFulfilledObject } from '@agoric/internal';
import { fixHub } from './fixHub.js';

const DECIMAL_PLACES = 1_000_000n;

const multiply = x => y => x * y;

const toDenomValue = multiply(DECIMAL_PLACES);
const AIRDROP_TIERS_STATIC = [9000n, 6500n, 3500n, 1500n, 750n].map(
  toDenomValue,
);

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
const trace = makeTracer(':::: START-TRIBBLES-AIRDROP.JS ::::');

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

const contractName = 'tribblesAirdrop';

/**
 * Core eval script to start contract q
 *
 * @param {BootstrapPowers} powers
 * @param {any} config
 *
 * @typedef {{
 *   brand: PromiseSpaceOf<{
 *     Tribbles: import('@agoric/ertp/src/types.js').Brand;
 *   }>;
 *   issuer: PromiseSpaceOf<{
 *     Tribbles: import('@agoric/ertp/src/types.js').Issuer;
 *   }>;
 *   instance: { produce: { tribblesAirdrop: Instance } };
 *   installation: { consume: { tribblesAirdrop: Installation } };
 * }} AirdropSpace
 */

const defaultConfig = {
  options: {
    [contractName]: { bundleID: '' },
    customTerms: defaultCustomTerms,
  },
};
/**
 * Core eval script to start contract
 *
 * @param {BootstrapPowers & AirdropSpace} powers
 * @param {{
 *   options: { tribblesAirdrop: { bundleID: string }; customTerms: any };
 * }} config
 *   XXX export AirdropTerms record from contract
 */

export const startAirdrop = async (powers, config = defaultConfig) => {
  trace('######## inside startAirdrop ###########');
  trace('config ::::', config);
  trace('----------------------------------');
  trace('powers::', powers);
  trace('powers.installation', powers.installation.consume);
  trace('powers.installation', powers.installation.consume[contractName]);
  const {
    consume: {
      namesByAddressAdmin: namesByAddressAdminP,
      bankManager,
      board,
      chainTimerService,
      chainStorage,
      startUpgradable,
      zoe,
    },
    installation: {
      consume: { [contractName]: airdropInstallationP },
    },
    instance: {
      produce: { [contractName]: produceInstance },
    },
    issuer: {
      consume: { BLD: bldIssuer },
      produce: { Tribbles: produceTribblesIssuer },
    },
    brand: {
      consume: { BLD: bldBrand },
      produce: { Tribbles: produceTribblesBrand },
    },
  } = powers;

  const [issuerBLD, feeBrand, timer, namesByAddressAdmin] = await Promise.all([
    bldIssuer,
    bldBrand,
    chainTimerService,
    namesByAddressAdminP,
  ]);

  const { customTerms } = config.options;

  /** @type {CustomContractTerms} */
  const terms = {
    ...customTerms,
    feeAmount: harden({
      brand: feeBrand,
      value: toDenomValue(5n),
    }),
  };

  trace('BEFORE assert(config?.options?.merkleRoot');
  assert(
    customTerms?.merkleRoot,
    'can not start contract without merkleRoot???',
  );
  trace('AFTER assert(config?.options?.merkleRoot');
  const namesByAddress = await fixHub(namesByAddressAdmin);

  const startOpts = {
    installation: await airdropInstallationP,
    label: contractName,
    terms,
    issuerKeywordRecord: {
      Fee: issuerBLD,
    },
    issuerNames: ['Tribbles'],
    privateArgs: await deeplyFulfilledObject(
      harden({
        timer,
        namesByAddress,
      }),
    ),
  };

  trace('BEFORE astartContract(permittedPowers, startOpts);', { startOpts });

  const { instance, creatorFacet } = await E(startUpgradable)(startOpts);
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

  // addAsset creating a short lived mint
  // See https://github.com/hindley-milner-systems/dapp-ertp-airdrop/issues/164
  await E(bankManager).addAsset(
    'utribbles',
    'Tribbles',
    'Tribbles Intersubjective Token',
    harden({
      issuer: tribblesIssuer,
      brand: tribblesBrand,
    }),
  );
  await publishBrandInfo(chainStorage, board, tribblesBrand);
  trace('deploy script complete.');
};

/** @type {BootstrapManifest} */
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
      consume: { BLD: true, Tribbles: true },
      produce: { Tribbles: true },
    },
    brand: {
      consume: { BLD: true, Tribbles: true },
      produce: { Tribbles: true },
    },
    instance: { produce: { [contractName]: true } },
  },
});

export const getManifestForAirdrop = (
  { restoreRef },
  {
    installKeys,
    options = {
      customTerms: {
        ...defaultCustomTerms,
        merkleRoot:
          '0f7e7eeb1c6e5dec518ec2534a4fc55738af04b5379a052c5e3fe836f451ccd0',
      },
    },
  },
) => {
  trace('getManifestForAirdrop');
  trace('installKeys', installKeys);
  trace('options ::::', options);
  return harden({
    manifest: airdropManifest,
    installations: {
      tribblesAirdrop: restoreRef(installKeys.tribblesAirdrop),
    },
    options,
  });
};

export const permit = Object.values(airdropManifest)[0];

/** @type {import('@agoric/deploy-script-support/src/externalTypes.js').CoreEvalBuilder} */
export const defaultProposalBuilder = async ({ publishRef, install }) => {
  return harden({
    // Somewhat unorthodox, source the exports from this builder module
    sourceSpec:
      '/workspaces/dapp-ertp-airdrop/contract/src/airdrop.proposal.js',
    getManifestCall: [
      'getManifestForAirdrop',
      {
        installKeys: {
          tribblesAirdrop: publishRef(
            install(
              '/workspaces/dapp-ertp-airdrop/contract/src/airdrop.contract.js',
            ),
          ),
        },
      },
    ],
  });
};

export default async (homeP, endowments) => {
  // import dynamically so the module can work in CoreEval environment
  const dspModule = await import('@agoric/deploy-script-support');
  const { makeHelpers } = dspModule;
  const { writeCoreEval } = await makeHelpers(homeP, endowments);
  await writeCoreEval(startAirdrop.name, defaultProposalBuilder);
};
