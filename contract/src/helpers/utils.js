import { divideBy, makeRatio } from "@agoric/zoe/src/contractSupport/ratio.js";

/**
 * @param {ZCFSeat} seat
 */
const getSeatAllocationDetils = (seat) => ({
	currentAllocation: seat.getCurrentAllocation(),
	stagedAllocation: seat.getStagedAllocation(),
	hasExited: seat.hasExited(),
});

const divideAmountByTwo = (brand) => (amount) =>
	divideBy(amount, makeRatio(200n, brand), 0n);

harden(divideAmountByTwo);

export { getSeatAllocationDetils, divideAmountByTwo };
