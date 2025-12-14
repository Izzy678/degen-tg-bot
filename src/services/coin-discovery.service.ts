/**
 * Coin Discovery Service
 * Finds and filters new tokens for trading opportunities
 */

import { DexService } from './dex.service';
import { SolanaService } from './solana.service';
import { TransactionService } from './transaction.service';
import { HolderService } from './holder.service';
import { SafetyFilterAnalyzer } from '../analyzers/safety-filter.analyzer';
import { MarketHealthFilterAnalyzer } from '../analyzers/market-health-filter.analyzer';
import { ThreeLayerAnalysisService } from '../analyzers/threelayeranalysis';
import { TokenInfo } from '../types/token.types';
import axios from 'axios';
import { LPHealthAnalyzer } from '../analyzers/lp-health.analyzer';
import { JeeterZoneDetector } from '../analyzers/jeeter-zone.detector';
import { WalletQualityAnalyzer } from '../analyzers/wallet-quality.analyzer';

export interface DiscoveredCoin {
  tokenAddress: string;
  tokenInfo: TokenInfo;
  safetyFilter: {
    passed: boolean;
    failedChecks: string[];
  };
  marketHealthFilter: {
    passed: boolean;
    score: number;
    failedChecks: string[];
  };
  threeLayerAnalysis?: {
    combinedScore: number;
    isDipOpportunity: boolean;
    entryRecommendation: 'avoid' | 'cautious' | 'good' | 'strong';
    profitPotential: number; // Estimated profit % (100-300%)
  };
  overallScore: number; // 0-100, combines all filters
  profitPotential: number; // 100-300% estimate
}

export class CoinDiscoveryService {
  private dexService: DexService;
  private solanaService: SolanaService;
  private transactionService?: TransactionService;
  private holderService: HolderService;
  private safetyFilter: SafetyFilterAnalyzer;
  private marketHealthFilter: MarketHealthFilterAnalyzer;
  private threeLayerAnalysis: ThreeLayerAnalysisService;
  private heliusApiKey?: string;

  constructor(
    dexService: DexService,
    solanaService: SolanaService,
    holderService: HolderService,
    transactionService?: TransactionService,
    heliusApiKey?: string,
  ) {
    this.dexService = dexService;
    this.solanaService = solanaService;
    this.transactionService = transactionService;
    this.holderService = holderService;
    this.heliusApiKey = heliusApiKey;
    this.safetyFilter = new SafetyFilterAnalyzer();
    this.marketHealthFilter = new MarketHealthFilterAnalyzer();
    this.threeLayerAnalysis = new ThreeLayerAnalysisService();
  }

  /**
   * Discover new tokens from last N hours
   * Uses a practical approach: queries for tokens that have recent activity
   * and filters by creation time indicators
   *
   * Note: Full automatic discovery requires:
   * 1. Helius webhooks (best - real-time)
   * 2. Token launchpad APIs (pump.fun, etc.)
   * 3. Manual token list (current fallback)
   */
  async discoverNewTokens(
    hours: number = 24,
    limit: number = 50,
  ): Promise<string[]> {
    if (!this.heliusApiKey) {
      console.log(
        `[CoinDiscovery] Helius API key not available - cannot auto-discover tokens`,
      );
      return [];
    }

    console.log(
      `[CoinDiscovery] Attempting to discover tokens from last ${hours} hours...`,
    );

    try {
      // Approach: Query for recent token mint transactions
      // We'll use Helius RPC to get recent transactions that created new tokens
      const heliusUrl = `https://mainnet.helius-rpc.com/?api-key=${this.heliusApiKey}`;

      // Token Program ID
      const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

      console.log(
        `[CoinDiscovery] Querying recent token program transactions...`,
      );

      // Get recent signatures from token program
      // This gives us transactions that interacted with the token program
      const response = await axios.post(
        heliusUrl,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'getSignaturesForAddress',
          params: [
            TOKEN_PROGRAM_ID,
            {
              limit: 100, // Get recent 100 transactions
            },
          ],
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 second timeout
        },
      );

      if (response.data.error) {
        console.error(`[CoinDiscovery] RPC error:`, response.data.error);
        // Fallback: return empty and suggest manual input
        return [];
      }

      const signatures = response.data.result || [];
      console.log(
        `[CoinDiscovery] Found ${signatures.length} recent token program transactions`,
      );

      // Filter by time
      const hoursAgo = Date.now() - hours * 60 * 60 * 1000;
      const recentSignatures = signatures
        .filter((sig: any) => {
          const blockTime = sig.blockTime ? sig.blockTime * 1000 : 0;
          return blockTime >= hoursAgo;
        })
        .slice(0, Math.min(50, limit * 2)); // Limit to avoid too many API calls

      console.log(
        `[CoinDiscovery] Found ${recentSignatures.length} transactions from last ${hours} hours`,
      );

      if (recentSignatures.length === 0) {
        console.log(
          `[CoinDiscovery] No recent transactions found in the specified time range`,
        );
        return [];
      }

      // Extract token addresses by parsing transaction details
      // We'll fetch a few transactions and try to extract mint addresses
      const discoveredMints = new Set<string>();
      const maxTransactionsToParse = Math.min(20, recentSignatures.length);

      console.log(
        `[CoinDiscovery] Parsing ${maxTransactionsToParse} transactions to extract token mints...`,
      );

      for (let i = 0; i < maxTransactionsToParse; i++) {
        const sig = recentSignatures[i];
        try {
          // Fetch transaction details
          const txResponse = await axios.post(
            heliusUrl,
            {
              jsonrpc: '2.0',
              id: i + 2,
              method: 'getTransaction',
              params: [
                sig.signature,
                {
                  encoding: 'jsonParsed',
                  maxSupportedTransactionVersion: 0,
                },
              ],
            },
            {
              headers: {
                'Content-Type': 'application/json',
              },
              timeout: 10000,
            },
          );

          if (txResponse.data.error || !txResponse.data.result) {
            if (i === 0) {
              console.log(
                `[CoinDiscovery] Transaction fetch error or empty result for first tx`,
              );
            }
            continue;
          }

          const tx = txResponse.data.result;

          // Debug: Log transaction structure for first few transactions
          if (i < 3) {
            console.log(
              `[CoinDiscovery] Debug TX ${i}:`,
              JSON.stringify(
                {
                  hasInstructions: !!tx.transaction?.message?.instructions,
                  instructionCount:
                    tx.transaction?.message?.instructions?.length || 0,
                  hasInnerInstructions: !!tx.meta?.innerInstructions,
                  innerInstructionCount:
                    tx.meta?.innerInstructions?.length || 0,
                  hasTokenBalances: !!tx.meta?.postTokenBalances,
                  tokenBalanceCount: tx.meta?.postTokenBalances?.length || 0,
                },
                null,
                2,
              ),
            );
          }

          // Try to extract mint addresses from transaction
          // Look for token mint instructions or token account creations
          if (tx.transaction?.message?.instructions) {
            for (const instruction of tx.transaction.message.instructions) {
              // Check if this is a token instruction
              const isTokenProgram =
                instruction.program === 'spl-token' ||
                instruction.programId === TOKEN_PROGRAM_ID ||
                (typeof instruction.programId === 'string' &&
                  instruction.programId === TOKEN_PROGRAM_ID);

              if (isTokenProgram) {
                // Look for InitializeMint instruction (creates new tokens)
                if (
                  instruction.parsed?.type === 'initializeMint' ||
                  instruction.parsed?.type === 'initializeMint2'
                ) {
                  const mint =
                    instruction.parsed?.info?.mint ||
                    instruction.parsed?.info?.account;
                  if (mint) {
                    discoveredMints.add(mint);
                    console.log(
                      `[CoinDiscovery] Found mint from InitializeMint: ${mint.slice(
                        0,
                        8,
                      )}...`,
                    );
                  }
                }

                // Also check for mint in parsed info (various instruction types)
                if (instruction.parsed?.info?.mint) {
                  discoveredMints.add(instruction.parsed.info.mint);
                }

                // Check for mint in nested structures
                if (instruction.parsed?.info?.account?.mint) {
                  discoveredMints.add(instruction.parsed.info.account.mint);
                }
              }
            }
          }

          // Check inner instructions (CPI calls)
          if (tx.meta?.innerInstructions) {
            for (const inner of tx.meta.innerInstructions) {
              if (inner.instructions) {
                for (const instruction of inner.instructions) {
                  const isTokenProgram =
                    instruction.program === 'spl-token' ||
                    instruction.programId === TOKEN_PROGRAM_ID ||
                    (typeof instruction.programId === 'string' &&
                      instruction.programId === TOKEN_PROGRAM_ID);

                  if (isTokenProgram) {
                    if (
                      instruction.parsed?.type === 'initializeMint' ||
                      instruction.parsed?.type === 'initializeMint2'
                    ) {
                      const mint =
                        instruction.parsed?.info?.mint ||
                        instruction.parsed?.info?.account;
                      if (mint) {
                        discoveredMints.add(mint);
                        console.log(
                          `[CoinDiscovery] Found mint from inner InitializeMint: ${mint.slice(
                            0,
                            8,
                          )}...`,
                        );
                      }
                    }

                    if (instruction.parsed?.info?.mint) {
                      discoveredMints.add(instruction.parsed.info.mint);
                    }
                  }
                }
              }
            }
          }

          // Also check token balance changes - new mints might show up here
          if (tx.meta?.postTokenBalances) {
            for (const balance of tx.meta.postTokenBalances) {
              if (balance.mint) {
                // This is a token account, not necessarily a new mint
                // But we can check if it's a new token by verifying on DexScreener
                // For now, we'll add it to the list to verify later
                discoveredMints.add(balance.mint);
              }
            }
          }

          // Also check account keys for potential mint addresses
          if (tx.transaction?.message?.accountKeys) {
            for (const account of tx.transaction.message.accountKeys) {
              // Token mints are typically 44 characters (base58)
              if (account.pubkey && account.pubkey.length >= 32) {
                // This is a potential address, but we can't verify it's a mint without checking
                // For now, skip this approach as it's too broad
              }
            }
          }
        } catch (error) {
          // Skip failed transactions
          if (i % 5 === 0) {
            console.log(
              `[CoinDiscovery] Parsed ${i}/${maxTransactionsToParse} transactions...`,
            );
          }
          continue;
        }
      }

      console.log(
        `[CoinDiscovery] Extracted ${discoveredMints.size} potential token mints`,
      );

      if (discoveredMints.size === 0) {
        console.log(
          `[CoinDiscovery] No token mints found in parsed transactions`,
        );
        return [];
      }

      // Verify tokens exist on DexScreener and are tradeable
      const validTokens: string[] = [];
      const mintsArray = Array.from(discoveredMints).slice(0, limit * 2);

      console.log(
        `[CoinDiscovery] Verifying ${mintsArray.length} tokens on DexScreener...`,
      );

      for (let i = 0; i < mintsArray.length; i++) {
        const mintAddress = mintsArray[i];
        if (i % 5 === 0) {
          console.log(
            `[CoinDiscovery] Verified ${i}/${mintsArray.length} tokens...`,
          );
        }

        try {
          // Quick check: see if token exists on DexScreener
          const tokenInfo = await this.dexService.getTokenInfo(mintAddress);
          if (tokenInfo && tokenInfo.price && tokenInfo.price > 0) {
            // Token is tradeable - add to list
            validTokens.push(mintAddress);
            if (validTokens.length >= limit) {
              break; // Found enough tokens
            }
          }
        } catch (e) {
          // Token not found or error - skip
        }
      }

      console.log(
        `[CoinDiscovery] Found ${validTokens.length} valid tradeable tokens`,
      );

      return validTokens;
    } catch (error) {
      console.error(`[CoinDiscovery] Error discovering tokens:`, error);
      // Fallback to DexScreener method
      return this.discoverNewTokensViaDexScreener(hours, limit);
    }
  }

  /**
   * Alternative: Try to discover via DexScreener search
   * Note: DexScreener free API has limited search capabilities
   * This attempts to find tokens by querying for recent pairs
   */
  private async discoverNewTokensViaDexScreener(
    hours: number,
    limit: number,
  ): Promise<string[]> {
    console.log(`[CoinDiscovery] Attempting DexScreener-based discovery...`);

    // DexScreener free API doesn't have a direct "new tokens" endpoint
    // We could try searching for tokens with specific criteria, but it's limited
    // For now, return empty - user should provide tokens manually
    // or we need to implement webhook-based discovery

    return [];
  }

  /**
   * Scan and analyze a single token
   */
  async scanToken(tokenAddress: string): Promise<DiscoveredCoin | null> {
    try {
      console.log(
        `[CoinDiscovery] Scanning token ${tokenAddress.slice(0, 8)}...`,
      );

      // 1. Get basic token info
      const tokenInfo = await this.dexService.getTokenInfo(tokenAddress);
      if (!tokenInfo) {
        console.log(`[CoinDiscovery] Token not found on DexScreener`);
        return null;
      }

      // 2. Get holder analysis
      const holderAnalysis = await this.holderService.analyzeHolders(
        tokenAddress,
      );

      // 3. Get transaction analysis (if available)
      let transactionAnalysis = null;
      if (this.transactionService) {
        const txData = await this.transactionService.getTokenTransactions(
          tokenAddress,
          100,
        );
        transactionAnalysis = txData?.analysis || null;
      }

      if (!transactionAnalysis) {
        console.log(
          `[CoinDiscovery] Transaction analysis unavailable, skipping`,
        );
        return null;
      }

      // 4. Get wallet quality (needed for safety filter)
      const walletQuality = await this.getWalletQuality(holderAnalysis);

      // 5. Run safety filters
      const lpHealth = await this.getLPHealth(tokenInfo);
      const jeeterFlags = await this.getJeeterFlags(
        transactionAnalysis,
        walletQuality,
        tokenInfo,
      );

      const safetyResult = this.safetyFilter.analyze(
        tokenInfo,
        holderAnalysis,
        lpHealth,
        jeeterFlags,
        walletQuality,
      );

      // Hard filter: Reject if safety checks fail
      if (!safetyResult.passed) {
        console.log(
          `[CoinDiscovery] Token failed safety filters: ${safetyResult.failedChecks.join(
            ', ',
          )}`,
        );
        return {
          tokenAddress,
          tokenInfo,
          safetyFilter: {
            passed: false,
            failedChecks: safetyResult.failedChecks,
          },
          marketHealthFilter: {
            passed: false,
            score: 0,
            failedChecks: [],
          },
          overallScore: 0,
          profitPotential: 0,
        };
      }

      // 6. Run market health filters
      const marketHealthResult = this.marketHealthFilter.analyze(
        tokenInfo,
        holderAnalysis,
        transactionAnalysis,
        walletQuality,
      );

      // Hard filter: Reject if market health checks fail
      if (!marketHealthResult.passed) {
        console.log(
          `[CoinDiscovery] Token failed market health filters: ${marketHealthResult.failedChecks.join(
            ', ',
          )}`,
        );
        return {
          tokenAddress,
          tokenInfo,
          safetyFilter: {
            passed: true,
            failedChecks: [],
          },
          marketHealthFilter: {
            passed: false,
            score: marketHealthResult.score,
            failedChecks: marketHealthResult.failedChecks,
          },
          overallScore: marketHealthResult.score,
          profitPotential: 0,
        };
      }

      // 8. Run 3-layer analysis for profit potential
      const priceHistory = await this.dexService.getPriceHistory(tokenAddress);
      const priceHistoryWithTimestamps =
        priceHistory?.map((p, i) => ({
          price: p.price,
          timestamp:
            p.timestamp || Date.now() - (priceHistory.length - i) * 3600000,
        })) || [];

      if (priceHistoryWithTimestamps.length === 0) {
        console.log(`[CoinDiscovery] No price history available`);
        return {
          tokenAddress,
          tokenInfo,
          safetyFilter: {
            passed: true,
            failedChecks: [],
          },
          marketHealthFilter: {
            passed: true,
            score: marketHealthResult.score,
            failedChecks: [],
          },
          overallScore: marketHealthResult.score,
          profitPotential: 0,
        };
      }

      const threeLayerOutcome = await this.threeLayerAnalysis.analyzeToken(
        priceHistoryWithTimestamps,
        transactionAnalysis,
        holderAnalysis.topHolders,
        tokenInfo,
      );

      // Calculate profit potential based on 3-layer analysis
      const profitPotential = this.calculateProfitPotential(
        threeLayerOutcome,
        marketHealthResult.score,
      );

      // Calculate overall score
      const overallScore = this.calculateOverallScore(
        marketHealthResult.score,
        threeLayerOutcome,
      );

      return {
        tokenAddress,
        tokenInfo,
        safetyFilter: {
          passed: true,
          failedChecks: [],
        },
        marketHealthFilter: {
          passed: true,
          score: marketHealthResult.score,
          failedChecks: [],
        },
        threeLayerAnalysis: {
          combinedScore: threeLayerOutcome.combinedScore,
          isDipOpportunity: threeLayerOutcome.isDipOpportunity,
          entryRecommendation: this.mapEntryRecommendation(threeLayerOutcome),
          profitPotential,
        },
        overallScore,
        profitPotential,
      };
    } catch (error) {
      console.error(`[CoinDiscovery] Error scanning token:`, error);
      return null;
    }
  }

  /**
   * Calculate profit potential (100-300%)
   */
  private calculateProfitPotential(
    outcome: any,
    marketHealthScore: number,
  ): number {
    if (!outcome.isDipOpportunity) {
      return 0;
    }

    // Base profit potential from combined score
    let profit = 100; // Base 100%

    // Add based on combined score
    if (outcome.combinedScore >= 80) {
      profit += 150; // Up to 250%
    } else if (outcome.combinedScore >= 70) {
      profit += 100; // Up to 200%
    } else if (outcome.combinedScore >= 60) {
      profit += 50; // Up to 150%
    }

    // Adjust based on market health
    profit += (marketHealthScore - 70) * 0.5; // Bonus for good market health

    // Adjust based on confidence
    profit += (outcome.dipConfidence - 50) * 0.3;

    // Clamp to 100-300%
    return Math.max(100, Math.min(300, Math.round(profit)));
  }

  /**
   * Calculate overall score combining all filters
   */
  private calculateOverallScore(
    marketHealthScore: number,
    threeLayerOutcome: any,
  ): number {
    // Weighted combination
    const score =
      marketHealthScore * 0.3 + // Market health 30%
      threeLayerOutcome.combinedScore * 0.7; // 3-layer analysis 70%

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Map 3-layer outcome to entry recommendation
   */
  private mapEntryRecommendation(
    outcome: any,
  ): 'avoid' | 'cautious' | 'good' | 'strong' {
    if (outcome.isDipTrap) return 'avoid';
    if (outcome.isDipOpportunity && outcome.combinedScore >= 75)
      return 'strong';
    if (outcome.isDipOpportunity) return 'good';
    return 'cautious';
  }

  /**
   * Helper: Get LP health
   */
  private async getLPHealth(tokenInfo: TokenInfo) {
    const analyzer = new LPHealthAnalyzer();
    return analyzer.analyze(tokenInfo);
  }

  /**
   * Helper: Get jeeter flags
   */
  private async getJeeterFlags(
    transactionAnalysis: any,
    walletQuality: any,
    tokenInfo: TokenInfo,
  ) {
    const detector = new JeeterZoneDetector();
    return detector.detect(transactionAnalysis, walletQuality, tokenInfo);
  }

  /**
   * Helper: Get wallet quality
   */
  private async getWalletQuality(holderAnalysis: any) {
    const analyzer = new WalletQualityAnalyzer();
    return analyzer.analyze(holderAnalysis.topHolders);
  }
}
