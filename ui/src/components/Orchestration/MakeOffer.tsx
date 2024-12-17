import { AgoricWalletConnection } from '@agoric/react-components';
import { DynamicToastChild } from '../Tabs';
import { useContractStore } from '../../store/contract';
import {
  pubkeys,
  agoricGenesisAccounts,
  getProof,
  merkleTreeAPI,
} from '../../airdrop-data/genesis.keys.js';
import { getInclusionProof } from '../../airdrop-data/agdkeys.js';
const generateInt = x => () => Math.floor(Math.random() * (x + 1));

const createTestTier = generateInt(4); // ?
const currentAccount = ({ address }) =>
  agoricGenesisAccounts.filter(x => x.address === address);

const makeMakeOfferArgs =
  (keys = []) =>
  ({ pubkey: { key = '' }, address = 'agoric12d3fault' }) => ({
    key,
    proof: merkleTreeAPI.generateMerkleProof(key, keys),
    address,
    tier: createTestTier(),
  });

const makeOfferArgs = makeMakeOfferArgs(pubkeys);

export const makeOffer = async (
  wallet: AgoricWalletConnection,
  addNotification: (arg0: DynamicToastChild) => void,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  handleToggle: () => void,
  setStatusText: React.Dispatch<React.SetStateAction<string>>,
) => {
  const { instances, brands } = useContractStore.getState();
  const instance = instances?.['tribblesAirdrop'];

  if (!instance || !brands) {
    setLoading(false);
    handleToggle();
    throw Error('No contract instance or brands found.');
  }
  const proof = [
    {
      hash: '149c44ac60f5c1da0029e1a4cb0a9c7a6a92ef49046a55d948992f46ba8c017f',
      direction: 'right',
    },
    {
      hash: '71d8de5c3dfbe37a00a512058cfb3a2d5ad17fca96156ec26bba7233cddb54f1',
      direction: 'left',
    },
    {
      hash: '1d572b148312772778d7c118bdc17770352d10c271b6c069f84b9796ff3ce514',
      direction: 'left',
    },
    {
      hash: 'aa9d927f3ecc8b316270a2901cc6a062fd47e863d8667af33ddd83d491b63e03',
      direction: 'right',
    },
    {
      hash: '6339fcd7509730b081b2e11eb382d88fe0c583eaec9a4d924e13e38553e9a5fa',
      direction: 'left',
    },
  ];
  // fetch the BLD brand
  const istBrand = brands.IST;
  if (!istBrand) {
    setLoading(false);
    handleToggle();
    throw Error('BLD brand not found.');
  }

  const want = {};
  const give = { Fee: { brand: istBrand, value: 5n } };

  const offerId = Date.now();

  /**
   *   invitationSpec: {
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


   */

  const offerArgsValue = makeOfferArgs({
    address: wallet.address,
    tier: createTestTier(),
    ...getProof(wallet.address),
  });

  const STRING_CONSTANTS = {
    OFFER_TYPES: {
      AGORIC_CONTRACT: 'agoricContract',
    },
    OFFER_NAME: 'makeClaimTokensInvitation',
    INSTANCE: {
      PATH: 'tribblesAirdrop',
    },
    ISSUERS: {
      TRIBBLES: 'Tribbles',
      IST: 'IST',
      BLD: 'BLD',
    },
  };

  console.log({ offerArgsValue }, proof === offerArgsValue.proof, {
    current: currentAccount(wallet),
  });

  await wallet?.makeOffer(
    {
      source: STRING_CONSTANTS.OFFER_TYPES.AGORIC_CONTRACT,
      instancePath: [STRING_CONSTANTS.INSTANCE.PATH],
      callPipe: [[STRING_CONSTANTS.OFFER_NAME]],
    },
    { give },
    { ...offerArgsValue },
    (update: { status: string; data?: unknown }) => {
      if (update.status === 'error') {
        addNotification({
          text: `Offer update error: ${update.data}`,
          status: 'error',
        });
        setStatusText('Error during offer submission.');
        setLoading(false);
        handleToggle();
        console.log(update);
      }
      if (update.status === 'accepted') {
        addNotification({
          text: 'Offer accepted successfully',
          status: 'success',
        });
        setStatusText('Offer accepted. Processing...');
        handleToggle();
        setLoading(false);
      }
      if (update.status === 'refunded') {
        addNotification({
          text: 'Offer was refunded',
          status: 'error',
        });
        setStatusText('Offer refunded.');
        setLoading(false);
        handleToggle();
        console.log(update);
      }
      if (update.status === 'done') {
        setStatusText('Operation completed successfully.');
        setLoading(false);
        setTimeout(() => {
          handleToggle();
        }, 1000);
      }
    },
    offerId,
  );
};
