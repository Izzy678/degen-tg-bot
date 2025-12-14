import { HolderInfo } from '../types/token.types';

/**
 * Wallet Quality Analyzer
 * Classifies wallets into categories: snipers, jeeters, weak hands, strong hands, whales, MEV bots
 */
export type WalletCategory =
  | 'sniper'
  | 'jeeter'
  | 'weak_hands'
  | 'strong_hands'
  | 'whale'
  | 'mev_bot'
  | 'router_arbitrage_bot'
  | 'unknown';

export interface WalletQualityScore {
  category: WalletCategory;
  score: number; // 0-100, higher = better quality
  confidence: number; // 0-100, how confident we are in classification
  reasons: string[];
}

export interface WalletQualityAnalysis {
  walletScores: Map<string, WalletQualityScore>;
  categoryDistribution: Map<WalletCategory, number>;
  averageHoldTime: number;
  averageSellBuyRatio: number;
  highQualityWalletCount: number;
  jeeterDominance: boolean;
  sniperDominance: boolean;
  overallQualityScore: number; // 0-100
}

export class WalletQualityAnalyzer {
  /**
   * Analyze wallet quality for all holders
   */
  analyze(holders: HolderInfo[]): WalletQualityAnalysis {
    const walletScores = new Map<string, WalletQualityScore>();
    const categoryDistribution = new Map<WalletCategory, number>();

    // Initialize category counts
    const categories: WalletCategory[] = [
      'sniper',
      'jeeter',
      'weak_hands',
      'strong_hands',
      'whale',
      'mev_bot',
      'router_arbitrage_bot',
      'unknown',
    ];
    categories.forEach((cat) => categoryDistribution.set(cat, 0));

    // Analyze each wallet
    for (const holder of holders) {
      const score = this.classifyWallet(holder);
      walletScores.set(holder.address, score);
      const currentCount = categoryDistribution.get(score.category) || 0;
      categoryDistribution.set(score.category, currentCount + 1);
    }

    // Handle empty holders case
    if (holders.length === 0) {
      return {
        walletScores,
        categoryDistribution,
        averageHoldTime: 0,
        averageSellBuyRatio: 0,
        highQualityWalletCount: 0,
        jeeterDominance: false,
        sniperDominance: false,
        overallQualityScore: 0, // No holders = cannot assess quality
      };
    }

    // Calculate aggregate metrics
    const averageHoldTime =
      holders.reduce((sum, h) => sum + (h.averageHoldTime || 0), 0) /
      holders.length;

    const sellBuyRatios = holders
      .filter((h) => h.sellTransactions && h.buyTransactions)
      .map((h) => {
        const sellCount = h.sellTransactions?.length || 0;
        const buyCount = h.buyTransactions?.length || 1;
        return sellCount / buyCount;
      });
    const averageSellBuyRatio =
      sellBuyRatios.length > 0
        ? sellBuyRatios.reduce((sum, r) => sum + r, 0) / sellBuyRatios.length
        : 0;

    // Count high quality wallets (strong hands + whales)
    const highQualityWallets = Array.from(walletScores.values()).filter(
      (s) => s.category === 'strong_hands' || s.category === 'whale',
    ).length;

    // Check dominance
    const jeeterCount = categoryDistribution.get('jeeter') || 0;
    const sniperCount = categoryDistribution.get('sniper') || 0;
    const totalWallets = holders.length;
    const jeeterDominance =
      totalWallets > 0 && jeeterCount / totalWallets > 0.4;
    const sniperDominance =
      totalWallets > 0 && sniperCount / totalWallets > 0.3;

    // Overall quality score (higher = better wallet composition)
    const strongHandsCount = categoryDistribution.get('strong_hands') || 0;
    const whaleCount = categoryDistribution.get('whale') || 0;
    const overallQualityScore =
      totalWallets > 0
        ? ((strongHandsCount + whaleCount) / totalWallets) * 100 -
          (jeeterCount / totalWallets) * 50 -
          (sniperCount / totalWallets) * 30
        : 0;

    return {
      walletScores,
      categoryDistribution,
      averageHoldTime,
      averageSellBuyRatio,
      highQualityWalletCount: highQualityWallets,
      jeeterDominance,
      sniperDominance,
      overallQualityScore: Math.max(0, Math.min(100, overallQualityScore)),
    };
  }

  /**
   * Classify a single wallet
   */
  private classifyWallet(holder: HolderInfo): WalletQualityScore {
    const reasons: string[] = [];
    let score = 50; // Base score
    let category: WalletCategory = 'unknown';
    let confidence = 0;

    // 1. Check for sniper patterns
    if (this.isSniper(holder)) {
      category = 'sniper';
      score = 20;
      confidence = 70;
      reasons.push('Sniper pattern detected');
      return { category, score, confidence, reasons };
    }

    // 2. Check for jeeter patterns
    if (holder.isJeeter || (holder.jeeterScore && holder.jeeterScore > 50)) {
      category = 'jeeter';
      score = 10;
      confidence = 80;
      reasons.push('Jeeter behavior detected');
      return { category, score, confidence, reasons };
    }

    // 3. Check for MEV bot patterns
    if (this.isMEVBot(holder)) {
      category = 'mev_bot';
      score = 15;
      confidence = 60;
      reasons.push('MEV bot pattern detected');
      return { category, score, confidence, reasons };
    }

    // 4. Check for whale (large holder)
    if (holder.percentage > 5) {
      category = 'whale';
      score = 70;
      confidence = 80;
      reasons.push(`Large holder (${holder.percentage.toFixed(2)}%)`);

      // Adjust based on behavior
      if (holder.averageHoldTime && holder.averageHoldTime > 60) {
        score = 85; // Whale holding long = very bullish
        reasons.push('Long hold time');
      } else if (holder.averageHoldTime && holder.averageHoldTime < 10) {
        score = 40; // Whale dumping fast = bearish
        reasons.push('Quick exits');
      }

      return { category, score, confidence, reasons };
    }

    // 5. Check for strong hands
    if (this.isStrongHands(holder)) {
      category = 'strong_hands';
      score = 80;
      confidence = 75;
      reasons.push('Strong hands pattern');
      return { category, score, confidence, reasons };
    }

    // 6. Check for weak hands
    if (this.isWeakHands(holder)) {
      category = 'weak_hands';
      score = 30;
      confidence = 70;
      reasons.push('Weak hands pattern');
      return { category, score, confidence, reasons };
    }

    // Default: unknown
    return { category, score, confidence: 30, reasons: ['Insufficient data'] };
  }

  /**
   * Detect sniper patterns
   * Snipers: Enter very early, exit quickly, high frequency trading
   */
  private isSniper(holder: HolderInfo): boolean {
    // Very short hold time (<5 min) + high transaction count
    if (
      holder.averageHoldTime !== undefined &&
      holder.averageHoldTime < 5 &&
      holder.transactionCount &&
      holder.transactionCount > 10
    ) {
      return true;
    }

    // Multiple quick round trips
    if (holder.buyTransactions && holder.sellTransactions) {
      const quickRoundTrips = holder.buyTransactions.filter((buy) => {
        const quickSell = holder.sellTransactions?.find(
          (sell) =>
            sell.timestamp.getTime() > buy.timestamp.getTime() &&
            sell.timestamp.getTime() - buy.timestamp.getTime() < 2 * 60 * 1000, // <2 min
        );
        return !!quickSell;
      });
      if (quickRoundTrips.length > 3) {
        return true;
      }
    }

    return false;
  }

  /**
   * Detect MEV bot patterns
   */
  private isMEVBot(holder: HolderInfo): boolean {
    // Very high transaction frequency
    if (holder.transactionCount && holder.transactionCount > 50) {
      return true;
    }

    // Consistent small transactions
    if (
      holder.buyTransactions &&
      holder.buyTransactions.length > 20 &&
      holder.averageHoldTime !== undefined &&
      holder.averageHoldTime < 1
    ) {
      return true;
    }

    return false;
  }

  /**
   * Detect strong hands (diamond hands)
   */
  private isStrongHands(holder: HolderInfo): boolean {
    // Long hold time (>2 hours) + low sell ratio
    if (
      holder.averageHoldTime !== undefined &&
      holder.averageHoldTime > 120 &&
      holder.sellTransactions &&
      holder.buyTransactions
    ) {
      const sellCount = holder.sellTransactions.length;
      const buyCount = holder.buyTransactions.length;
      if (sellCount / buyCount < 0.3) {
        return true;
      }
    }

    // Holding through volatility without selling
    if (
      holder.averageHoldTime !== undefined &&
      holder.averageHoldTime > 60 &&
      (!holder.sellTransactions || holder.sellTransactions.length === 0)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Detect weak hands
   */
  private isWeakHands(holder: HolderInfo): boolean {
    // Short hold time + high sell ratio
    if (
      holder.averageHoldTime !== undefined &&
      holder.averageHoldTime < 30 &&
      holder.sellTransactions &&
      holder.buyTransactions
    ) {
      const sellCount = holder.sellTransactions.length;
      const buyCount = holder.buyTransactions.length;
      if (sellCount / buyCount > 0.7) {
        return true;
      }
    }

    return false;
  }
}
