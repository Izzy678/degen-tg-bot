import { TransactionAnalysis } from '../types/transaction.types';
import { WalletQualityAnalysis } from './wallet-quality.analyzer';
import { LPHealthSignals } from './lp-health.analyzer';

/**
 * Dip Prediction Analyzer
 * Predicts whether a dip is a trap or an opportunity
 */
export interface DipPrediction {
  isDipOpportunity: boolean;
  isDipTrap: boolean;
  dipConfidence: number; // 0-100
  reasons: string[];
  expectedDipDepth: number; // Percentage
  entryZone: {
    min: number;
    max: number;
    optimal: number;
  };
}

export class DipPredictionAnalyzer {
  /**
   * Predict if current dip is opportunity or trap
   */
  predict(
    transactionAnalysis: TransactionAnalysis,
    walletQuality: WalletQualityAnalysis,
    lpHealth: LPHealthSignals,
    currentPrice: number,
  ): DipPrediction {
    const prediction: DipPrediction = {
      isDipOpportunity: false,
      isDipTrap: false,
      dipConfidence: 0,
      reasons: [],
      expectedDipDepth: 0,
      entryZone: {
        min: currentPrice * 0.9,
        max: currentPrice * 1.1,
        optimal: currentPrice,
      },
    };

    let opportunityScore = 0;
    let trapScore = 0;

    // OPPORTUNITY SIGNALS

    // 1. Wallet exhaustion (sellers exhausted)
    if (transactionAnalysis.buySellRatio > 0.6) {
      opportunityScore += 20;
      prediction.reasons.push('Buying pressure increasing');
    }

    // 2. Strong hands accumulating
    if (walletQuality.highQualityWalletCount > 0) {
      opportunityScore += 15;
      prediction.reasons.push('Strong wallets accumulating');
    }

    // 3. Jeeters/snipers exiting
    if (!walletQuality.jeeterDominance && !walletQuality.sniperDominance) {
      opportunityScore += 15;
      prediction.reasons.push('Jeeters/snipers cleared out');
    }

    // 4. Healthy LP
    if (lpHealth.isHealthy) {
      opportunityScore += 10;
      prediction.reasons.push('LP health good');
    }

    // 5. Low MEV activity
    if (
      !transactionAnalysis.mevPatterns.detected ||
      transactionAnalysis.mevPatterns.score < 30
    ) {
      opportunityScore += 10;
      prediction.reasons.push('Low MEV activity');
    }

    // TRAP SIGNALS

    // 1. Sniper exit patterns
    if (walletQuality.sniperDominance) {
      trapScore += 25;
      prediction.reasons.push('Snipers still dominant - likely trap');
    }

    // 2. MEV spam
    if (
      transactionAnalysis.mevPatterns.detected &&
      transactionAnalysis.mevPatterns.score > 50
    ) {
      trapScore += 20;
      prediction.reasons.push('High MEV activity - manipulation likely');
    }

    // 3. Liquidity removal risk
    if (!lpHealth.isHealthy) {
      trapScore += 20;
      prediction.reasons.push('LP health poor - risk of removal');
    }

    // 4. High sell pressure continuing
    if (transactionAnalysis.buySellRatio < 0.4) {
      trapScore += 15;
      prediction.reasons.push('Selling pressure still high');
    }

    // 5. Router manipulation
    if (
      transactionAnalysis.transactionsPerMinute > 5 &&
      transactionAnalysis.averageTransactionSize < 100
    ) {
      trapScore += 15;
      prediction.reasons.push('Possible router arbitrage manipulation');
    }

    // Determine outcome
    if (opportunityScore > trapScore && opportunityScore >= 40) {
      prediction.isDipOpportunity = true;
      prediction.dipConfidence = Math.min(100, opportunityScore);
    } else if (trapScore > opportunityScore && trapScore >= 40) {
      prediction.isDipTrap = true;
      prediction.dipConfidence = Math.min(100, trapScore);
    } else {
      prediction.dipConfidence = Math.max(opportunityScore, trapScore);
    }

    // Estimate dip depth
    if (prediction.isDipTrap) {
      prediction.expectedDipDepth = 20; // Traps often go 20%+ deeper
    } else if (prediction.isDipOpportunity) {
      prediction.expectedDipDepth = 5; // Opportunities usually shallow
    }

    // Calculate entry zone
    if (prediction.isDipOpportunity) {
      prediction.entryZone = {
        min: currentPrice * 0.95,
        max: currentPrice * 1.05,
        optimal: currentPrice * 0.98,
      };
    } else if (prediction.isDipTrap) {
      prediction.entryZone = {
        min: currentPrice * 0.7,
        max: currentPrice * 0.9,
        optimal: currentPrice * 0.8,
      };
    }

    return prediction;
  }
}
