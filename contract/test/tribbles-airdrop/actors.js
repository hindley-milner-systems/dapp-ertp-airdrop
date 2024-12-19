import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';
import { accounts } from '../data/agd-keys.js';
import { merkleTreeObj } from './generated_keys.js';
import { Observable } from '../../src/helpers/adts.js';
import { createStore } from '../../src/tribbles/utils.js';

const generateInt = x => () => Math.floor(Math.random() * (x + 1));

const createTestTier = generateInt(4); // ?
const publicKeys = accounts.map(x => x.pubkey.key);

export const makeOfferArgs = ({
  pubkey = {
    key: '',
  },
  address = 'agoric12d3fault',
  tier = createTestTier(),
}) => ({
  key: pubkey.key,
  proof: merkleTreeObj.constructProof(pubkey),
  address,
  tier,
});

/**
 * Eligible claimant exercises their right to claim tokens.
 *
 * @param {import('ava').ExecutionContext} t
 * @param {ZoeService} zoe
 * @param {import('@agoric/zoe/src/zoeService/utils').StartContractInstance<Installation>} instance
 * @param {import('@agoric/ertp/src/types').Purse} feePurse
 * @param {{pubkey: {key: string, type: string}, address: string, tier?: number, name?: string, type?:string}} accountObject
 * @param {boolean} shouldThrow boolean flag indicating whether or not the contract is expected to throw an error.
 * @param {string} errorMessage Error message produced by contract resulting from some error arising during the claiming process.
 *
 */
const simulateClaim = async (
  t,
  zoe,
  instance,
  feePurse,
  accountObject,
  shouldThrow = false,
  errorMessage = '',
) => {
  const [pfFromZoe, terms] = await Promise.all([
    E(zoe).getPublicFacet(instance),
    E(zoe).getTerms(instance),
  ]);

  const { brands, issuers } = terms;

  const claimOfferArgs = makeOfferArgs(accountObject);

  console.log('TERMS:::', { terms, claimOfferArgs });

  const proposal = {
    give: { Fee: AmountMath.make(brands.Fee, 5n) },
  };
  t.log('Alice gives', proposal.give);

  const feePayment = await E(feePurse).withdraw(
    AmountMath.make(brands.Fee, 5n),
  );
  const [invitation, payoutValues] = await Promise.all([
    E(pfFromZoe).makeClaimTokensInvitation(),
    E(pfFromZoe).getPayoutValues(),
  ]);

  if (!shouldThrow) {
    const seat = await E(zoe).offer(
      invitation,
      proposal,
      { Fee: feePayment },
      harden(claimOfferArgs),
    );
    const airdropPayout = await E(seat).getPayout('Tokens');

    const actual = await E(issuers.Tribbles).getAmountOf(airdropPayout);
    t.log('Alice payout brand', actual.brand);
    t.log('Alice payout value', actual.value);
    t.deepEqual(actual, payoutValues[claimOfferArgs.tier]);
  } else {
    const badSeat = E(zoe).offer(
      invitation,
      proposal,
      { Fee: feePayment },
      harden(claimOfferArgs),
    );
    await t.throwsAsync(E(badSeat).getOfferResult(), {
      message: errorMessage,
    });
  }
};

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

export { makeAsyncObserverObject, simulateClaim };
