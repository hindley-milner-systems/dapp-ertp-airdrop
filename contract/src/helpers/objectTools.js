/* eslint-disable no-restricted-syntax */
// @ts-check
// @jessie-check

/** @import { ERef } from '@endo/eventual-send'; */

const compose =
  (...fns) =>
  initialValue =>
    fns.reduceRight((acc, val) => val(acc), initialValue);

const { entries, fromEntries, keys } = Object;

/** @type { <T extends Record<string, ERef<any>>>(obj: T) => Promise<{ [K in keyof T]: Awaited<T[K]>}> } */
const allValues = async obj => {
  // await keyword below leads to "Nested`await`s are not permitted in Jessiees lint jessie.js/no-nested-await"
  // is this "fine" because allValue is used to start contract and is not present in "every day operations".
  const es = await Promise.all(
    // eslint-disable-next-line @jessie.js/no-nested-await, @jessie.js/safe-await-separator
    entries(obj).map(async ([k, v]) => [k, await v]),
  );
  return fromEntries(es);
};

/** @type { <V, U, T extends Record<string, V>>(obj: T, f: (v: V) => U) => { [K in keyof T]: U }} */
const mapValues = (obj, f) =>
  fromEntries(
    entries(obj).map(([p, v]) => {
      const entry = [p, f(v)];
      return entry;
    }),
  );

/** @type {<X, Y>(xs: X[], ys: Y[]) => [X, Y][]} */
const zip = (xs, ys) => xs.map((x, i) => [x, ys[i]]);

// What is <T> ?
// head :: [x, ...xs] => x
/** @type {<T>(x: T[]) => T} */
const head = ([x, ..._xs]) => x;

const objectToMap = (obj, baggage) =>
  keys(obj).reduce((acc, val) => {
    acc.init(val, obj[val]);
    return acc;
  }, baggage);

const assign = (a, c) => ({ ...a, ...c });
const constructObject = (array = []) => array.reduce(assign, {});

const pair = (a, b) => [b, a];
const concatenate = (a, o) => ({ ...a, ...o });

export {
  allValues,
  assign,
  compose,
  concatenate,
  constructObject,
  head,
  mapValues,
  objectToMap,
  pair,
  zip,
};
