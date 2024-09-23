export const demo = async keplr => {
  console.log({ keplr });

  // https://docs.keplr.app/api/#how-to-detect-keplr
  const chainId = 'agoric';
  await keplr.enable(chainId);

  const offlineSigner = keplr.getOfflineSigner(chainId);

  // You can get the address/public keys by `getAccounts` method.
  // It can return the array of address/public key.
  // But, currently, Keplr extension manages only one address/public key pair.
  // XXX: This line is needed to set the sender address for SigningCosmosClient.
  const accounts = await offlineSigner.getAccounts();
  console.log({ accounts });

  // https://docs.keplr.app/api/#request-signature-for-arbitrary-message
  const signer = accounts[0].address;
  const data = 'I am eligible';
  const sig = await keplr.signArbitrary(chainId, signer, data);

  console.log({ sig });
};
