/**
 * Transaction analysis types for real on-chain data
 */

export interface SwapTransaction {
  signature: string;
  timestamp: Date;
  type: 'buy' | 'sell';
  amountUsd: number;
  amountTokens: number;
  price: number;
  wallet: string;
  slippage?: number;
}

export interface TransactionAnalysis {
  // Buy/Sell Ratios
  buySellRatio: number; // 0-1, where 1 = all buys, 0 = all sells
  buyVolume: number; // USD
  sellVolume: number; // USD
  totalVolume: number; // USD

  // Time-based analysis
  buySellRatio5m: number;
  buySellRatio15m: number;
  buySellRatio1h: number;
  buySellRatio24h: number;

  // Large transactions
  largeTransactions: SwapTransaction[]; // > $5k
  largeBuyCount: number;
  largeSellCount: number;
  whaleActivity: {
    count: number;
    totalVolume: number;
    averageSize: number;
  };

  // MEV/Bot detection
  mevPatterns: {
    detected: boolean;
    sandwichAttacks: number;
    frontRunning: number;
    botLikeBehavior: number;
    score: number; // 0-100, higher = more MEV activity
  };

  // Smart money tracking
  smartMoneyActivity: {
    wallets: string[];
    buyVolume: number;
    sellVolume: number;
    netPosition: number; // positive = accumulating, negative = selling
  };

  // Transaction frequency
  transactionCount: number;
  transactionsPerMinute: number;
  averageTransactionSize: number;

  // Price impact analysis
  averagePriceImpact: number; // percentage
  highImpactTransactions: number; // transactions with >5% price impact
}

export interface TokenTransactionData {
  tokenAddress: string;
  pairAddress?: string;
  analysis: TransactionAnalysis;
  recentTransactions: SwapTransaction[];
  timeRange: {
    start: Date;
    end: Date;
  };
}
