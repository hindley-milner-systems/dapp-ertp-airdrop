import { Far } from '@endo/marshal';
import { TimeMath } from '@agoric/time';
import { uncurry } from './lenses.js';

/**
 * Represents the number one thousand as a BigInt.
 *
 * @constant {bigint}
 */
const ONE_THOUSAND = 1_000n;

/**
 * Represents the number sixty as a BigInt.
 *
 * @constant {bigint}
 */
const SIXTY = 60n;

/**
 * A curried multiply function.
 *
 * @function
 * @param {bigint} x - The first multiplier.
 * @returns {Function} A function that takes the second multiplier and returns the product.
 */
const multiply = x => y => x * y;

/**
 * An uncurried version of the multiply function.
 *
 * ex.
 * <code>uMult(2, 3) // 6 </code>
 *
 * uMult(10n, 10n) // 100n
 *
 * @function
 * @param {bigint | number} x
 * @param {bigint | number} y
 */
const uMult = uncurry(multiply);

/**
 * A curried function to multiply a number by one thousand.
 *
 * @constant {Function}
 */
const multByOneK = multiply(ONE_THOUSAND);

/**
 * Represents the number of seconds in one hour.
 *
 * @constant {bigint}
 */
const ONE_HOUR = uMult(SIXTY, SIXTY);

/**
 * Represents the number of seconds in one day.
 *
 * @constant {bigint}
 */
const oneDay = uMult(ONE_HOUR, 24n);

/**
 * @param {import('@agoric/time/src/types.js').TimestampRecord} sourceTs Base timestamp used to as the starting time
 *   which a new Timestamp will be created against.
 * @param {import('@agoric/time/src/types.js').RelativeTimeRecord} inputTs Relative timestamp spanning the
 *   interval of time between sourceTs and the newly created timestamp
 */
const createFutureTs = (sourceTs, inputTs) =>
  TimeMath.absValue(sourceTs) + TimeMath.relValue(inputTs);

const makeToRT = timerBrand => value =>
  TimeMath.coerceRelativeTimeRecord(value, timerBrand);

/**
 * Represents the number of seconds in one week.
 *
 * @constant {bigint}
 */
const oneWeek = uMult(oneDay, 7n);

/**
 * Represents various time intervals.
 *
 * This object categorizes time intervals by different units such as seconds and milliseconds.
 *
 * @namespace
 */
export const TimeIntervals = {
  /**
   * Time intervals represented in seconds.
   *
   * @type {object}
   * @property {bigint} ONE_DAY - Number of seconds in one day.
   * @property {bigint} ONE_HOUR - Number of seconds in one hour.
   */
  SECONDS: {
    ONE_DAY: BigInt(oneDay),
    ONE_HOUR: 3_600n,
  },
  /**
   * Time intervals represented in milliseconds.
   *
   * @type {object}
   * @property {number} ONE_DAY - Number of milliseconds in one day.
   * @property {number} ONE_WEEK - Number of milliseconds in one week.
   */
  MILLISECONDS: {
    ONE_DAY: multByOneK(oneDay),
    ONE_WEEK: multByOneK(oneWeek),
  },
};

const makeCancelTokenMaker = (name, startCount = 0) => {
  return () => Far(`cancelToken-${name}-${(startCount += 1)}`, {});
};

const makeWaker = (name, func) => {
  return Far(name, {
    wake: timestamp => func(timestamp),
  });
};

export {
  createFutureTs,
  makeCancelTokenMaker,
  makeWaker,
  oneDay,
  oneWeek,
  makeToRT,
  ONE_THOUSAND,
  SIXTY,
};
