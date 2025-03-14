import { AgoricWalletConnection } from '@agoric/react-components';
import { DynamicToastChild } from '../Tabs.js';
import { useContractStore } from '../../store/contract.js';
import {pubkeys, agoricGenesisAccounts, proof1, merkleTreeAPI } from '../../airdrop-data/genesis.keys.js'
const generateInt = x => () => Math.floor(Math.random() * (x + 1));

const createTestTier = generateInt(4); // ?

const makeMakeOfferArgs =
  (keys = []) =>
  ({ pubkey: { key = '' }, address = 'agoric12d3fault' }) => ({
    key,
    proof: merkleTreeAPI.generateMerkleProof(key, keys),
    address,
    tier: createTestTier(),

  });

export const makePauseOffer = async (
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


  const offerId = Date.now();

  await wallet?.makeOffer(
    {
      source: 'purse',
      instance,
      description: 'pause contract',

     // callPipe: [['makeClaimTokensInvitation']],
    },
    { },
    {},
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
