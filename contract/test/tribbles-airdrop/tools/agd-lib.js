// @ts-check
import assert from 'node:assert';
import { spawn } from 'node:child_process';

const { freeze } = Object;

const agdBinary = 'agd';

/**
 * @param {string[]} args
 * @param {*} [opts]
 */
const runSpawn = (
  args,
  opts = {
    stdio: ['ignore', 'pipe', 'inherit'], // (A)
    encoding: 'utf-8', // (B)
    shell: true,
  },
) => {
  const inputArgs = [...args];
  console.log({ inputArgs });

  return spawn('agd', ['--node https://xnet.rpc.agoric.net:443 ', ...args], {
    ...opts,
    shell: true,
  });
};
/**
 * @param {Record<string, string | undefined>} record - e.g. { color: 'blue' }
 * @returns {string[]} - e.g. ['--color', 'blue']
 */
export const flags = record => {
  // TODO? support --yes with boolean?

  /** @type {[string, string][]} */
  // @ts-expect-error undefined is filtered out
  const skipUndef = Object.entries(record).filter(([_k, v]) => v !== undefined);
  return skipUndef.map(([k, v]) => [`--${k}`, v]).flat();
};

/**
 * @callback ExecSync
 * @param {string} file
 * @param {string[]} args
 * @param {{ encoding: 'utf-8' } & { [k: string]: unknown }} opts
 * @returns {string}
 */

/**
 * @param {{ execFileSync: ExecSync }} io
 */
export const makeAgd = ({ execFileSync }) => {
  /**
   * @param { {
   *       home?: string;
   *       keyringBackend?: string;
   *       rpcAddrs?: string[];
   *     }} opts
   */
  const make = ({ home, keyringBackend, rpcAddrs } = {}) => {
    const keyringArgs = flags({ home, 'chain-id': 'agoricxnet-14' });
    if (rpcAddrs) {
      assert.equal(
        rpcAddrs.length,
        1,
        'XXX rpcAddrs must contain only one entry',
      );
    }
    const nodeArgs = flags({ node: 'https://xnet.rpc.agoric.net:443' });

    /**
     * @param {string[]} args
     * @param {*} [opts]
     */
    const exec = (args, opts = { encoding: 'utf-8' }) =>
      execFileSync(agdBinary, args, opts);

    const outJson = flags({ output: 'json' });

    const ro = freeze({
      status: async () => JSON.parse(exec([...nodeArgs, 'status'])),
      /**
       * @param {| [kind: 'gov', domain: string, ...rest: any]
       *         | [kind: 'tx', txhash: string]
       *         | [mod: 'vstorage', kind: 'data' | 'children', path: string]
       * } qArgs
       */
      query: async qArgs => {
        const out = exec(['query', ...qArgs, ...nodeArgs, ...outJson], {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        try {
          return JSON.parse(out);
        } catch (e) {
          console.error(e);
          console.info('output:', out);
        }
      },
    });
    const nameHub = freeze({
      /**
       * NOTE: synchronous I/O
       *
       * @param {string[]} path
       */
      lookup: (...path) => {
        if (!Array.isArray(path)) {
          // TODO: use COND || Fail``
          throw TypeError();
        }
        if (path.length !== 1) {
          throw Error(`path length limited to 1: ${path.length}`);
        }
        const [name] = path;
        const txt = exec(['keys', 'show', `--address`, name, ...keyringArgs]);
        return txt.trim();
      },
    });
    const rw = freeze({
      /**
       * TODO: gas
       * @param {string[]} txArgs
       * @param {{ chainId: string; from: string; yes?: boolean }} opts
       */
      tx: async (txArgs, { chainId = 'agoricxnet-14', from, yes }) => {
        console.log('inside tx', { txArgs, chainId, from });
        const args = [
          'tx',
          ...txArgs,
          ...flags({ node: 'https://xnet.rpc.agoric.net:443' }),
          ...flags({ 'chain-id': chainId, from }),
          ...flags({
            'broadcast-mode': 'block',
            gas: 'auto',
            'gas-adjustment': '1.4',
          }),
          ...(yes ? ['--yes'] : []),
        ];
        console.log('$$$', agdBinary, ...args);
        const out = exec(args);
        try {
          const detail = out;
          if (detail.code !== 0) {
            throw Error(detail.raw_log);
          }
          return detail;
        } catch (e) {
          console.error(e);
          console.info('output:', out);
        }
      },
      ...ro,
      ...nameHub,
      readOnly: () => ro,
      nameHub: () => nameHub,
      keys: {
        /**
         * @param {string} name
         * @param {string} mnemonic
         */
        add: (name, mnemonic) => {
          return execFileSync(
            agdBinary,
            [...keyringArgs, 'keys', 'add', name, '--recover'],
            { encoding: 'utf-8', input: mnemonic },
          ).toString();
        },
        /** @param {string} name */
        delete: name => {
          return exec([agdBinary, ...keyringArgs, 'keys', 'delete', name]);
        },
      },
      /**
       * @param {Record<string, unknown>} opts
       */
      withOpts: opts => make({ home, keyringBackend, rpcAddrs, ...opts }),
    });
    return rw;
  };
  return make();
};

/** @typedef {ReturnType<makeAgd>} Agd */
