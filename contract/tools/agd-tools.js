/* global fetch, setTimeout */
import { unsafeMakeBundleCache } from '@agoric/swingset-vat/tools/bundleTool.js';
import * as ambientFsp from 'node:fs/promises';
import { makeE2ETools } from './e2e-tools.js';

const { writeFile } = ambientFsp;

export const makeAgdTools = async (log, { execFile, execFileSync }) => {
  const bundleCache = await unsafeMakeBundleCache('bundles');
  const tools = await makeE2ETools(log, bundleCache, {
    execFileSync,
    execFile,
    writeFile,
    fetch,
    setTimeout,
  });
  return tools;
};
