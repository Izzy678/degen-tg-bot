import { TransactionAnalysis } from '../types/transaction.types';

/**
 * Seller Exhaustion Analyzer
 * Detects real bottoms in microcap tokens by analyzing seller behavior
 * NOT based on RSI/MACD - purely on on-chain seller patterns
 */
export interface SellerExhaustionSignals {
  decreasingSellVolume: boolean;
  decreasingSellFrequency: boolean;
  sellerDominanceCollapse: boolean;
  finalLargeSellerExit: boolean;
  mevInactivity: boolean;
  tightPriceRange: boolean;
  volatilityCollapse: boolean;
  exhaustionScore: number; // 0-100, higher = more exhausted sellers
  isBottomSignal: boolean;
}

export class SellerExhaustionAnalyzer {
  /**
   * Analyze seller exhaustion patterns
   */
  analyze(
    transactionAnalysis: TransactionAnalysis,
    priceHistory: Array<{ price: number; timestamp: number }>,
  ): SellerExhaustionSignals {
    const signals: SellerExhaustionSignals = {
      decreasingSellVolume: false,
      decreasingSellFrequency: false,
      sellerDominanceCollapse: false,
      finalLargeSellerExit: false,
      mevInactivity: false,
      tightPriceRange: false,
      volatilityCollapse: false,
      exhaustionScore: 0,
      isBottomSignal: false,
    };

    // 1. Decreasing sell volume (last 15m vs last 1h)
    const sellVolume1h = transactionAnalysis.sellVolume;
    const sellVolume15m = this.estimateSellVolume15m(transactionAnalysis);

    if (sellVolume15m < sellVolume1h * 0.3) {
      signals.decreasingSellVolume = true;
      signals.exhaustionScore += 20;
    }

    // 2. Decreasing sell frequency
    const sellFrequency = transactionAnalysis.largeSellCount;
    const buyFrequency = transactionAnalysis.largeBuyCount;

    if (sellFrequency < buyFrequency * 0.5 && sellFrequency < 3) {
      signals.decreasingSellFrequency = true;
      signals.exhaustionScore += 15;
    }

    // 3. Seller dominance collapse (buy ratio increasing)
    if (transactionAnalysis.buySellRatio > 0.6) {
      signals.sellerDominanceCollapse = true;
      signals.exhaustionScore += 20;
    }

    // 4. Final large seller exit (large sell followed by no sells)
    if (
      transactionAnalysis.largeSellCount > 0 &&
      transactionAnalysis.largeSellCount <= 2
    ) {
      // Only 1-2 large sells recently, then stopped
      signals.finalLargeSellerExit = true;
      signals.exhaustionScore += 15;
    }

    // 5. MEV/snipe bot inactivity
    if (
      !transactionAnalysis.mevPatterns.detected ||
      transactionAnalysis.mevPatterns.score < 20
    ) {
      signals.mevInactivity = true;
      signals.exhaustionScore += 10;
    }

    // 6. Tight price range (low volatility)
    const priceVolatility = this.calculatePriceVolatility(priceHistory);
    if (priceVolatility < 0.05) {
      // Less than 5% volatility
      signals.tightPriceRange = true;
      signals.exhaustionScore += 10;
    }

    // 7. Volatility collapse (decreasing volatility over time)
    const volatilityTrend = this.calculateVolatilityTrend(priceHistory);
    if (volatilityTrend < -0.2) {
      // Volatility decreased by 20%+
      signals.volatilityCollapse = true;
      signals.exhaustionScore += 10;
    }

    // Bottom signal = multiple exhaustion signals + low volatility + sellers gone
    signals.isBottomSignal =
      signals.exhaustionScore >= 60 &&
      signals.tightPriceRange &&
      signals.sellerDominanceCollapse &&
      signals.mevInactivity;

    return signals;
  }

  /**
   * Estimate sell volume for last 15 minutes
   */
  private estimateSellVolume15m(analysis: TransactionAnalysis): number {
    // Use 15m buy/sell ratio to estimate 15m sell volume
    const buyRatio15m = analysis.buySellRatio15m;
    const totalVolume15m = analysis.totalVolume * 0.25; // Rough estimate: 15m = 25% of 1h
    return totalVolume15m * (1 - buyRatio15m);
  }

  /**
   * Calculate price volatility (standard deviation of price changes)
   */
  private calculatePriceVolatility(
    priceHistory: Array<{ price: number }>,
  ): number {
    if (priceHistory.length < 2) return 1;

    const prices = priceHistory.map((p) => p.price);
    const changes: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      const change = Math.abs((prices[i] - prices[i - 1]) / prices[i - 1]);
      changes.push(change);
    }

    const avgChange = changes.reduce((sum, c) => sum + c, 0) / changes.length;
    const variance =
      changes.reduce((sum, c) => sum + Math.pow(c - avgChange, 2), 0) /
      changes.length;
    const stdDev = Math.sqrt(variance);

    return stdDev;
  }

  /**
   * Calculate volatility trend (negative = decreasing volatility)
   */
  private calculateVolatilityTrend(
    priceHistory: Array<{ price: number; timestamp: number }>,
  ): number {
    if (priceHistory.length < 10) return 0;

    const midPoint = Math.floor(priceHistory.length / 2);
    const recent = priceHistory.slice(midPoint);
    const earlier = priceHistory.slice(0, midPoint);

    const recentVolatility = this.calculatePriceVolatility(recent);
    const earlierVolatility = this.calculatePriceVolatility(earlier);

    if (earlierVolatility === 0) return 0;

    return (recentVolatility - earlierVolatility) / earlierVolatility;
  }
}
