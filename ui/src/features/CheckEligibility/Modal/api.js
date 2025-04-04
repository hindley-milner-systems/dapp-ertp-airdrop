import { Task, Either } from '../../../shared/helpers/adts.js';

const safeFetch = (
  publicKey,
  url = 'http://localhost:1010/api/verify-eligibility',
) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ publicKey }),
  });

const fetchAirdropEligibility = async publicKey => {
  // Simulate API call
  try {
    const response = await fetch(
      'http://localhost:1010/api/verify-eligibility',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ publicKey }),
      },
    );

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching airdrop eligibility', error);
  } finally {
    await { done: true, value: null };
  }
};

export { fetchAirdropEligibility, safeFetch };
