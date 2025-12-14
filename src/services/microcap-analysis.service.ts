import { TokenInfo, HolderAnalysis } from '../types/token.types';
import { TransactionAnalysis } from '../types/transaction.types';
import { MicrocapAnalysisResult } from '../types/microcap-analysis.types';
import { SellerExhaustionAnalyzer } from '../analyzers/seller-exhaustion.analyzer';
import { WalletQualityAnalyzer } from '../analyzers/wallet-quality.analyzer';
import { JeeterZoneDetector } from '../analyzers/jeeter-zone.detector';
import { LPHealthAnalyzer } from '../analyzers/lp-health.analyzer';
import { DipPredictionAnalyzer } from '../analyzers/dip-prediction.analyzer';
import { DexService } from './dex.service';
import { TransactionService } from './transaction.service';
import { HolderService } from './holder.service';

/**
 * Microcap Analysis Service
 * Main service that combines all microcap-specific analyzers
 * NO RSI/MACD - purely on-chain wallet and transaction patterns
 */
export class MicrocapAnalysisService {
  private dexService: DexService;
  private transactionService?: TransactionService;
  private holderService: HolderService;
  private sellerExhaustionAnalyzer: SellerExhaustionAnalyzer;
  private walletQualityAnalyzer: WalletQualityAnalyzer;
  private jeeterZoneDetector: JeeterZoneDetector;
  private lpHealthAnalyzer: LPHealthAnalyzer;
  private dipPredictionAnalyzer: DipPredictionAnalyzer;

  constructor(
    dexService: DexService,
    holderService: HolderService,
    transactionService?: TransactionService,
  ) {
    this.dexService = dexService;
    this.holderService = holderService;
    this.transactionService = transactionService;
    this.sellerExhaustionAnalyzer = new SellerExhaustionAnalyzer();
    this.walletQualityAnalyzer = new WalletQualityAnalyzer();
    this.jeeterZoneDetector = new JeeterZoneDetector();
    this.lpHealthAnalyzer = new LPHealthAnalyzer();
    this.dipPredictionAnalyzer = new DipPredictionAnalyzer();
  }

  /**
   * Perform comprehensive microcap analysis
   */
  async analyze(tokenAddress: string): Promise<MicrocapAnalysisResult> {
    console.log(
      `[MicrocapAnalysis] Starting analysis for ${tokenAddress.slice(0, 8)}...`,
    );

    const reasoning: string[] = [];

    // 1. Get token info
    const tokenInfo = await this.dexService.getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      throw new Error('Token not found');
    }

    // 2. Get holder analysis
    const holderAnalysis = await this.holderService.analyzeHolders(
      tokenAddress,
    );
    const holders = holderAnalysis.topHolders;

    // 3. Get transaction analysis
    let transactionAnalysis: TransactionAnalysis | null = null;
    if (this.transactionService) {
      const txData = await this.transactionService.getTokenTransactions(
        tokenAddress,
        100,
      );
      transactionAnalysis = txData?.analysis || null;
    }

    if (!transactionAnalysis) {
      throw new Error('Transaction analysis unavailable');
    }

    // 4. Get price history for volatility analysis
    const priceHistory = await this.dexService.getPriceHistory(tokenAddress);
    const priceHistoryWithTimestamps =
      priceHistory?.map((p, i) => ({
        price: p.price,
        timestamp:
          p.timestamp || Date.now() - (priceHistory.length - i) * 3600000,
      })) || [];

    // 5. Run all analyzers
    console.log('[MicrocapAnalysis] Running seller exhaustion analyzer...');
    const sellerExhaustion = this.sellerExhaustionAnalyzer.analyze(
      transactionAnalysis,
      priceHistoryWithTimestamps,
    );

    console.log('[MicrocapAnalysis] Running wallet quality analyzer...');
    const walletQuality = this.walletQualityAnalyzer.analyze(holders);

    console.log('[MicrocapAnalysis] Running jeeter zone detector...');
    const jeeterZone = this.jeeterZoneDetector.detect(
      transactionAnalysis,
      walletQuality,
      tokenInfo,
    );

    console.log('[MicrocapAnalysis] Running LP health analyzer...');
    const lpHealth = this.lpHealthAnalyzer.analyze(tokenInfo);

    console.log('[MicrocapAnalysis] Running dip prediction analyzer...');
    const dipPrediction = this.dipPredictionAnalyzer.predict(
      transactionAnalysis,
      walletQuality,
      lpHealth,
      tokenInfo.price || 0,
    );

    // 6. Calculate overall score
    const score = this.calculateScore(
      sellerExhaustion,
      walletQuality,
      jeeterZone,
      lpHealth,
      transactionAnalysis,
      reasoning,
    );

    // 7. Determine risk level
    const riskLevel = this.determineRiskLevel(score, jeeterZone, reasoning);

    // 8. Determine entry recommendation
    const entryRecommendation = this.determineEntryRecommendation(
      score,
      jeeterZone,
      sellerExhaustion,
      walletQuality,
      reasoning,
    );

    // 9. Build result
    const result: MicrocapAnalysisResult = {
      score,
      riskLevel,
      isJeeterDominated:
        jeeterZone.isJeeterZone || walletQuality.jeeterDominance,
      entryRecommendation,
      signals: {
        sellerExhaustion: {
          exhaustionScore: sellerExhaustion.exhaustionScore,
          isBottomSignal: sellerExhaustion.isBottomSignal,
          signals: this.getSellerExhaustionSignals(sellerExhaustion),
        },
        walletQuality: {
          overallQualityScore: walletQuality.overallQualityScore,
          highQualityWalletCount: walletQuality.highQualityWalletCount,
          jeeterDominance: walletQuality.jeeterDominance,
          sniperDominance: walletQuality.sniperDominance,
          categoryDistribution: this.mapCategoryDistribution(
            walletQuality.categoryDistribution,
          ),
        },
        sniperDetection: {
          sniperCount: walletQuality.categoryDistribution.get('sniper') || 0,
          sniperPercentage:
            ((walletQuality.categoryDistribution.get('sniper') || 0) /
              holders.length) *
            100,
          isSniperHeavy: walletQuality.sniperDominance,
        },
        lpHealth: {
          healthScore: lpHealth.healthScore,
          isHealthy: lpHealth.isHealthy,
          liquidityAmount: lpHealth.liquidityAmount,
          lpRatio: lpHealth.lpRatio,
          risks: lpHealth.risks,
        },
        volatility: {
          currentVolatility: 0, // Would need to calculate
          volatilityTrend: 0, // Would need to calculate
          isCompressed: sellerExhaustion.tightPriceRange,
        },
        whaleActivity: {
          whaleCount: walletQuality.categoryDistribution.get('whale') || 0,
          whaleAccumulation: transactionAnalysis.buySellRatio > 0.6,
          whaleDistribution: transactionAnalysis.buySellRatio < 0.4,
        },
        jeeterFlags: this.getJeeterFlags(jeeterZone),
      },
      debug: {
        reasoning,
      },
    };

    console.log(
      `[MicrocapAnalysis] Analysis complete - Score: ${score}, Recommendation: ${entryRecommendation}`,
    );
    return result;
  }

  /**
   * Calculate overall score (0-100)
   */
  private calculateScore(
    sellerExhaustion: any,
    walletQuality: any,
    jeeterZone: any,
    lpHealth: any,
    transactionAnalysis: TransactionAnalysis,
    reasoning: string[],
  ): number {
    let score = 50; // Base score

    // Seller exhaustion (0-20 points)
    score += (sellerExhaustion.exhaustionScore / 100) * 20;
    if (sellerExhaustion.isBottomSignal) {
      score += 10;
      reasoning.push('Bottom signal detected');
    }

    // Wallet quality (0-25 points)
    score += (walletQuality.overallQualityScore / 100) * 25;
    if (walletQuality.highQualityWalletCount > 0) {
      score += 5;
      reasoning.push('High quality wallets present');
    }

    // LP health (0-15 points)
    score += (lpHealth.healthScore / 100) * 15;

    // Buy/sell ratio (0-15 points)
    const buyRatio = transactionAnalysis.buySellRatio;
    if (buyRatio > 0.6) {
      score += 15;
      reasoning.push('Strong buying pressure');
    } else if (buyRatio > 0.5) {
      score += 8;
    } else if (buyRatio < 0.4) {
      score -= 15;
      reasoning.push('High selling pressure');
    }

    // Jeeter zone penalty (0-25 points deduction)
    if (jeeterZone.isJeeterZone) {
      score -= jeeterZone.riskScore / 4;
      reasoning.push('Jeeter zone detected');
    }

    // MEV penalty
    if (transactionAnalysis.mevPatterns.detected) {
      score -= transactionAnalysis.mevPatterns.score / 5;
      reasoning.push('MEV activity detected');
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Determine risk level
   */
  private determineRiskLevel(
    score: number,
    jeeterZone: any,
    reasoning: string[],
  ): 'low' | 'medium' | 'high' {
    if (jeeterZone.isJeeterZone || score < 30) {
      reasoning.push('High risk: Jeeter zone or low score');
      return 'high';
    } else if (score < 60) {
      reasoning.push('Medium risk: Moderate score');
      return 'medium';
    } else {
      reasoning.push('Low risk: Good score');
      return 'low';
    }
  }

  /**
   * Determine entry recommendation
   */
  private determineEntryRecommendation(
    score: number,
    jeeterZone: any,
    sellerExhaustion: any,
    walletQuality: any,
    reasoning: string[],
  ): 'avoid' | 'cautious' | 'good' | 'strong' {
    if (jeeterZone.isJeeterZone || score < 30) {
      reasoning.push('Recommendation: AVOID');
      return 'avoid';
    } else if (score < 50) {
      reasoning.push('Recommendation: CAUTIOUS');
      return 'cautious';
    } else if (
      score >= 70 &&
      sellerExhaustion.isBottomSignal &&
      !walletQuality.jeeterDominance
    ) {
      reasoning.push('Recommendation: STRONG');
      return 'strong';
    } else {
      reasoning.push('Recommendation: GOOD');
      return 'good';
    }
  }

  /**
   * Get seller exhaustion signals as strings
   */
  private getSellerExhaustionSignals(sellerExhaustion: any): string[] {
    const signals: string[] = [];
    if (sellerExhaustion.decreasingSellVolume)
      signals.push('Decreasing sell volume');
    if (sellerExhaustion.decreasingSellFrequency)
      signals.push('Decreasing sell frequency');
    if (sellerExhaustion.sellerDominanceCollapse)
      signals.push('Seller dominance collapse');
    if (sellerExhaustion.finalLargeSellerExit)
      signals.push('Final large seller exit');
    if (sellerExhaustion.mevInactivity) signals.push('MEV inactivity');
    if (sellerExhaustion.tightPriceRange) signals.push('Tight price range');
    if (sellerExhaustion.volatilityCollapse)
      signals.push('Volatility collapse');
    return signals;
  }

  /**
   * Map category distribution to record
   */
  private mapCategoryDistribution(
    distribution: Map<string, number>,
  ): Record<string, number> {
    const record: Record<string, number> = {};
    distribution.forEach((value, key) => {
      record[key] = value;
    });
    return record;
  }

  /**
   * Get jeeter flags as strings
   */
  private getJeeterFlags(jeeterZone: any): string[] {
    const flags: string[] = [];
    if (jeeterZone.highSellToBuyRatio) flags.push('High sell-to-buy ratio');
    if (jeeterZone.fastHolderRotation) flags.push('Fast holder rotation');
    if (jeeterZone.snipersEnteringEarly) flags.push('Snipers entering early');
    if (jeeterZone.quickDumps) flags.push('Quick dumps');
    if (jeeterZone.liquidityDrainage) flags.push('Liquidity drainage');
    if (jeeterZone.mevSpam) flags.push('MEV spam');
    if (jeeterZone.tooManySwapBots) flags.push('Too many swap bots');
    if (jeeterZone.noStrongWalletAccumulation)
      flags.push('No strong wallet accumulation');
    if (jeeterZone.lpTooThin) flags.push('LP too thin');
    if (jeeterZone.routerArbitragePump) flags.push('Router arbitrage pump');
    return flags;
  }
}
