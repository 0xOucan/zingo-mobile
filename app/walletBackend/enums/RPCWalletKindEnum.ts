export enum RPCWalletKindEnum {
  LoadedFromSeedPhrase = 'Loaded from seed or mnemonic phrase',
  LoadedFromUnifiedSpendingKey = 'Loaded from unified spending key',
  LoadedFromUnifiedFullViewingKey = 'Loaded from unified full viewing key',
  LoadedFromUnifiedFullViewingKeyWithSigner = 'Loaded from unified full viewing key with external signer derivation',
  NoKeysFound = 'No keys found',

  // obsolete
  //Seeded = 'Seeded',
  //LoadedFromKey = 'Loaded from key',
}
