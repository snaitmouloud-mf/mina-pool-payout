import { Block } from "./queries";
import { StakingKey } from "./stakes";

export async function getPayouts(blocks: Block[], stakers: StakingKey[], totalStake: number, commissionRate: number):
  Promise<[payoutJson: any[], storePayout: any[], blocksIncluded: any[], allBlocksTotalRewards: number, allBlocksTotalPoolFees: number, totalPayout: number]> {

  // Initialize some stuff
  let allBlocksTotalRewards = 0;
  let allBlocksTotalPoolFees = 0;
  let blocksIncluded: any[] = [];
  let storePayout: PayoutDetails[] = [];

  // for each block, calculate the effective stake of each staker
  blocks.forEach((block: Block) => {

    // Keep a log of all blocks we processed
    blocksIncluded.push(block.blockheight);

    if (typeof (block.coinbase) === 'undefined' || block.coinbase == 0) {
      // no coinbase, don't need to do anything
    } else {

      let sumEffectivePoolStakes = 0;
      let effectivePoolStakes: { [key: string]: number } = {};

      // Determine the supercharged discount for the block
      // TODO: Should this be based on net fees, which is:
      // block.feeTransferToReceiver - block.feeTransferFromCoinbase
      // instead of txfees.

      let txFees = block.usercommandtransactionfees || 0;
      let superchargedWeightingDiscount = txFees / block.coinbase;

      // What are the rewards for the block
      let totalRewards = block.blockpayoutamount
      let totalPoolFees = commissionRate * totalRewards;

      allBlocksTotalRewards += totalRewards;
      allBlocksTotalPoolFees += totalPoolFees;

      // TODO: Add checks & balances

      // Determine the effective pool weighting based on sum of effective stakes
      // TODO: need to handle rounding to elminate franctional nanomina
      stakers.forEach((staker: StakingKey) => {
        let effectiveStake = 0;
        // if staker is unlocked, double their share (less discount for fees)
        // otherwise regular share
        if (block.globalslotsincegenesis > staker.untimedAfterSlot) {
          effectiveStake = (staker.stakingBalance * (2 - superchargedWeightingDiscount));
        } else {
          effectiveStake = staker.stakingBalance;
        }
        effectivePoolStakes[staker.publicKey] = effectiveStake;
        sumEffectivePoolStakes += effectiveStake;

        console.log(`block: ${block.blockheight} key: ${staker.publicKey} stakingBalance: ${staker.stakingBalance} untimed: ${staker.untimedAfterSlot - block.globalslotsincegenesis} effectiveStake: ${effectiveStake} superchargedweightingDiscount: ${superchargedWeightingDiscount}`);
      });

      // Sense check the effective pool stakes must be at least equal to total_staking_balance and less than 2x
      // TODO: assert total_staking_balance <= sum_effective_pool_stakes <= 2 * total_staking_balance
      if (sumEffectivePoolStakes > totalStake * 2) {
        throw new Error('Staking Calculation is more than 2x total stake')
      }
      if (sumEffectivePoolStakes < totalStake) {
        throw new Error('Staking Calculation is less than total stake')
      }

      stakers.forEach((staker: StakingKey) => {
        let effectivePoolWeighting = effectivePoolStakes[staker.publicKey] / sumEffectivePoolStakes;

        // This must be less than 1 or we have a major issue
        // TODO: assert effective_pool_weighting <= 1
        // TODO: use 9 digits precision
        let blockTotal = Math.round(
          (totalRewards - totalPoolFees) * effectivePoolWeighting
        );
        staker.total += blockTotal;

        // Store this data in a structured format for later querying and for the payment script, handled seperately
        storePayout.push({
          publicKey: staker.publicKey,
          blockHeight: block.blockheight,
          globalSlot: block.globalslotsincegenesis,
          publicKeyUntimedAfter: staker.untimedAfterSlot,
          stateHash: block.statehash,
          effectivePoolWeighting: effectivePoolWeighting,
          effectivePoolStakes: effectivePoolStakes[staker.publicKey],
          stakingBalance: staker.stakingBalance,
          sumEffectivePoolStakes: sumEffectivePoolStakes,
          superchargedWeightingDiscount: superchargedWeightingDiscount,
          dateTime: block.blockdatetime,
          coinbase: block.coinbase,
          totalRewards: totalRewards,
          payout: blockTotal,
        });
      });
    }
  });

  let payoutJson: { publicKey: string; total: number }[] = [];
  let totalPayout = 0;
  stakers.forEach((staker: StakingKey) => {
    payoutJson.push({
      publicKey: staker.publicKey,
      total: staker.total,
    });
    totalPayout += staker.total;
  });
  return [payoutJson, storePayout, blocksIncluded, allBlocksTotalRewards, allBlocksTotalPoolFees, totalPayout];
}

export type PayoutDetails = {
  publicKey: string,
  blockHeight: number,
  globalSlot: number,
  publicKeyUntimedAfter: number,
  stateHash: string,
  effectivePoolWeighting: number,
  effectivePoolStakes: number,
  stakingBalance: number,
  sumEffectivePoolStakes: number,
  superchargedWeightingDiscount: number,
  dateTime: number,
  coinbase: number,
  totalRewards: number,
  payout: number
};
