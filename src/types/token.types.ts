// Token and holder analysis types

export interface TokenInfo {
  address: string;
  symbol?: string;
  name?: string;
  decimals: number;
  supply: number;
  marketCap?: number;
  price?: number;
  liquidity?: number;
}

export interface HolderInfo {
  address: string;
  balance: number;
  percentage: number;
  firstSeen?: Date;
  lastSeen?: Date;
  transactionCount?: number;
  buyTransactions?: TransactionInfo[];
  sellTransactions?: TransactionInfo[];
  averageHoldTime?: number; // in minutes
  isJeeter?: boolean;
  jeeterScore?: number;
  isBundle?: boolean;
}

export interface TransactionInfo {
  signature: string;
  timestamp: Date;
  type: 'buy' | 'sell';
  amount: number;
  price?: number;
}

export interface HolderAnalysis {
  totalHolders: number;
  topHolders: HolderInfo[];
  jeeterCount: number;
  jeeterPercentage: number;
  bundleCount: number;
  averageHoldTime: number;
  holderConcentration: number; // Top 10 holders percentage
  jeeterRiskScore: number; // 0-100
  buySellRatio: number;
  volumeSpikiness: number;
  riskLevel: 'Low' | 'Moderate' | 'High' | 'Critical';
  // Enhanced transaction analysis
  transactionAnalysis?: {
    buySellRatio: number;
    buySellRatio5m: number;
    buySellRatio15m: number;
    buySellRatio1h: number;
    buyVolume: number;
    sellVolume: number;
    largeBuyCount: number;
    largeSellCount: number;
    whaleActivity: {
      count: number;
      totalVolume: number;
    };
    mevDetected: boolean;
    mevScore: number;
    transactionCount: number;
    transactionsPerMinute: number;
  };
}

export interface TokenAnalysis {
  token: TokenInfo;
  holderAnalysis: HolderAnalysis;
  overallScore: number; // 0-100
  riskLevel: 'Low' | 'Moderate' | 'High' | 'Critical';
  recommendations: string[];
}

// Entry Point Analysis Types
export interface PriceDataPoint {
  timestamp: number;
  price: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  close: number;
}

export interface TechnicalIndicators {
  rsi: number; // Relative Strength Index (0-100)
  macd: {
    macd: number;
    signal: number;
    histogram: number;
  };
  supportLevels: number[]; // Price support levels
  resistanceLevels: number[]; // Price resistance levels
  currentTrend: 'Bullish' | 'Bearish' | 'Neutral';
  volumeTrend: 'Increasing' | 'Decreasing' | 'Stable';
}

export interface EntryPointAnalysis {
  currentPrice: number;
  currentMarketCap?: number;
  recommendedEntryPrice: number;
  entryPriceRange: {
    min: number;
    max: number;
    optimal: number;
  };
  entryMarketCaps?: {
    min: number;
    max: number;
    optimal: number;
  };
  stopLoss: number;
  stopLossMarketCap?: number;
  takeProfit: number[];
  takeProfitMarketCaps?: number[];
  riskRewardRatio: number;
  entryConfidence: number; // 0-100
  entrySignal: 'Strong Buy' | 'Buy' | 'Wait' | 'Avoid';
  technicalIndicators: TechnicalIndicators;
  reasoning: string[];
  bestEntryTime: 'Now' | 'Wait for Pullback' | 'Wait for Breakout';
}
