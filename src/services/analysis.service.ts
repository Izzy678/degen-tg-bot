import { DexService } from './dex.service';
import { TransactionService } from './transaction.service';
import {
  PriceDataPoint,
  TechnicalIndicators,
  EntryPointAnalysis,
} from '../types/token.types';

export class AnalysisService {
  private dexService: DexService;
  private transactionService?: TransactionService;

  constructor(dexService: DexService, transactionService?: TransactionService) {
    this.dexService = dexService;
    this.transactionService = transactionService;
  }

  /**
   * Calculate RSI (Relative Strength Index)
   * RSI ranges from 0-100
   * RSI > 70 = Overbought (bearish signal)
   * RSI < 30 = Oversold (bullish signal)
   */
  calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) {
      return 50; // Neutral if not enough data
    }

    const gains: number[] = [];
    const losses: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? Math.abs(change) : 0);
    }

    // Calculate average gain and loss over period
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = gains.length - period; i < gains.length; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }

    avgGain /= period;
    avgLoss /= period;

    // Handle edge cases
    if (avgLoss === 0) {
      // All gains - but cap at 95 instead of 100 to avoid extreme values
      // This can happen with simulated data or very bullish periods
      return avgGain > 0 ? 95 : 50;
    }

    if (avgGain === 0) {
      // All losses
      return 5; // Very oversold
    }

    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    // Clamp RSI between 0 and 100 (safety check)
    return Math.max(0, Math.min(100, Math.round(rsi * 100) / 100));
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  calculateMACD(prices: number[]): {
    macd: number;
    signal: number;
    histogram: number;
  } {
    if (prices.length < 26) {
      return { macd: 0, signal: 0, histogram: 0 };
    }

    // Calculate EMAs
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;

    // Calculate signal line (9-period EMA of MACD)
    // Simplified: use recent MACD values
    const signal = macd * 0.9; // Approximation
    const histogram = macd - signal;

    return {
      macd: Math.round(macd * 10000) / 10000,
      signal: Math.round(signal * 10000) / 10000,
      histogram: Math.round(histogram * 10000) / 10000,
    };
  }

  /**
   * Calculate EMA (Exponential Moving Average)
   */
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) {
      return prices[prices.length - 1] || 0;
    }

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * multiplier + ema * (1 - multiplier);
    }

    return ema;
  }

  /**
   * Detect support and resistance levels
   */
  detectSupportResistance(prices: number[]): {
    supportLevels: number[];
    resistanceLevels: number[];
  } {
    if (prices.length < 10) {
      return { supportLevels: [], resistanceLevels: [] };
    }

    const supportLevels: number[] = [];
    const resistanceLevels: number[] = [];

    // Find local minima (support) and maxima (resistance)
    for (let i = 2; i < prices.length - 2; i++) {
      const current = prices[i];
      const prev1 = prices[i - 1];
      const prev2 = prices[i - 2];
      const next1 = prices[i + 1];
      const next2 = prices[i + 2];

      // Local minimum (support)
      if (
        current < prev1 &&
        current < prev2 &&
        current < next1 &&
        current < next2
      ) {
        supportLevels.push(current);
      }

      // Local maximum (resistance)
      if (
        current > prev1 &&
        current > prev2 &&
        current > next1 &&
        current > next2
      ) {
        resistanceLevels.push(current);
      }
    }

    // Sort and get significant levels (top 3)
    supportLevels.sort((a, b) => a - b);
    resistanceLevels.sort((a, b) => b - a);

    return {
      supportLevels: supportLevels.slice(0, 3),
      resistanceLevels: resistanceLevels.slice(0, 3),
    };
  }

  /**
   * Calculate technical indicators
   */
  calculateTechnicalIndicators(
    priceHistory: Array<{ price: number }>,
  ): TechnicalIndicators {
    const prices = priceHistory.map((p) => p.price);

    console.log(
      `[AnalysisService] Calculating technical indicators for ${prices.length} data points...`,
    );

    const rsi = this.calculateRSI(prices);
    const macd = this.calculateMACD(prices);
    const { supportLevels, resistanceLevels } =
      this.detectSupportResistance(prices);

    // Determine trend
    const recentPrices = prices.slice(-10);
    const earlierPrices = prices.slice(-20, -10);
    const recentAvg =
      recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const earlierAvg =
      earlierPrices.reduce((a, b) => a + b, 0) / earlierPrices.length;

    let currentTrend: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
    if (recentAvg > earlierAvg * 1.02) {
      currentTrend = 'Bullish';
    } else if (recentAvg < earlierAvg * 0.98) {
      currentTrend = 'Bearish';
    }

    // Volume trend (simplified)
    const volumeTrend: 'Increasing' | 'Decreasing' | 'Stable' = 'Stable';

    console.log(
      `[AnalysisService] RSI: ${rsi}, Trend: ${currentTrend}, Support levels: ${supportLevels.length}, Resistance levels: ${resistanceLevels.length}`,
    );

    return {
      rsi,
      macd,
      supportLevels,
      resistanceLevels,
      currentTrend,
      volumeTrend,
    };
  }

  /**
   * Analyze entry point
   */
  async analyzeEntryPoint(
    tokenAddress: string,
    currentPrice: number,
    tokenSupply: number,
  ): Promise<EntryPointAnalysis> {
    console.log(`[AnalysisService] ===== Starting entry point analysis =====`);
    console.log(
      `[AnalysisService] Token: ${tokenAddress.slice(
        0,
        8,
      )}..., Current price: $${currentPrice}, Supply: ${tokenSupply.toLocaleString()}`,
    );

    // Get price history
    const priceHistory = await this.dexService.getPriceHistory(tokenAddress);
    if (!priceHistory || priceHistory.length === 0) {
      throw new Error('Unable to fetch price history');
    }

    // Calculate technical indicators
    const technicalIndicators = this.calculateTechnicalIndicators(priceHistory);

    // Get pair data for additional context
    const pairData = await this.dexService.getPairData(tokenAddress);

    // Get transaction analysis if available
    let transactionData = null;
    if (this.transactionService) {
      try {
        transactionData = await this.transactionService.getTokenTransactions(
          tokenAddress,
          50,
        );
        console.log(
          `[AnalysisService] Transaction data available: ${
            transactionData ? 'Yes' : 'No'
          }`,
        );
      } catch (error) {
        console.warn(
          '[AnalysisService] Could not fetch transaction data:',
          error,
        );
      }
    }

    // Determine entry recommendation with transaction data
    const entryAnalysis = this.generateEntryRecommendation(
      currentPrice,
      technicalIndicators,
      pairData,
      transactionData?.analysis,
    );

    // Calculate market caps at different price levels
    // Only calculate if we have valid supply
    let currentMarketCap = 0;
    let entryMarketCap = 0;
    let stopLossMarketCap = 0;
    let takeProfitMarketCaps: number[] = [];

    if (tokenSupply > 0) {
      currentMarketCap = currentPrice * tokenSupply;
      entryMarketCap = entryAnalysis.recommendedEntryPrice * tokenSupply;
      stopLossMarketCap = entryAnalysis.stopLoss * tokenSupply;
      takeProfitMarketCaps = entryAnalysis.takeProfit.map(
        (tp) => tp * tokenSupply,
      );

      console.log(
        `[AnalysisService] Market caps calculated - Current: $${(
          currentMarketCap / 1e3
        ).toFixed(2)}K, Entry: $${(entryMarketCap / 1e3).toFixed(2)}K`,
      );
    } else {
      console.warn(
        `[AnalysisService] Token supply is 0 or invalid, market caps will be 0`,
      );
    }

    // Add market cap data to analysis
    entryAnalysis.currentMarketCap = currentMarketCap;
    entryAnalysis.entryMarketCaps = {
      optimal: entryMarketCap,
      min: entryAnalysis.entryPriceRange.min * tokenSupply,
      max: entryAnalysis.entryPriceRange.max * tokenSupply,
    };
    entryAnalysis.stopLossMarketCap = stopLossMarketCap;
    entryAnalysis.takeProfitMarketCaps = takeProfitMarketCaps;

    console.log(
      `[AnalysisService] Entry signal: ${entryAnalysis.entrySignal}, Confidence: ${entryAnalysis.entryConfidence}%`,
    );
    console.log(
      `[AnalysisService] Current MC: $${(currentMarketCap / 1e3).toFixed(
        2,
      )}K, Entry MC: $${(entryMarketCap / 1e3).toFixed(2)}K`,
    );
    console.log(`[AnalysisService] ===== Entry point analysis complete =====`);

    return entryAnalysis;
  }

  /**
   * Generate entry point recommendation
   */
  private generateEntryRecommendation(
    currentPrice: number,
    indicators: TechnicalIndicators,
    pairData: {
      priceChange24h: number;
      high24h: number;
      low24h: number;
    } | null,
    transactionAnalysis?: import('../types/transaction.types').TransactionAnalysis,
  ): EntryPointAnalysis {
    const reasoning: string[] = [];
    let entrySignal: 'Strong Buy' | 'Buy' | 'Wait' | 'Avoid' = 'Wait';
    let entryConfidence = 50;
    let recommendedEntryPrice = currentPrice;
    let bestEntryTime: 'Now' | 'Wait for Pullback' | 'Wait for Breakout' =
      'Wait for Pullback';

    // RSI Analysis
    if (indicators.rsi < 30) {
      reasoning.push(
        '✅ RSI indicates oversold condition (good entry opportunity)',
      );
      entrySignal = 'Buy';
      entryConfidence += 20;
      recommendedEntryPrice = currentPrice * 0.98; // Slightly below current for better entry
    } else if (indicators.rsi > 70) {
      reasoning.push(
        '⚠️ RSI indicates overbought condition (wait for pullback)',
      );
      entrySignal = 'Wait';
      entryConfidence -= 15;
      bestEntryTime = 'Wait for Pullback';
      // Recommend entry at support level or 5-10% below current
      if (indicators.supportLevels.length > 0) {
        recommendedEntryPrice = indicators.supportLevels[0];
      } else {
        recommendedEntryPrice = currentPrice * 0.92;
      }
    } else if (indicators.rsi < 50) {
      reasoning.push('✅ RSI below 50 (potential upward momentum)');
      entryConfidence += 10;
    }

    // MACD Analysis
    if (
      indicators.macd.histogram > 0 &&
      indicators.macd.macd > indicators.macd.signal
    ) {
      reasoning.push('✅ MACD shows bullish momentum');
      entryConfidence += 15;
      if (entrySignal === 'Wait') entrySignal = 'Buy';
    } else if (indicators.macd.histogram < 0) {
      reasoning.push('⚠️ MACD shows bearish momentum');
      entryConfidence -= 10;
    }

    // Support/Resistance Analysis
    if (indicators.supportLevels.length > 0) {
      const nearestSupport = indicators.supportLevels[0];
      const distanceToSupport =
        ((currentPrice - nearestSupport) / currentPrice) * 100;

      if (distanceToSupport < 5) {
        reasoning.push(
          `✅ Price near support level ($${nearestSupport.toFixed(
            8,
          )}) - good entry zone`,
        );
        entryConfidence += 15;
        recommendedEntryPrice = nearestSupport;
        if (entrySignal === 'Wait') entrySignal = 'Buy';
      } else {
        reasoning.push(
          `💡 Support level at $${nearestSupport.toFixed(
            8,
          )} (${distanceToSupport.toFixed(1)}% below current)`,
        );
        bestEntryTime = 'Wait for Pullback';
        recommendedEntryPrice = nearestSupport;
      }
    }

    if (indicators.resistanceLevels.length > 0) {
      const nearestResistance = indicators.resistanceLevels[0];
      const upsidePotential =
        ((nearestResistance - currentPrice) / currentPrice) * 100;
      reasoning.push(
        `📊 Nearest resistance at $${nearestResistance.toFixed(
          8,
        )} (${upsidePotential.toFixed(1)}% upside potential)`,
      );
    }

    // Trend Analysis
    if (indicators.currentTrend === 'Bullish') {
      reasoning.push('📈 Bullish trend detected');
      entryConfidence += 10;
      if (entrySignal === 'Wait') entrySignal = 'Buy';
    } else if (indicators.currentTrend === 'Bearish') {
      reasoning.push('📉 Bearish trend - wait for reversal');
      entryConfidence -= 15;
      entrySignal = 'Wait';
    }

    // Price change analysis
    if (pairData) {
      if (pairData.priceChange24h > 20) {
        reasoning.push('⚠️ High 24h gain - may be overextended');
        entryConfidence -= 10;
        bestEntryTime = 'Wait for Pullback';
      } else if (pairData.priceChange24h < -20) {
        reasoning.push(
          '💡 Significant 24h drop - potential bounce opportunity',
        );
        entryConfidence += 10;
      }
    }

    // Transaction Analysis Integration (CRITICAL for accurate signals)
    if (transactionAnalysis) {
      const buyRatio = transactionAnalysis.buySellRatio;
      const buyRatio15m = transactionAnalysis.buySellRatio15m;

      // Strong buying pressure
      if (buyRatio > 0.65) {
        reasoning.push(
          `✅ Strong buying pressure (${(buyRatio * 100).toFixed(
            1,
          )}% buys) - bullish signal`,
        );
        entryConfidence += 15;
        if (entrySignal === 'Wait' || entrySignal === ('Avoid' as any)) {
          entrySignal = 'Buy';
        }
      }
      // Strong selling pressure
      else if (buyRatio < 0.35) {
        reasoning.push(
          `⚠️ Strong selling pressure (${((1 - buyRatio) * 100).toFixed(
            1,
          )}% sells) - bearish signal`,
        );
        entryConfidence -= 20;
        if (entrySignal === 'Buy' || entrySignal === ('Strong Buy' as any)) {
          entrySignal = 'Wait';
        }
        bestEntryTime = 'Wait for Pullback';
      }
      // Recent momentum (15m is more relevant than overall)
      else if (buyRatio15m > 0.6) {
        reasoning.push(
          `📈 Recent buying momentum (15m: ${(buyRatio15m * 100).toFixed(
            1,
          )}% buys)`,
        );
        entryConfidence += 10;
      } else if (buyRatio15m < 0.4) {
        reasoning.push(
          `📉 Recent selling momentum (15m: ${((1 - buyRatio15m) * 100).toFixed(
            1,
          )}% sells)`,
        );
        entryConfidence -= 10;
      }

      // Large transaction analysis
      if (
        transactionAnalysis.largeBuyCount >
        transactionAnalysis.largeSellCount * 1.5
      ) {
        reasoning.push(
          `✅ More large buys than sells (${transactionAnalysis.largeBuyCount} vs ${transactionAnalysis.largeSellCount}) - whale accumulation`,
        );
        entryConfidence += 10;
      } else if (
        transactionAnalysis.largeSellCount >
        transactionAnalysis.largeBuyCount * 1.5
      ) {
        reasoning.push(
          `⚠️ More large sells than buys (${transactionAnalysis.largeSellCount} vs ${transactionAnalysis.largeBuyCount}) - whale distribution`,
        );
        entryConfidence -= 15;
        if (entryConfidence < 40) {
          entrySignal = 'Avoid';
        }
      }

      // MEV detection
      if (transactionAnalysis.mevPatterns.detected) {
        reasoning.push(
          `⚠️ MEV activity detected (score: ${transactionAnalysis.mevPatterns.score}/100) - high risk`,
        );
        entryConfidence -= 15;
        if (entrySignal !== 'Avoid') {
          entrySignal = 'Wait';
        }
      }

      // Whale activity
      if (transactionAnalysis.whaleActivity.count > 0) {
        const whaleVolumeK =
          transactionAnalysis.whaleActivity.totalVolume / 1000;
        reasoning.push(
          `🐋 Whale activity: ${
            transactionAnalysis.whaleActivity.count
          } transactions ($${whaleVolumeK.toFixed(1)}K)`,
        );
        // Whale activity can be bullish or bearish depending on context
        if (buyRatio > 0.5) {
          entryConfidence += 5; // Whales buying
        } else {
          entryConfidence -= 5; // Whales selling
        }
      }
    }

    // Determine entry price range
    const entryPriceRange = {
      min: recommendedEntryPrice * 0.97, // 3% below optimal
      max: recommendedEntryPrice * 1.03, // 3% above optimal
      optimal: recommendedEntryPrice,
    };

    // Calculate stop loss (5-10% below entry)
    const stopLoss = recommendedEntryPrice * 0.92;

    // Calculate take profit levels
    const takeProfit: number[] = [];
    if (indicators.resistanceLevels.length > 0) {
      takeProfit.push(indicators.resistanceLevels[0]); // First resistance
      if (indicators.resistanceLevels.length > 1) {
        takeProfit.push(indicators.resistanceLevels[1]); // Second resistance
      }
    } else {
      // Default take profit levels (20% and 50% gains)
      takeProfit.push(recommendedEntryPrice * 1.2);
      takeProfit.push(recommendedEntryPrice * 1.5);
    }

    // Calculate risk/reward ratio
    const risk = recommendedEntryPrice - stopLoss;
    const reward = takeProfit[0] - recommendedEntryPrice;
    const riskRewardRatio = reward > 0 ? reward / risk : 0;

    // Final signal determination with improved logic
    // Factor in transaction data if available
    const hasStrongBuyingPressure =
      transactionAnalysis && transactionAnalysis.buySellRatio > 0.6;
    const hasStrongSellingPressure =
      transactionAnalysis && transactionAnalysis.buySellRatio < 0.4;

    // Calculate risk factors
    const riskFactors: string[] = [];
    let riskScore = 0;

    if (indicators.rsi > 85) {
      riskScore += 30;
      riskFactors.push('Extremely overbought (RSI > 85)');
    } else if (indicators.rsi > 75) {
      riskScore += 15;
      riskFactors.push('Overbought (RSI > 75)');
    }

    if (hasStrongSellingPressure) {
      riskScore += 25;
      riskFactors.push('Strong selling pressure');
    }

    if (transactionAnalysis?.mevPatterns.detected) {
      riskScore += 20;
      riskFactors.push('MEV activity detected');
    }

    if (
      transactionAnalysis &&
      transactionAnalysis.largeSellCount >
        transactionAnalysis.largeBuyCount * 1.5
    ) {
      riskScore += 15;
      riskFactors.push('Whale distribution');
    }

    // Determine signal based on confidence AND risk
    if (riskScore >= 50) {
      // High risk = Avoid regardless of confidence
      entrySignal = 'Avoid';
      // For Avoid signals, confidence represents "certainty of risk"
      // So high confidence in Avoid = high certainty you should avoid
      entryConfidence = Math.min(100, 50 + riskScore / 2);
      reasoning.push(
        `🚨 High risk detected (${riskScore}/100): ${riskFactors.join(', ')}`,
      );
    } else if (
      entryConfidence >= 70 &&
      indicators.rsi < 70 &&
      indicators.currentTrend !== 'Bearish' &&
      !hasStrongSellingPressure &&
      riskScore < 30
    ) {
      entrySignal = 'Strong Buy';
    } else if (
      entryConfidence >= 60 &&
      indicators.rsi < 60 &&
      (hasStrongBuyingPressure || indicators.currentTrend === 'Bullish') &&
      riskScore < 40
    ) {
      entrySignal = 'Buy';
    } else if (entryConfidence < 40 || indicators.rsi > 75 || riskScore >= 40) {
      entrySignal = 'Avoid';
      // Adjust confidence for Avoid: higher risk = higher confidence to avoid
      entryConfidence = Math.min(
        100,
        Math.max(entryConfidence, 50 + riskScore / 2),
      );
      if (riskFactors.length > 0) {
        reasoning.push(`⚠️ Risk factors: ${riskFactors.join(', ')}`);
      }
    } else if (entryConfidence < 50 || indicators.rsi > 70) {
      entrySignal = 'Wait';
    }

    // Clamp confidence
    entryConfidence = Math.max(0, Math.min(100, entryConfidence));

    return {
      currentPrice,
      recommendedEntryPrice,
      entryPriceRange,
      stopLoss,
      takeProfit,
      riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
      entryConfidence,
      entrySignal,
      technicalIndicators: indicators,
      reasoning,
      bestEntryTime,
    };
  }
}
