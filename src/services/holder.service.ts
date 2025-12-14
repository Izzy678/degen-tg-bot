import { SolanaService } from './solana.service';
import { DexService } from './dex.service';
import { TransactionService } from './transaction.service';
import {
  HolderInfo,
  HolderAnalysis,
  TokenInfo,
  TokenAnalysis,
} from '../types/token.types';
import { detectJeeter } from '../utils/jeeter-detector';
import { calculateJeeterMetrics } from '../utils/jeeter-detector';
import { detectBundles } from '../utils/bundle-detector';
import {
  calculateJeeterRiskScore,
  getRiskLevel,
  calculateOverallScore,
  generateRecommendations,
} from '../utils/risk-calculator';

export class HolderService {
  private solanaService: SolanaService;
  private dexService: DexService;
  private transactionService?: TransactionService;

  constructor(
    solanaService: SolanaService,
    dexService: DexService,
    transactionService?: TransactionService,
  ) {
    this.solanaService = solanaService;
    this.dexService = dexService;
    this.transactionService = transactionService;
  }

  /**
   * Analyze holders for a token
   */
  async analyzeHolders(
    tokenAddress: string,
    holderLimit: number = 150,
  ): Promise<HolderAnalysis> {
    try {
      console.log(
        `[HolderService] Starting holder analysis for token: ${tokenAddress.slice(
          0,
          8,
        )}...`,
      );

      // Get token supply
      console.log(`[HolderService] Fetching token supply...`);
      const supplyInfo = await this.solanaService.getTokenSupply(tokenAddress);
      const totalSupply = supplyInfo.supply;
      console.log(
        `[HolderService] Token supply: ${totalSupply.toLocaleString()}`,
      );

      // Get holders
      console.log(`[HolderService] Fetching top ${holderLimit} holders...`);
      const holdersData = await this.solanaService.getTokenHolders(
        tokenAddress,
        holderLimit,
      );
      console.log(`[HolderService] Found ${holdersData.length} holders`);

      // Get token info for market cap calculation
      const tokenInfo = await this.dexService.getTokenInfo(tokenAddress);

      // Process holders
      const holders: HolderInfo[] = holdersData.map((holder) => {
        const percentage = (holder.balance / totalSupply) * 100;
        return {
          address: holder.address,
          balance: holder.balance,
          percentage,
        };
      });

      // Get transaction data for top holders (for jeeter detection)
      // NOTE: Fetching transactions is rate-limited, so we only analyze top 10-20 holders
      // and skip transaction fetching for now to avoid 429 errors
      const topHolders = holders.slice(0, 20); // Analyze top 20 for jeeter patterns

      console.log(
        `[HolderService] Analyzing ${topHolders.length} top holders for jeeter patterns...`,
      );

      // Skip transaction fetching for now to avoid rate limits
      // In production, you'd fetch actual transaction history with proper rate limiting
      for (let i = 0; i < topHolders.length; i++) {
        const holder = topHolders[i];

        // Add delay between requests to avoid rate limiting
        if (i > 0 && i % 5 === 0) {
          console.log(
            `[HolderService] Rate limit protection: waiting 2 seconds...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        try {
          // For now, skip transaction fetching to avoid 429 errors
          // Transaction data would be used for accurate jeeter detection
          // const transactions = await this.solanaService.getWalletTransactions(
          //   holder.address,
          //   50
          // );

          // Analyze for jeeter patterns based on holder data only
          // (without transaction history, this is a simplified analysis)
          const jeeterResult = detectJeeter(holder);
          holder.isJeeter = jeeterResult.isJeeter;
          holder.jeeterScore = jeeterResult.score;

          if (holder.isJeeter) {
            console.log(
              `[HolderService] Jeeter detected: ${holder.address.slice(
                0,
                8,
              )}... (score: ${holder.jeeterScore})`,
            );
          }
        } catch (error) {
          console.error(
            `[HolderService] Error analyzing holder ${holder.address}:`,
            error,
          );
          // Continue with other holders even if one fails
        }
      }

      console.log(
        `[HolderService] Completed jeeter analysis for ${topHolders.length} holders`,
      );

      // Calculate jeeter metrics
      console.log(`[HolderService] Calculating jeeter metrics...`);
      const jeeterMetrics = calculateJeeterMetrics(holders);
      console.log(
        `[HolderService] Jeeter metrics: avgHoldTime=${jeeterMetrics.averageHoldTime.toFixed(
          1,
        )}min, roundTrippers=${jeeterMetrics.roundTripperPercentage.toFixed(
          1,
        )}%`,
      );

      // Detect bundles
      console.log(`[HolderService] Detecting bundle groups...`);
      const bundles = detectBundles(holders);
      console.log(`[HolderService] Found ${bundles.length} bundle groups`);

      // Calculate holder concentration (top 10)
      const top10Holders = holders.slice(0, 10);
      const holderConcentration = top10Holders.reduce(
        (sum, h) => sum + h.percentage,
        0,
      );

      // Count jeeters
      const jeeterCount = holders.filter((h) => h.isJeeter).length;
      const jeeterPercentage =
        holders.length > 0 ? (jeeterCount / holders.length) * 100 : 0;

      // Calculate average hold time (from metrics)
      const averageHoldTime = jeeterMetrics.averageHoldTime;

      // Get real buy/sell ratio from transaction analysis
      let buySellRatio = 0.5; // Default fallback
      let transactionAnalysis = undefined;

      if (this.transactionService) {
        try {
          console.log(`[HolderService] Fetching real transaction data...`);
          const txData = await this.transactionService.getTokenTransactions(
            tokenAddress,
            100,
          );

          if (txData && txData.analysis) {
            buySellRatio = txData.analysis.buySellRatio;
            transactionAnalysis = {
              buySellRatio: txData.analysis.buySellRatio,
              buySellRatio5m: txData.analysis.buySellRatio5m,
              buySellRatio15m: txData.analysis.buySellRatio15m,
              buySellRatio1h: txData.analysis.buySellRatio1h,
              buyVolume: txData.analysis.buyVolume,
              sellVolume: txData.analysis.sellVolume,
              largeBuyCount: txData.analysis.largeBuyCount,
              largeSellCount: txData.analysis.largeSellCount,
              whaleActivity: {
                count: txData.analysis.whaleActivity.count,
                totalVolume: txData.analysis.whaleActivity.totalVolume,
              },
              mevDetected: txData.analysis.mevPatterns.detected,
              mevScore: txData.analysis.mevPatterns.score,
              transactionCount: txData.analysis.transactionCount,
              transactionsPerMinute: txData.analysis.transactionsPerMinute,
            };
            console.log(
              `[HolderService] Transaction analysis complete: Buy/Sell ratio = ${buySellRatio.toFixed(
                2,
              )}`,
            );
          }
        } catch (error) {
          console.warn(
            `[HolderService] Could not fetch transaction data:`,
            error,
          );
          // Continue with default values
        }
      }

      // Calculate volume spikiness (simplified)
      const volumeData = await this.dexService.getTradingVolume(tokenAddress);
      let volumeSpikiness = 0;
      if (volumeData) {
        // If >30% of volume in first 10 minutes, it's spiky
        // This is a simplified calculation
        volumeSpikiness =
          volumeData.volume5m > volumeData.volume24h * 0.3 ? 80 : 20;
      }

      // Calculate jeeter risk score
      const holderAnalysis: HolderAnalysis = {
        totalHolders: holders.length,
        topHolders: holders.slice(0, 20), // Return top 20 for display
        jeeterCount,
        jeeterPercentage,
        bundleCount: bundles.length,
        averageHoldTime,
        holderConcentration,
        buySellRatio,
        volumeSpikiness,
        jeeterRiskScore: 0, // Will calculate below
        riskLevel: 'Low',
        transactionAnalysis,
      };

      // Calculate jeeter risk score
      holderAnalysis.jeeterRiskScore = calculateJeeterRiskScore(
        holderAnalysis,
        jeeterMetrics,
      );
      holderAnalysis.riskLevel = getRiskLevel(holderAnalysis.jeeterRiskScore);

      return holderAnalysis;
    } catch (error) {
      console.error('Error analyzing holders:', error);
      throw error;
    }
  }

  /**
   * Full token analysis
   */
  async analyzeToken(tokenAddress: string): Promise<TokenAnalysis> {
    try {
      console.log(`[HolderService] ===== Starting full token analysis =====`);
      console.log(`[HolderService] Token address: ${tokenAddress}`);

      // Get token info
      console.log(`[HolderService] Step 1/3: Fetching token info from DEX...`);
      const tokenInfo = await this.dexService.getTokenInfo(tokenAddress);
      if (!tokenInfo) {
        throw new Error('Token not found on DEX');
      }
      console.log(
        `[HolderService] Token info: ${tokenInfo.name || 'Unknown'} (${
          tokenInfo.symbol || 'N/A'
        })`,
      );

      // Get supply info
      console.log(`[HolderService] Step 2/3: Fetching token supply...`);
      const supplyInfo = await this.solanaService.getTokenSupply(tokenAddress);
      tokenInfo.supply = supplyInfo.supply;
      tokenInfo.decimals = supplyInfo.decimals;

      // Analyze holders
      console.log(`[HolderService] Step 3/3: Analyzing holders...`);
      const holderAnalysis = await this.analyzeHolders(tokenAddress);

      // Calculate overall score
      console.log(`[HolderService] Calculating overall score...`);
      const overallScore = calculateOverallScore(holderAnalysis);
      console.log(`[HolderService] Overall score: ${overallScore}/100`);

      // Generate recommendations
      const recommendations = generateRecommendations(holderAnalysis);
      console.log(
        `[HolderService] Generated ${recommendations.length} recommendations`,
      );

      // Determine overall risk level
      const riskLevel = holderAnalysis.riskLevel;
      console.log(
        `[HolderService] ===== Analysis complete: Risk Level = ${riskLevel}, Score = ${overallScore}/100 =====`,
      );

      return {
        token: tokenInfo,
        holderAnalysis,
        overallScore,
        riskLevel,
        recommendations,
      };
    } catch (error) {
      console.error('[HolderService] Error analyzing token:', error);
      throw error;
    }
  }
}
