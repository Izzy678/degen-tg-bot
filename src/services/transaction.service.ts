import axios from 'axios';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  SwapTransaction,
  TransactionAnalysis,
  TokenTransactionData,
} from '../types/transaction.types';
import { heliusRateLimiter } from '../utils/rate-limiter';

export class TransactionService {
  private heliusApiKey: string;
  private heliusBaseUrl = 'https://api-mainnet.helius-rpc.com/v0';
  private connection: Connection;
  private cache: Map<
    string,
    { data: TokenTransactionData; timestamp: number }
  > = new Map();
  private cacheTimeout = 60000; // 1 minute cache

  constructor(heliusApiKey: string, rpcEndpoint?: string) {
    this.heliusApiKey = heliusApiKey;
    this.connection = new Connection(
      rpcEndpoint || `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`,
      'confirmed',
    );
  }

  /**
   * Get transactions for a token address using Helius Enhanced API
   */
  async getTokenTransactions(
    tokenAddress: string,
    limit: number = 100,
  ): Promise<TokenTransactionData | null> {
    try {
      // Check cache first
      const cached = this.cache.get(tokenAddress);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        console.log(
          `[TransactionService] Using cached data for ${tokenAddress.slice(
            0,
            8,
          )}...`,
        );
        return cached.data;
      }

      await heliusRateLimiter.checkLimit('helius-api');

      console.log(
        `[TransactionService] Fetching transactions for ${tokenAddress.slice(
          0,
          8,
        )}...`,
      );

      // Get pair address - this is where swap transactions actually occur
      const pairAddress = await this.getPairAddress(tokenAddress);
      console.log('[TransactionService] Pair address:', pairAddress);

      if (!pairAddress) {
        console.warn(
          `[TransactionService] Could not find pair address - transaction analysis will be limited`,
        );
        // Still try RPC method with token address as fallback
        return await this.getTransactionsViaRPC(
          tokenAddress,
          tokenAddress,
          limit,
        );
      }

      // Use RPC method directly - it's more reliable than Enhanced API
      // The Enhanced API might have different requirements or rate limits
      // RPC getSignaturesForAddress on pair address works reliably
      console.log('[TransactionService] Using RPC method with pair address...');
      const result = await this.getTransactionsViaRPC(
        tokenAddress,
        pairAddress,
        limit,
      );

      // Cache the result if successful
      if (result) {
        this.cache.set(tokenAddress, { data: result, timestamp: Date.now() });
      }

      return result;
    } catch (error) {
      console.error('[TransactionService] Error fetching transactions:', error);
      if (axios.isAxiosError(error)) {
        console.error('[TransactionService] Response:', error.response?.data);
      }
      return null;
    }
  }

  /**
   * Get pair address from DexScreener
   *
   * Difference:
   * - Token Address (Mint): The SPL token mint address (e.g., 9cu2U81U...)
   *   This identifies the token itself
   * - Pair Address: The liquidity pool address where trades happen (e.g., 28K1LdM3...)
   *   This is the DEX pool address (Raydium/Orca/etc.)
   *
   * For transaction analysis, we need the PAIR address because that's where
   * all the swap transactions occur. The token address alone won't show swaps.
   */
  private async getPairAddress(tokenAddress: string): Promise<string | null> {
    try {
      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      );

      if (response.data?.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0];
        return pair.pairAddress || null;
      }

      return null;
    } catch (error) {
      console.error('[TransactionService] Error fetching pair address:', error);
      return null;
    }
  }

  /**
   * Parse Helius transaction data into SwapTransaction format
   */
  private async parseTransactions(
    transactions: any[],
    tokenAddress: string,
    pairAddress: string,
  ): Promise<SwapTransaction[]> {
    const swapTransactions: SwapTransaction[] = [];

    for (const tx of transactions) {
      try {
        // Parse transaction to determine if it's a buy or sell
        // This is simplified - in production you'd need to parse DEX instructions
        const parsed = await this.parseSwapTransaction(
          tx,
          tokenAddress,
          pairAddress,
        );
        if (parsed) {
          swapTransactions.push(parsed);
        }
      } catch (error) {
        // Skip transactions we can't parse
        continue;
      }
    }

    return swapTransactions;
  }

  /**
   * Parse a single swap transaction
   * Note: This is a simplified parser. Real implementation would need to parse
   * Raydium/Jupiter/Orca swap instructions
   */
  private async parseSwapTransaction(
    tx: any,
    tokenAddress: string,
    pairAddress: string,
  ): Promise<SwapTransaction | null> {
    try {
      // Extract timestamp
      const timestamp = tx.blockTime
        ? new Date(tx.blockTime * 1000)
        : new Date();

      // Extract wallet address (signer)
      const wallet = tx.transaction?.message?.accountKeys?.[0] || '';

      // For now, we'll use a simplified approach:
      // Check if SOL is being spent (sell) or tokens are being spent (buy)
      // This is a placeholder - real implementation needs DEX instruction parsing

      // Try to extract token amounts from balance changes
      let amountTokens = 0;
      let amountUsd = 0;
      let type: 'buy' | 'sell' = 'buy';

      // Check pre/post token balances if available
      if (tx.meta?.preTokenBalances && tx.meta?.postTokenBalances) {
        const preBalances = tx.meta.preTokenBalances;
        const postBalances = tx.meta.postTokenBalances;

        // Find token balance changes
        for (const postBalance of postBalances) {
          if (postBalance.mint === tokenAddress) {
            const preBalance = preBalances.find(
              (b: any) => b.accountIndex === postBalance.accountIndex,
            );
            const change =
              parseFloat(postBalance.uiTokenAmount.uiAmountString || '0') -
              parseFloat(preBalance?.uiTokenAmount.uiAmountString || '0');

            if (Math.abs(change) > 0) {
              amountTokens = Math.abs(change);
              type = change > 0 ? 'buy' : 'sell';
              break;
            }
          }
        }
      }

      // If we couldn't parse, skip this transaction
      if (amountTokens === 0) {
        return null;
      }

      // Estimate USD value (would need current price)
      // For now, we'll set a placeholder
      amountUsd = amountTokens; // This should be calculated with actual price

      return {
        signature: tx.transaction?.signatures?.[0] || '',
        timestamp,
        type,
        amountUsd,
        amountTokens,
        price: amountUsd / amountTokens || 0,
        wallet,
      };
    } catch (error) {
      console.error('[TransactionService] Error parsing transaction:', error);
      return null;
    }
  }

  /**
   * Analyze transactions to generate insights
   */
  private analyzeTransactions(
    transactions: SwapTransaction[],
  ): TransactionAnalysis {
    if (transactions.length === 0) {
      return this.getEmptyAnalysis();
    }

    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const fifteenMinutesAgo = now - 15 * 60 * 1000;
    const oneHourAgo = now - 60 * 60 * 1000;
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

    // Filter transactions by time
    const tx5m = transactions.filter(
      (tx) => tx.timestamp.getTime() > fiveMinutesAgo,
    );
    const tx15m = transactions.filter(
      (tx) => tx.timestamp.getTime() > fifteenMinutesAgo,
    );
    const tx1h = transactions.filter(
      (tx) => tx.timestamp.getTime() > oneHourAgo,
    );
    const tx24h = transactions.filter(
      (tx) => tx.timestamp.getTime() > twentyFourHoursAgo,
    );

    // Calculate buy/sell ratios
    const calculateRatio = (txs: SwapTransaction[]) => {
      const buys = txs.filter((tx) => tx.type === 'buy');
      const sells = txs.filter((tx) => tx.type === 'sell');
      const buyVolume = buys.reduce((sum, tx) => sum + tx.amountUsd, 0);
      const sellVolume = sells.reduce((sum, tx) => sum + tx.amountUsd, 0);
      const totalVolume = buyVolume + sellVolume;
      return totalVolume > 0 ? buyVolume / totalVolume : 0.5;
    };

    const buySellRatio = calculateRatio(transactions);
    const buySellRatio5m = calculateRatio(tx5m);
    const buySellRatio15m = calculateRatio(tx15m);
    const buySellRatio1h = calculateRatio(tx1h);
    const buySellRatio24h = calculateRatio(tx24h);

    // Calculate volumes
    const buys = transactions.filter((tx) => tx.type === 'buy');
    const sells = transactions.filter((tx) => tx.type === 'sell');
    const buyVolume = buys.reduce((sum, tx) => sum + tx.amountUsd, 0);
    const sellVolume = sells.reduce((sum, tx) => sum + tx.amountUsd, 0);
    const totalVolume = buyVolume + sellVolume;

    // Large transactions (>$5k)
    const largeTxThreshold = 5000;
    const largeTransactions = transactions.filter(
      (tx) => tx.amountUsd >= largeTxThreshold,
    );
    const largeBuys = largeTransactions.filter((tx) => tx.type === 'buy');
    const largeSells = largeTransactions.filter((tx) => tx.type === 'sell');

    // Whale activity (>$10k)
    const whaleThreshold = 10000;
    const whaleTxs = transactions.filter(
      (tx) => tx.amountUsd >= whaleThreshold,
    );
    const whaleVolume = whaleTxs.reduce((sum, tx) => sum + tx.amountUsd, 0);

    // MEV/Bot detection (simplified)
    const mevPatterns = this.detectMEVPatterns(transactions);

    // Transaction frequency
    const timeSpan =
      transactions.length > 1
        ? transactions[0].timestamp.getTime() -
          transactions[transactions.length - 1].timestamp.getTime()
        : 1;
    const transactionsPerMinute =
      timeSpan > 0 ? transactions.length / (timeSpan / 60000) : 0;
    const averageTransactionSize =
      transactions.reduce((sum, tx) => sum + tx.amountUsd, 0) /
      transactions.length;

    return {
      buySellRatio,
      buyVolume,
      sellVolume,
      totalVolume,
      buySellRatio5m,
      buySellRatio15m,
      buySellRatio1h,
      buySellRatio24h,
      largeTransactions: largeTransactions.slice(0, 10), // Top 10
      largeBuyCount: largeBuys.length,
      largeSellCount: largeSells.length,
      whaleActivity: {
        count: whaleTxs.length,
        totalVolume: whaleVolume,
        averageSize: whaleTxs.length > 0 ? whaleVolume / whaleTxs.length : 0,
      },
      mevPatterns,
      smartMoneyActivity: {
        wallets: [], // Would need wallet reputation database
        buyVolume: 0,
        sellVolume: 0,
        netPosition: 0,
      },
      transactionCount: transactions.length,
      transactionsPerMinute,
      averageTransactionSize,
      averagePriceImpact: 0, // Would need order book analysis
      highImpactTransactions: 0,
    };
  }

  /**
   * Detect MEV and bot-like patterns
   */
  private detectMEVPatterns(transactions: SwapTransaction[]): {
    detected: boolean;
    sandwichAttacks: number;
    frontRunning: number;
    botLikeBehavior: number;
    score: number;
  } {
    let sandwichAttacks = 0;
    let frontRunning = 0;
    let botLikeBehavior = 0;

    // Detect rapid buy-sell patterns (sandwich attacks)
    for (let i = 0; i < transactions.length - 2; i++) {
      const tx1 = transactions[i];
      const tx2 = transactions[i + 1];
      const tx3 = transactions[i + 2];

      // Check for sandwich: buy -> large buy -> sell (same wallet)
      if (
        tx1.wallet === tx2.wallet &&
        tx2.wallet === tx3.wallet &&
        tx1.type === 'buy' &&
        tx2.type === 'buy' &&
        tx3.type === 'sell' &&
        tx2.amountUsd > tx1.amountUsd * 2
      ) {
        const timeDiff = tx3.timestamp.getTime() - tx1.timestamp.getTime();
        if (timeDiff < 60000) {
          // Within 1 minute
          sandwichAttacks++;
        }
      }
    }

    // Detect bot-like behavior (very frequent small transactions)
    const walletTxCounts = new Map<string, number>();
    transactions.forEach((tx) => {
      walletTxCounts.set(tx.wallet, (walletTxCounts.get(tx.wallet) || 0) + 1);
    });

    walletTxCounts.forEach((count) => {
      if (count > 10) {
        // More than 10 transactions from same wallet
        botLikeBehavior++;
      }
    });

    // Calculate score (0-100)
    const score = Math.min(
      100,
      sandwichAttacks * 20 + frontRunning * 15 + botLikeBehavior * 5,
    );

    return {
      detected: score > 30,
      sandwichAttacks,
      frontRunning,
      botLikeBehavior,
      score,
    };
  }

  /**
   * Get empty analysis for when no transactions found
   */
  private getEmptyAnalysis(): TransactionAnalysis {
    return {
      buySellRatio: 0.5,
      buyVolume: 0,
      sellVolume: 0,
      totalVolume: 0,
      buySellRatio5m: 0.5,
      buySellRatio15m: 0.5,
      buySellRatio1h: 0.5,
      buySellRatio24h: 0.5,
      largeTransactions: [],
      largeBuyCount: 0,
      largeSellCount: 0,
      whaleActivity: {
        count: 0,
        totalVolume: 0,
        averageSize: 0,
      },
      mevPatterns: {
        detected: false,
        sandwichAttacks: 0,
        frontRunning: 0,
        botLikeBehavior: 0,
        score: 0,
      },
      smartMoneyActivity: {
        wallets: [],
        buyVolume: 0,
        sellVolume: 0,
        netPosition: 0,
      },
      transactionCount: 0,
      transactionsPerMinute: 0,
      averageTransactionSize: 0,
      averagePriceImpact: 0,
      highImpactTransactions: 0,
    };
  }

  /**
   * Get transactions via RPC - fetches signatures then parses transaction data
   * This method uses the pair address to get swap transactions
   */
  private async getTransactionsViaRPC(
    tokenAddress: string,
    pairAddress: string,
    limit: number,
  ): Promise<TokenTransactionData | null> {
    try {
      console.log(
        `[TransactionService] Fetching transactions via RPC for pair ${pairAddress.slice(
          0,
          8,
        )}...`,
      );
      const pairPubkey = new PublicKey(pairAddress);

      await heliusRateLimiter.checkLimit('rpc-fallback');

      // Step 1: Get transaction signatures from the pair address
      const signatures = await this.connection.getSignaturesForAddress(
        pairPubkey,
        {
          limit: Math.min(limit, 50), // RPC limit
        },
      );

      if (signatures.length === 0) {
        console.log('[TransactionService] No transactions found for pair');
        return null;
      }

      console.log(
        `[TransactionService] Found ${signatures.length} transaction signatures, parsing...`,
      );

      // Step 2: Fetch and parse actual transaction data (sample first 20 for efficiency)
      const swapTransactions: SwapTransaction[] = [];
      const parseLimit = Math.min(20, signatures.length); // Parse first 20 to save API calls

      for (let i = 0; i < parseLimit; i++) {
        try {
          await heliusRateLimiter.checkLimit('rpc-parse');

          const sig = signatures[i];
          const txResponse = await this.connection.getTransaction(
            sig.signature,
            {
              maxSupportedTransactionVersion: 0,
            },
          );

          if (txResponse && txResponse.meta) {
            const parsed = await this.parseSwapTransaction(
              {
                transaction: {
                  signatures: [sig.signature],
                  message: txResponse.transaction.message,
                },
                meta: txResponse.meta,
                blockTime: sig.blockTime,
              },
              tokenAddress,
              pairAddress,
            );

            if (parsed) {
              swapTransactions.push(parsed);
            }
          }
        } catch (error) {
          // Skip transactions that fail to parse
          continue;
        }
      }

      console.log(
        `[TransactionService] Successfully parsed ${swapTransactions.length} transactions`,
      );

      // If we couldn't parse any, create basic entries from signatures
      if (swapTransactions.length === 0) {
        console.warn(
          '[TransactionService] Could not parse transaction details, using signature data only',
        );
        const basicTxs: SwapTransaction[] = signatures
          .slice(0, 20)
          .map((sig) => ({
            signature: sig.signature,
            timestamp: new Date(sig.blockTime! * 1000),
            type: 'buy' as const, // Default - can't determine without parsing
            amountUsd: 0,
            amountTokens: 0,
            price: 0,
            wallet: '',
          }));

        const analysis = this.analyzeTransactions(basicTxs);
        return {
          tokenAddress,
          pairAddress,
          analysis,
          recentTransactions: basicTxs,
          timeRange: {
            start:
              basicTxs.length > 0
                ? basicTxs[basicTxs.length - 1].timestamp
                : new Date(),
            end: basicTxs.length > 0 ? basicTxs[0].timestamp : new Date(),
          },
        };
      }

      // Analyze parsed transactions
      const analysis = this.analyzeTransactions(swapTransactions);

      return {
        tokenAddress,
        pairAddress,
        analysis,
        recentTransactions: swapTransactions.slice(0, 20),
        timeRange: {
          start:
            swapTransactions.length > 0
              ? swapTransactions[swapTransactions.length - 1].timestamp
              : new Date(),
          end:
            swapTransactions.length > 0
              ? swapTransactions[0].timestamp
              : new Date(),
        },
      };
    } catch (error) {
      console.error('[TransactionService] RPC method failed:', error);
      return null;
    }
  }

  /**
   * Get buy/sell ratio for a token (cached)
   */
  async getBuySellRatio(tokenAddress: string): Promise<number> {
    const data = await this.getTokenTransactions(tokenAddress, 50);
    return data?.analysis.buySellRatio || 0.5;
  }
}
