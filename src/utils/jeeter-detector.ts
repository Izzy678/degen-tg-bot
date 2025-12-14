import { HolderInfo, TransactionInfo } from '../types/token.types';

export interface JeeterMetrics {
  averageHoldTime: number; // in minutes
  roundTripperPercentage: number; // % of wallets that buy and sell within 1 hour
  botLikePatterns: number; // count of wallets with bot-like behavior
  sellVelocity: number; // how quickly top holders sell
  churnRate: number; // % of holders that exit quickly
}

/**
 * Detect if a holder is a jeeter based on trading patterns
 */
export function detectJeeter(holder: HolderInfo): {
  isJeeter: boolean;
  score: number; // 0-100, higher = more jeeter-like
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  // 1. Average Hold Time Analysis
  if (holder.averageHoldTime !== undefined) {
    if (holder.averageHoldTime < 5) {
      score += 30;
      reasons.push('Extremely short hold time (<5 min)');
    } else if (holder.averageHoldTime < 30) {
      score += 20;
      reasons.push('Very short hold time (<30 min)');
    } else if (holder.averageHoldTime < 60) {
      score += 10;
      reasons.push('Short hold time (<1 hour)');
    }
  }

  // 2. Round-Tripper Detection (buy -> sell -> exit within hour)
  if (holder.buyTransactions && holder.sellTransactions) {
    const roundTrips = holder.buyTransactions.filter((buy) => {
      const correspondingSell = holder.sellTransactions?.find(
        (sell) =>
          sell.timestamp.getTime() > buy.timestamp.getTime() &&
          sell.timestamp.getTime() - buy.timestamp.getTime() < 60 * 60 * 1000 // within 1 hour
      );
      return !!correspondingSell;
    });

    if (roundTrips.length > 0) {
      const roundTripPercentage = (roundTrips.length / holder.buyTransactions.length) * 100;
      if (roundTripPercentage > 50) {
        score += 25;
        reasons.push(`High round-trip rate (${roundTripPercentage.toFixed(1)}%)`);
      } else if (roundTripPercentage > 30) {
        score += 15;
        reasons.push(`Moderate round-trip rate (${roundTripPercentage.toFixed(1)}%)`);
      }
    }
  }

  // 3. Transaction Frequency (bot-like behavior)
  if (holder.transactionCount !== undefined) {
    if (holder.transactionCount > 100) {
      score += 15;
      reasons.push('Very high transaction count (possible bot)');
    } else if (holder.transactionCount > 50) {
      score += 10;
      reasons.push('High transaction count');
    }
  }

  // 4. Quick Exit Pattern
  if (holder.buyTransactions && holder.sellTransactions) {
    const quickExits = holder.buyTransactions.filter((buy) => {
      const quickSell = holder.sellTransactions?.find(
        (sell) =>
          sell.timestamp.getTime() > buy.timestamp.getTime() &&
          sell.timestamp.getTime() - buy.timestamp.getTime() < 5 * 60 * 1000 // within 5 minutes
      );
      return !!quickSell;
    });

    if (quickExits.length > holder.buyTransactions.length * 0.5) {
      score += 20;
      reasons.push('Frequent quick exits (<5 min)');
    }
  }

  // 5. Large percentage holder with frequent trades
  if (holder.percentage > 1 && holder.transactionCount && holder.transactionCount > 10) {
    score += 10;
    reasons.push('Large holder with frequent trading');
  }

  const isJeeter = score >= 30; // Threshold for jeeter classification

  return {
    isJeeter,
    score: Math.min(100, score),
    reasons,
  };
}

/**
 * Calculate jeeter metrics for a group of holders
 */
export function calculateJeeterMetrics(holders: HolderInfo[]): JeeterMetrics {
  const holdersWithHoldTime = holders.filter((h) => h.averageHoldTime !== undefined);
  
  const averageHoldTime =
    holdersWithHoldTime.length > 0
      ? holdersWithHoldTime.reduce((sum, h) => sum + (h.averageHoldTime || 0), 0) /
        holdersWithHoldTime.length
      : 0;

  // Calculate round-tripper percentage
  let roundTrippers = 0;
  holders.forEach((holder) => {
    if (holder.buyTransactions && holder.sellTransactions) {
      const hasRoundTrip = holder.buyTransactions.some((buy) => {
        const correspondingSell = holder.sellTransactions?.find(
          (sell) =>
            sell.timestamp.getTime() > buy.timestamp.getTime() &&
            sell.timestamp.getTime() - buy.timestamp.getTime() < 60 * 60 * 1000
        );
        return !!correspondingSell;
      });
      if (hasRoundTrip) roundTrippers++;
    }
  });
  const roundTripperPercentage = holders.length > 0 ? (roundTrippers / holders.length) * 100 : 0;

  // Count bot-like patterns
  const botLikePatterns = holders.filter((h) => {
    return (
      (h.transactionCount && h.transactionCount > 100) ||
      (h.averageHoldTime !== undefined && h.averageHoldTime < 5)
    );
  }).length;

  // Calculate sell velocity (how quickly top holders sell)
  const topHolders = holders.slice(0, 10);
  const quickSellers = topHolders.filter((h) => {
    if (h.averageHoldTime === undefined) return false;
    return h.averageHoldTime < 30;
  });
  const sellVelocity = topHolders.length > 0 ? (quickSellers.length / topHolders.length) * 100 : 0;

  // Calculate churn rate
  const quickExits = holders.filter((h) => {
    return h.averageHoldTime !== undefined && h.averageHoldTime < 30;
  });
  const churnRate = holders.length > 0 ? (quickExits.length / holders.length) * 100 : 0;

  return {
    averageHoldTime,
    roundTripperPercentage,
    botLikePatterns,
    sellVelocity,
    churnRate,
  };
}

