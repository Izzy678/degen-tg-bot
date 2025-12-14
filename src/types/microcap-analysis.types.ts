/**
 * Microcap Analysis Types
 * Output format for microcap-specific analysis
 */

export interface MicrocapAnalysisResult {
  score: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high';
  isJeeterDominated: boolean;
  entryRecommendation: 'avoid' | 'cautious' | 'good' | 'strong';
  signals: {
    sellerExhaustion: {
      exhaustionScore: number;
      isBottomSignal: boolean;
      signals: string[];
    };
    walletQuality: {
      overallQualityScore: number;
      highQualityWalletCount: number;
      jeeterDominance: boolean;
      sniperDominance: boolean;
      categoryDistribution: Record<string, number>;
    };
    sniperDetection: {
      sniperCount: number;
      sniperPercentage: number;
      isSniperHeavy: boolean;
    };
    lpHealth: {
      healthScore: number;
      isHealthy: boolean;
      liquidityAmount: number;
      lpRatio: number;
      risks: string[];
    };
    volatility: {
      currentVolatility: number;
      volatilityTrend: number;
      isCompressed: boolean;
    };
    whaleActivity: {
      whaleCount: number;
      whaleAccumulation: boolean;
      whaleDistribution: boolean;
    };
    jeeterFlags: string[];
  };
  debug: {
    reasoning: string[];
  };
}
