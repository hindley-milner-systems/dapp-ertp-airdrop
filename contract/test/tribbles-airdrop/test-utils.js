import { E } from '@endo/far';
import { merkleTreeObj } from './generated_keys.js';
import { Fn, Observable } from '../../src/helpers/adts.js';
import { createStore } from '../../src/tribbles/utils.js';
import {
  messagesObject,
  PAUSED,
  PREPARED,
} from '../../src/airdrop.contract.js';

const generateInt = x => () => Math.floor(Math.random() * (x + 1));

const createTestTier = generateInt(4); // ?

const makeClaimOfferArgs = account =>
  Fn(({ merkleTreeAPI }) => ({
    key: account.pubkey.key,
    tier: account.tier,
    proof: merkleTreeAPI.constructProof(account.pubkey),
  }));

const makePauseOfferSpec = (instance, offerId = 'default-offer-id') => ({
  offerId,
  invitationSpec: {
    source: 'purse',
    instance,
    description: 'pause contract',
  },
  proposal: {},
});

const makeMakeOfferSpec = instance => (account, feeAmount, id) => ({
  id: `offer-${id}`,
  invitationSpec: {
    source: 'contract',
    instance,
    publicInvitationMaker: 'makeClaimTokensInvitation',
  },
  proposal: { give: { Fee: feeAmount } },
  offerArgs: {
    key: account.pubkey.key,
    proof: merkleTreeObj.constructProof(account.pubkey),
    tier: account.tier,
  },
});

const makeAccountWithWallet = ({ name, address, pubkey, tier }) => ({
  address,
  pubkey,
  name,
  tier,
  proof: merkleTreeObj.constructProof(pubkey),
});

const testAccounts = merkleTreeObj.accounts
  .slice(0, 5)
  .map(makeAccountWithWallet);

const makeTestWallets = async (makeWalletFn, accounts = testAccounts) =>
  accounts.reduceRight(async (accPromise, account) => {
    const acc = await accPromise;
    return {
      ...acc,
      [account.name]: {
        ...account,
        wallet: await makeWalletFn(account.address),
      },
    };
  }, Promise.resolve({}));

/**
 * @param {import('../../src/types.js').AccountDetails} account
 */
const handleConstructClaimOffer = account =>
  makeClaimOfferArgs(account).chain(offerArgs =>
    Fn(({ makeFeeAmount, instance, invitationMaker }) => ({
      id: `offer-${account.address}`,
      invitationSpec: {
        source: 'contract',
        instance,
        publicInvitationMaker: invitationMaker,
      },
      proposal: { give: { Fee: makeFeeAmount() } },
      offerArgs,
    })),
  );

const makeOfferArgs = ({
  pubkey = {
    key: '',
  },
  tier = createTestTier(),
}) => ({
  key: pubkey.key,
  proof: merkleTreeObj.constructProof(pubkey),
  tier,
});

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

const AIRDROP_AMOUNT_VALUES = [9000n, 6500n, 3500n, 1500n, 750n].map(
  x => x * 1_000_000n,
);

const makeMakeContractPauseOfferSpecs = instance => ({
  pauseContract: (id = 'pause-prepared-contract-0') => ({
    id,
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
  }),
  unpauseContract: (id = 'remove-pause-0', nextState = PREPARED) => ({
    id,
    invitationSpec: {
      source: 'purse',
      instance,
      description: 'set offer filter',
    },
    proposal: {},
    offerArgs: {
      nextState,
      filter: [],
    },
  }),
});

export {
  AIRDROP_AMOUNT_VALUES,
  createTestTier,
  makeAsyncObserverObject,
  handleConstructClaimOffer,
  makeAccountWithWallet,
  makeOfferArgs,
  makeClaimOfferArgs,
  makeMakeContractPauseOfferSpecs,
  makeMakeOfferSpec,
  makePauseOfferSpec,
  makeTestWallets,
  traceFn,
};
