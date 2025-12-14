import { TokenInfo } from '../types/token.types';

/**
 * LP Health Analyzer
 * Analyzes liquidity pool health and stability
 */
export interface LPHealthSignals {
  liquidityAmount: number;
  liquidityStability: 'stable' | 'decreasing' | 'increasing' | 'volatile';
  lpRatio: number; // LP / Market Cap ratio
  isHealthy: boolean;
  healthScore: number; // 0-100
  risks: string[];
}

export class LPHealthAnalyzer {
  /**
   * Analyze LP health
   */
  analyze(tokenInfo: TokenInfo): LPHealthSignals {
    const liquidity = tokenInfo.liquidity || 0;
    const marketCap = tokenInfo.marketCap || 0;

    const signals: LPHealthSignals = {
      liquidityAmount: liquidity,
      liquidityStability: 'stable', // Would need historical data for real analysis
      lpRatio: marketCap > 0 ? liquidity / marketCap : 0,
      isHealthy: false,
      healthScore: 0,
      risks: [],
    };

    // Calculate health score
    let score = 100;

    // 1. Absolute liquidity amount
    if (liquidity < 5000) {
      signals.risks.push('LP too thin (<$5k)');
      score -= 40;
    } else if (liquidity < 10000) {
      signals.risks.push('LP low (<$10k)');
      score -= 20;
    } else if (liquidity < 50000) {
      signals.risks.push('LP moderate');
      score -= 10;
    }

    // 2. LP to Market Cap ratio
    // Healthy ratio: LP should be 10-30% of market cap
    if (signals.lpRatio > 0) {
      if (signals.lpRatio < 0.05) {
        signals.risks.push('LP/MC ratio too low (<5%)');
        score -= 30;
      } else if (signals.lpRatio < 0.1) {
        signals.risks.push('LP/MC ratio low (<10%)');
        score -= 15;
      } else if (signals.lpRatio > 0.5) {
        signals.risks.push('LP/MC ratio suspiciously high (>50%)');
        score -= 10;
      }
    }

    // 3. Market cap without liquidity (red flag)
    if (marketCap > 0 && liquidity === 0) {
      signals.risks.push('No liquidity detected');
      score = 0;
    }

    signals.healthScore = Math.max(0, Math.min(100, score));
    signals.isHealthy = signals.healthScore >= 60;

    return signals;
  }
}
