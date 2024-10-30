import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

const compose =
  (...fns) =>
  initialValue =>
    fns.reduceRight((acc, val) => val(acc), initialValue);
// function sha256(data: Uint8Array): Uint8Array;
const agoricGenesisAccounts = [
  {
    name: 'faucet',
    type: 'local',
    address: 'agoric1hm54wrxsv8e3pnw6lxj5lssfpexn48xtj6fhxw',
    pubkey: {
      type: '/cosmos.crypto.secp256k1.PubKey',
      key: 'ApbVlMcmEODtsa0hKbQDdfP6yDCVDtNsHfa0eJDYUlMm',
    },
  },
  {
    name: 'genesis',
    type: 'local',
    address: 'agoric19rplwp8y7kclys6rc5mc6pc9t393m9swzmdjtx',
    pubkey: {
      type: '/cosmos.crypto.secp256k1.PubKey',
      key: 'AypaDjnPmDIfxBX2Tt6UQjeQq0ndaG5rQDbD4GLmwUQ5',
    },
  },
  {
    name: 'relayer-cli-1',
    type: 'local',
    address: 'agoric1r4gpq0tyg8jdm9mleq47f7k569yhyfnrx3p6da',
    pubkey: {
      type: '/cosmos.crypto.secp256k1.PubKey',
      key: 'AiVRzInOYZGPadFqE1fmybdO+lxt728mOODUT+iCUIpW',
    },
  },
  {
    name: 'relayer-cli-2',
    type: 'local',
    address: 'agoric14edd8dcj4gm0rjzkfeuxyxmjtewfz8cwu6hc99',
    pubkey: {
      type: '/cosmos.crypto.secp256k1.PubKey',
      key: 'Ay1a99eE/NDlBCfltOBZJf5FEjJd7od3XRPykbdHOFj6',
    },
  },
  {
    name: 'relayer-cli-3',
    type: 'local',
    address: 'agoric177ttev07yagvyr4jmy94wnwma5nm2ctvj076g5',
    pubkey: {
      type: '/cosmos.crypto.secp256k1.PubKey',
      key: 'Ah1d0p817qdFQizepUhcj5wkhdDl8BkBoEpg0aFDy+dz',
    },
  },
  {
    name: 'relayer-cli-4',
    type: 'local',
    address: 'agoric1znrgxra5f9evjyuk5tkwttgdeakevp2ahlm3nv',
    pubkey: {
      type: '/cosmos.crypto.secp256k1.PubKey',
      key: 'A8Gv8NXPOTgFWpTv2MSX76Xl9sZE+65bvRceRZbphpQv',
    },
  },
  {
    name: 'relayer1',
    type: 'local',
    address: 'agoric13pwxrtsdusljz8wc4j2wjec009cm0p38zr58hn',
    pubkey: {
      type: '/cosmos.crypto.secp256k1.PubKey',
      key: 'Ap81RxuzlZbd5+3ybmq+8sl3Iv1VXjJZPr1be+biVRg',
    },
  },
  {
    name: 'relayer2',
    type: 'local',
    address: 'agoric1y73xu9wt3xm93wkk3d3ew0xwvhqmyu6gy82t9x',
    pubkey: {
      type: '/cosmos.crypto.secp256k1.PubKey',
      key: 'Ap7zXOumBCVg3Yf2carRdTbXFn2h/UGE2QlJzshomwpe',
    },
  },
  {
    name: 'relayer3',
    type: 'local',
    address: 'agoric1v97d7sgng3nke5fvdsjt5cwhu2tj0l3l3cqh30',
    pubkey: {
      type: '/cosmos.crypto.secp256k1.PubKey',
      key: 'Aj5lolSVU/bw+e3kdMyQclfHpxO8E5kIU8o1XKJ8JjNO',
    },
  },
  {
    name: 'test1',
    type: 'local',
    address: 'agoric1elueec97as0uwavlxpmj75u5w7yq9dgphq4zx',
    pubkey: {
      type: '/cosmos.crypto.secp256k1.PubKey',
      key: 'A4PYpxsDLiygz7aqiBfjl8IpuSqmKHEg3Vf9r2EPXN1A',
    },
  },
  {
    name: 'tg',
    type: 'local',
    address: 'agoric1jng25adrtpl53eh50q7fch34e0vn4g72j6zcml',
    pubkey: {
      type: '/cosmos.crypto.secp256k1.PubKey',
      key: 'Axn3Bies1P2bVzvRc23udrmny6YAXxH1o8NYpf3tDnR5',
    },
  },
];

const makeHash = hashFn => value => hashFn(value);
const convertToHex = bytes => bytesToHex(bytes);

const createSha256Hex = compose(
  // trace('after convertToHex'),
  convertToHex,
  //  trace('after hash'),
  makeHash(sha256),
);

/**
 * @typedef {object} Node
 * @property {string} hash
 * @property {string} direction
 */

const LEFT = 'left';
const RIGHT = 'right';

/**
 * Finds the index of the hash in the leaf hash list of the Merkle tree and
 * verifies if it's a left or right child by checking if its index is even or
 * odd. If the index is even, then it's a left child, if it's odd, then it's a
 * right child.
 *
 * @param {string} hash
 * @param {string[][]} merkleTree
 * @returns {string} direction
 */
const getLeafNodeDirectionInMerkleTree = (hash, merkleTree) => {
  const hashIndex = merkleTree[0].findIndex(h => h === hash);
  return hashIndex % 2 === 0 ? LEFT : RIGHT;
};

const isEven = x => x % 2 === 0;
const checkEvenLength = array => isEven(array.length);

const id = x => x;

const handleTrueOrFalse = (predicate, leftFn, rightFn) => value =>
  !predicate(value) ? rightFn(value) : leftFn(value);

const duplicateLastItemInArray = array => array.concat(array[array.length - 1]);
const handleCheckEven = handleTrueOrFalse(
  checkEvenLength,
  id,
  duplicateLastItemInArray,
);
/**
 * If the hashes length is not even, then it copies the last hashes and adds it
 * to the end of the array, so it can be hashed with itself.
 *
 * @param {PubkeyHashArray} hashes
 */
const ensureEven = hashes =>
  hashes.length % 2 !== 0 && hashes.push(hashes[hashes.length - 1]);

/**
 * Generates the merkle root of the hashes passed through the parameter.
 * Recursively concatenates pair of hash hashes and calculates each sha256 hash
 * of the concatenated hashes until only one hash is left, which is the merkle
 * root, and returns it.
 *
 * @param {PubkeyHashArray} hashes
 * @returns {string} merkleRoot
 */
/**
 * Generates the merkle root of the hashes passed through the parameter.
 * Recursively concatenates pair of hash hashes and calculates each sha256 hash
 * of the concatenated hashes until only one hash is left, which is the merkle
 * root, and returns it.
 *
 * @param {PubkeyHashArray} hashes
 * @returns {string} merkleRoot
 */
const generateMerkleRootTwo = hashes => {
  if (!hashes || hashes.length === 0) {
    return '';
  }

  // Use handleCheckEven to ensure the hashes array has an even length
  // Use `reduce` to combine hashes
  const combinedHashes = handleCheckEven(hashes).reduce(
    (acc, _, index, arr) => {
      if (index % 2 === 0) {
        const hashPairConcatenated = arr[index] + arr[index + 1];
        const hash = createSha256Hex(hashPairConcatenated);
        acc.push(hash);
      }
      return acc;
    },
    [],
  );

  // If the combinedHashes length is 1, it means that we have the merkle root already
  if (combinedHashes.length === 1) {
    return combinedHashes[0]; // Return the single hash directly
  }

  // Recursively call to process the combined hashes
  return generateMerkleRootTwo(combinedHashes);
};
const generateProof = (tree, leaf) => {
  let index = tree[0].indexOf(leaf);
  return index === -1
    ? null
    : tree.slice(0, -1).map(layer => {
        const isRightNode = index % 2;
        index = Math.floor(index / 2);
        return layer[index + (isRightNode ? -1 : 1)];
      });
};
/**
 * Generates the merkle root of the hashes passed through the parameter.
 * Recursively concatenates pair of hash hashes and calculates each sha256 hash
 * of the concatenated hashes until only one hash is left, which is the merkle
 * root, and returns it.
 *
 * @param {PubkeyHashArray} hashes
 * @returns {string} merkleRoot
 */
const generateMerkleRoot = hashes => {
  if (!hashes || hashes.length === 0) {
    return '';
  }
  if (hashes.length % 2 !== 0) hashes.push(hashes[hashes.length - 1]);

  const combinedHashes = [];
  for (let i = 0; i < hashes.length; i += 2) {
    const hashPairConcatenated = hashes[i] + hashes[i + 1];
    const hash = createSha256Hex(hashPairConcatenated);
    combinedHashes.push(hash);
  }
  // If the combinedHashes length is 1, it means that we have the merkle root already
  // and we can return
  if (combinedHashes.length === 1) {
    return combinedHashes.join('');
  }
  return generateMerkleRoot(combinedHashes);
};

const createHash = fn => (h1, h2) => ({ hash: fn(h2 + h1) });
const createSha256HashObj = createHash(createSha256Hex);

const computeProofReducer = ({ hash: h1 }, { hash: h2, direction }) =>
  direction === RIGHT
    ? createSha256HashObj(h2, h1)
    : createSha256HashObj(h1, h2);

const reducerFn = fn => array => array.reduce(fn);
const getProp = prop => object => object[prop];

const getHash = getProp('hash');

const handleComputeProof = compose(getHash, reducerFn(computeProofReducer));

/**
 * Calculates the merkle root using the merkle proof by concatenating each pair
 * of hash hashes with the correct tree branch direction (left, right) and
 * calculating the sha256 hash of the concatenated pair, until the merkle root
 * hash is generated and returned. The first hash needs to be in the first
 * position of this array, with its corresponding tree branch direction.
 *
 * @param {Node[] | null} merkleProof
 * @returns {string} merkleRoot
 */
const getMerkleRootFromMerkleProof = merkleProof =>
  !merkleProof || merkleProof.length === 0
    ? ''
    : handleComputeProof(merkleProof);

const generate = (hashes, tree = []) => {
  if (hashes.length === 1) {
    return hashes;
  }
  ensureEven(hashes);
  const combinedHashes = [];
  for (let i = 0; i < hashes.length; i += 2) {
    const hashesConcatenated = hashes[i] + hashes[i + 1];
    const hash = createSha256Hex(hashesConcatenated);
    combinedHashes.push(hash);
  }
  tree.push(combinedHashes);
  return generate(combinedHashes, tree);
};
/**
 * Creates a merkle tree, recursively, from the provided hashes, represented
 * with an array of arrays of hashes/nodes. Where each array in the array, or
 * hash list, is a tree level with all the hashes/nodes in that level. In the
 * array at position tree[0] (the first array of hashes) there are all the
 * original hashes. In the array at position tree[1] there are the combined pair
 * or sha256 hashes of the hashes in the position tree[0], and so on. In the
 * last position (tree[tree.length - 1]) there is only one hash, which is the
 * root of the tree, or merkle root.
 *
 * @param {PubkeyHashArray} hashes
 * @returns {string[][]} merkleTree
 */
const generateMerkleTree = (hashes = []) => {
  if (!hashes || hashes.length === 0) {
    return [];
  }
  const tree = [hashes];
  generate(hashes, tree);
  return tree;
};

/**
 * Generates the merkle proof by first creating the merkle tree, and then
 * finding the hash index in the tree and calculating if it's a left or right
 * child (since the hashes are calculated in pairs, hash at index 0 would be a
 * left child, hash at index 1 would be a right child. Even indices are left
 * children, odd indices are right children), then it finds the sibling node
 * (the one needed to concatenate and hash it with the child node) and adds it
 * to the proof, with its direction (left or right) then it calculates the
 * position of the next node in the next level, by dividing the child index by
 * 2, so this new index can be used in the next iteration of the loop, along
 * with the level. If we check the result of this representation of the merkle
 * tree, we notice that The first level has all the hashes, an even number of
 * hashes. All the levels have an even number of hashes, except the last one
 * (since is the merkle root) The next level have half or less hashes than the
 * previous level, which allows us to find the hash associated with the index of
 * a previous hash in the next level in constant time. Then we simply return
 * this merkle proof.
 *
 * @param {string} hash
 * @param {PubkeyHashArray} hashes
 * @returns {null | Node[]} merkleProof
 */
const generateMerkleProof = (hash, hashes) => {
  if (!hash || !hashes || hashes.length === 0) {
    return null;
  }
  const tree = generateMerkleTree(hashes);
  const merkleProof = [
    {
      hash,
      direction: getLeafNodeDirectionInMerkleTree(hash, tree),
    },
  ];
  let hashIndex = tree[0].findIndex(h => h === hash);
  // eslint-disable-next-line no-plusplus
  for (let level = 0; level < tree.length - 1; level++) {
    const isLeftChild = hashIndex % 2 === 0;
    const siblingDirection = isLeftChild ? RIGHT : LEFT;
    const siblingIndex = isLeftChild ? hashIndex + 1 : hashIndex - 1;
    const siblingNode = {
      hash: tree[level][siblingIndex],
      direction: siblingDirection,
    };
    merkleProof.push(siblingNode);
    hashIndex = Math.floor(hashIndex / 2);
  }
  return merkleProof;
};
export const merkleTreeAPI = {
  generateMerkleRoot(pks) {
    return generateMerkleRoot(pks.map(createSha256Hex));
  },
  generateMerkleTree(pks) {
    return generateMerkleTree(pks.map(createSha256Hex));
  },
  generateMerkleProof(pkHash, hashes) {
    return generateMerkleProof(
      createSha256Hex(pkHash),
      hashes.map(createSha256Hex),
    );
  },
  getMerkleRootFromMerkleProof(proof) {
    return getMerkleRootFromMerkleProof(proof);
  },
};

harden(merkleTreeAPI);
export {
  getMerkleRootFromMerkleProof,
  generateMerkleProof,
  generateMerkleTree,
  generateMerkleRoot,
};