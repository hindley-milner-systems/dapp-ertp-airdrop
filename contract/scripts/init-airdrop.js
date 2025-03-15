import { makeHelpers } from '@agoric/deploy-script-support';
import {
  startAirdrop,
  contractName,
  getManifestForAirdrop,
} from '../src/airdrop.proposal.js';

/**
 * @description defaultProposalBuilder is a CoreEvalBuilder script.
 * @type {import('@agoric/deploy-script-support/src/externalTypes.js').CoreEvalBuilder}
 *
 */
export const defaultProposalBuilder = async ({ publishRef, install }) => {
  return harden({
    // indicates the location of this CoreEval script's proposal
    sourceSpec: '../src/airdrop.proposal.js',
    // getManifestCall is a function'
    // including a "manifest" as described below (but the actual invocation will
    // insert as the first argument a "powers" object that includes functions such as
    // `restoreRef`). A common thing to want to pass in `args` is a reference to code
    getManifestCall: [
      getManifestForAirdrop.name,
      {
        installKeys: {
          // s built from sources in agoric-sdk, and passed as a
          // `bundleRef`, which contains a `bundleID` suitable for passing to Zoe (for
          // contracts)
          [contractName]: publishRef(install('../src/airdrop.contract.js')),
        },
      },
    ],
  });
};

export default async (homeP, endowments) => {
  // import dynamically so the module can work in CoreEval environment
  const { writeCoreEval } = await makeHelpers(homeP, endowments);
  await writeCoreEval(startAirdrop.name, defaultProposalBuilder);
};
