/** @file run a builder and deploy it onto the Agoric chain in local Starship cluster */
import { createRequire } from 'module';
import readJSONFn from 'fs-extra';
import { execa as execaFn } from 'execa';
import { AgdTools } from './agd-tools.js';

const nodeRequire = createRequire(import.meta.url);

export const makeDeployBuilder = (
  tools = AgdTools,
  readJSON = readJSONFn,
  execa = execaFn,
) =>
  async function deployBuilder(builder = '') {
    console.log(`building plan: ${builder}`);
    // build the plan
    const { stdout } = await execa`agoric run ${builder}`;
    const match = stdout.match(/ (?<name>[-\w]+)-permit.json/);
    if (!(match && match.groups)) {
      throw Error('no permit found');
    }
    const plan = await readJSON(`./${match.groups.name}-plan.json`);
    console.log(plan);

    console.log('copying files to container');
    tools.copyFiles([
      nodeRequire.resolve(`../${plan.script}`),
      nodeRequire.resolve(`../${plan.permit}`),
      ...plan.bundles.map(b => b.fileName),
    ]);

    console.log('installing bundles');
    await tools.installBundles(
      plan.bundles.map(b => `/tmp/contracts/${b.bundleID}.json`),
      console.log,
    );

    console.log('executing proposal');
    await tools.runCoreEval({
      name: plan.name,
      description: `${plan.name} proposal`,
    });
  };
