import { HolderInfo } from '../types/token.types';

export interface BundleGroup {
  addresses: string[];
  totalPercentage: number;
  averageBalance: number;
  isSuspicious: boolean;
  reasons: string[];
}

/**
 * Detect bundle holders - wallets that might be coordinated
 * Bundle holders often have similar balances and trade together
 */
export function detectBundles(holders: HolderInfo[]): BundleGroup[] {
  const bundles: BundleGroup[] = [];
  const processed = new Set<string>();

  // Group holders with similar balances (within 5% variance)
  for (let i = 0; i < holders.length; i++) {
    if (processed.has(holders[i].address)) continue;

    const currentHolder = holders[i];
    const similarHolders: HolderInfo[] = [currentHolder];
    processed.add(currentHolder.address);

    // Find holders with similar balance
    for (let j = i + 1; j < holders.length; j++) {
      if (processed.has(holders[j].address)) continue;

      const balanceDiff = Math.abs(
        (currentHolder.balance - holders[j].balance) / currentHolder.balance
      );

      // If balance is within 5% and both are significant holders
      if (balanceDiff < 0.05 && holders[j].percentage > 0.1) {
        similarHolders.push(holders[j]);
        processed.add(holders[j].address);
      }
    }

    // If we found a group of 3+ similar holders, it might be a bundle
    if (similarHolders.length >= 3) {
      const totalPercentage = similarHolders.reduce(
        (sum, h) => sum + h.percentage,
        0
      );
      const averageBalance =
        similarHolders.reduce((sum, h) => sum + h.balance, 0) /
        similarHolders.length;

      const reasons: string[] = [];
      let isSuspicious = false;

      // Check if they have similar transaction patterns
      const similarPatterns = similarHolders.filter(
        (h) => h.averageHoldTime !== undefined
      );
      if (similarPatterns.length >= 2) {
        const avgHoldTimes = similarPatterns.map((h) => h.averageHoldTime!);
        const holdTimeVariance =
          Math.max(...avgHoldTimes) - Math.min(...avgHoldTimes);
        if (holdTimeVariance < 10) {
          // Very similar hold times
          isSuspicious = true;
          reasons.push('Similar hold times suggest coordination');
        }
      }

      // Check if total percentage is significant
      if (totalPercentage > 5) {
        isSuspicious = true;
        reasons.push(`High combined percentage (${totalPercentage.toFixed(2)}%)`);
      }

      // Check if they're all jeeters
      const jeeterCount = similarHolders.filter((h) => h.isJeeter).length;
      if (jeeterCount >= 2) {
        isSuspicious = true;
        reasons.push(`${jeeterCount} jeeters in bundle`);
      }

      bundles.push({
        addresses: similarHolders.map((h) => h.address),
        totalPercentage,
        averageBalance,
        isSuspicious,
        reasons,
      });
    }
  }

  return bundles;
}

/**
 * Check if holders have suspiciously similar patterns
 */
export function detectCoordinatedActivity(holders: HolderInfo[]): {
  hasBundles: boolean;
  bundleCount: number;
  suspiciousBundles: BundleGroup[];
} {
  const bundles = detectBundles(holders);
  const suspiciousBundles = bundles.filter((b) => b.isSuspicious);

  return {
    hasBundles: bundles.length > 0,
    bundleCount: bundles.length,
    suspiciousBundles,
  };
}

