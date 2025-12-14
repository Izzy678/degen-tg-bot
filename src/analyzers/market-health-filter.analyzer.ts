/**
 * Market Health Filter Analyzer
 * Filters for quality microcaps with growth potential
 */

import { TokenInfo } from '../types/token.types';
import { HolderAnalysis } from '../types/token.types';
import { TransactionAnalysis } from '../types/transaction.types';
import { WalletQualityAnalysis } from './wallet-quality.analyzer';

export interface MarketHealthFilterResult {
  passed: boolean;
  score: number; // 0-100, higher = better
  failedChecks: string[];
  details: {
    marketCapInRange: boolean;
    lpMcRatioStable: boolean;
    holderGrowth: boolean | null; // null = unknown (would need historical data)
    minHolders: boolean;
    minLiquidity: boolean;
    minVolume: boolean;
    noBotOnlyVolume: boolean;
    noSniperDominance: boolean;
  };
}

export class MarketHealthFilterAnalyzer {
  /**
   * Analyze market health - filters for quality microcaps
   */
  analyze(
    tokenInfo: TokenInfo,
    holderAnalysis: HolderAnalysis,
    transactionAnalysis: TransactionAnalysis,
    walletQuality: WalletQualityAnalysis,
  ): MarketHealthFilterResult {
    const failedChecks: string[] = [];
    let score = 100;
    const details: MarketHealthFilterResult['details'] = {
      marketCapInRange: false,
      lpMcRatioStable: false,
      holderGrowth: null,
      minHolders: false,
      minLiquidity: false,
      minVolume: false,
      noBotOnlyVolume: false,
      noSniperDominance: false,
    };

    // 1. MC between $50K–$2M
    const marketCap = tokenInfo.marketCap || 0;
    details.marketCapInRange = marketCap >= 50000 && marketCap <= 2000000;
    if (!details.marketCapInRange) {
      failedChecks.push(
        `Market cap ${marketCap < 50000 ? 'too low' : 'too high'} ($${(marketCap / 1000).toFixed(0)}K)`,
      );
      score -= 30;
    }

    // 2. Stable LP/MC ratio
    // Healthy ratio is typically 10-50% of MC
    const liquidity = tokenInfo.liquidity || 0;
    const lpMcRatio = marketCap > 0 ? liquidity / marketCap : 0;
    details.lpMcRatioStable = lpMcRatio >= 0.1 && lpMcRatio <= 0.5;
    if (!details.lpMcRatioStable) {
      failedChecks.push(
        `LP/MC ratio unstable (${(lpMcRatio * 100).toFixed(1)}%)`,
      );
      score -= 20;
    }

    // 3. Holder growth trending up
    // Would need historical data - mark as unknown for now
    // Could check if holders are increasing by analyzing recent transactions
    details.holderGrowth = null; // Would need historical tracking

    // 4. 50+ holders
    const minHolders = 50;
    details.minHolders = holderAnalysis.totalHolders >= minHolders;
    if (!details.minHolders) {
      failedChecks.push(
        `Insufficient holders (${holderAnalysis.totalHolders} < ${minHolders})`,
      );
      score -= 15;
    }

    // 5. $20K+ liquidity
    const minLiquidity = 20000;
    details.minLiquidity = liquidity >= minLiquidity;
    if (!details.minLiquidity) {
      failedChecks.push(
        `Insufficient liquidity ($${(liquidity / 1000).toFixed(0)}K < $${minLiquidity / 1000}K)`,
      );
      score -= 15;
    }

    // 6. $50K+ volume (24h)
    // Get volume from tokenInfo if available (set by coin discovery service)
    // Otherwise estimate from transactions
    let volume24h = (tokenInfo as any).volume24h || 0;
    if (volume24h === 0) {
      // Estimate: assume some trading activity based on transactions
      volume24h =
        (transactionAnalysis.averageTransactionSize || 0) *
        (transactionAnalysis.transactionsPerMinute || 0) *
        60 *
        24; // Estimate 24h volume
    }
    
    const minVolume = 50000;
    details.minVolume = volume24h >= minVolume;
    if (!details.minVolume) {
      failedChecks.push(
        `Insufficient volume ($${(volume24h / 1000).toFixed(0)}K < $${minVolume / 1000}K)`,
      );
      score -= 10;
    }

    // 7. No bot-only volume
    // Check if transactions are mostly from bots
    const botActivity =
      transactionAnalysis.mevPatterns.detected ||
      walletQuality.categoryDistribution.get('mev_bot') ||
      0;
    const totalWallets = holderAnalysis.totalHolders;
    const botPercentage =
      totalWallets > 0 ? (botActivity as number / totalWallets) * 100 : 0;
    details.noBotOnlyVolume = botPercentage < 50;
    if (!details.noBotOnlyVolume) {
      failedChecks.push(`Bot-dominated volume (${botPercentage.toFixed(1)}%)`);
      score -= 20;
    }

    // 8. No sniper-dominated distribution
    const sniperCount = walletQuality.categoryDistribution.get('sniper') || 0;
    const sniperPercentage =
      totalWallets > 0 ? (sniperCount / totalWallets) * 100 : 0;
    details.noSniperDominance = sniperPercentage < 30;
    if (!details.noSniperDominance) {
      failedChecks.push(
        `Sniper-dominated (${sniperPercentage.toFixed(1)}%)`,
      );
      score -= 15;
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    // Overall pass/fail (must pass all critical checks)
    const passed =
      details.marketCapInRange &&
      details.lpMcRatioStable &&
      details.minHolders &&
      details.minLiquidity &&
      details.noBotOnlyVolume &&
      details.noSniperDominance;

    return {
      passed,
      score,
      failedChecks,
      details,
    };
  }
}

