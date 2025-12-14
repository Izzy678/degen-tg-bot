import { HolderAnalysis } from '../types/token.types';
import { calculateJeeterMetrics, JeeterMetrics } from './jeeter-detector';

/**
 * Calculate overall jeeter risk score (0-100)
 * Based on the criteria provided by the user
 */
export function calculateJeeterRiskScore(
  holderAnalysis: HolderAnalysis,
  jeeterMetrics: JeeterMetrics
): number {
  let score = 0;

  // 1. Average Hold Time (0-20 points)
  if (jeeterMetrics.averageHoldTime < 5) {
    score += 20;
  } else if (jeeterMetrics.averageHoldTime < 30) {
    score += 15;
  } else if (jeeterMetrics.averageHoldTime < 60) {
    score += 10;
  } else if (jeeterMetrics.averageHoldTime < 120) {
    score += 5;
  }

  // 2. Round-Tripper Percentage (0-20 points)
  if (jeeterMetrics.roundTripperPercentage > 60) {
    score += 20;
  } else if (jeeterMetrics.roundTripperPercentage > 40) {
    score += 15;
  } else if (jeeterMetrics.roundTripperPercentage > 20) {
    score += 10;
  } else if (jeeterMetrics.roundTripperPercentage > 10) {
    score += 5;
  }

  // 3. Bot-Like Patterns (0-15 points)
  const botPercentage = (jeeterMetrics.botLikePatterns / holderAnalysis.totalHolders) * 100;
  if (botPercentage > 20) {
    score += 15;
  } else if (botPercentage > 10) {
    score += 10;
  } else if (botPercentage > 5) {
    score += 5;
  }

  // 4. Sell Velocity (Top wallet sell speed) (0-15 points)
  if (jeeterMetrics.sellVelocity > 70) {
    score += 15;
  } else if (jeeterMetrics.sellVelocity > 50) {
    score += 12;
  } else if (jeeterMetrics.sellVelocity > 30) {
    score += 8;
  } else if (jeeterMetrics.sellVelocity > 15) {
    score += 4;
  }

  // 5. Holder Concentration (0-15 points)
  if (holderAnalysis.holderConcentration > 50) {
    score += 15;
  } else if (holderAnalysis.holderConcentration > 30) {
    score += 12;
  } else if (holderAnalysis.holderConcentration > 20) {
    score += 8;
  } else if (holderAnalysis.holderConcentration > 10) {
    score += 4;
  }

  // 6. Churn Rate (0-10 points)
  if (jeeterMetrics.churnRate > 60) {
    score += 10;
  } else if (jeeterMetrics.churnRate > 40) {
    score += 7;
  } else if (jeeterMetrics.churnRate > 20) {
    score += 4;
  } else if (jeeterMetrics.churnRate > 10) {
    score += 2;
  }

  // 7. Buy/Sell Ratio (0-5 points)
  // Lower ratio = more sells = jeeter environment
  if (holderAnalysis.buySellRatio < 0.25) {
    score += 5;
  } else if (holderAnalysis.buySellRatio < 0.4) {
    score += 3;
  } else if (holderAnalysis.buySellRatio < 0.6) {
    score += 1;
  }

  return Math.min(100, Math.round(score));
}

/**
 * Determine risk level based on jeeter risk score
 */
export function getRiskLevel(jeeterRiskScore: number): 'Low' | 'Moderate' | 'High' | 'Critical' {
  if (jeeterRiskScore >= 80) {
    return 'Critical';
  } else if (jeeterRiskScore >= 50) {
    return 'High';
  } else if (jeeterRiskScore >= 20) {
    return 'Moderate';
  } else {
    return 'Low';
  }
}

/**
 * Calculate overall token score (0-100)
 * Higher score = better investment opportunity
 */
export function calculateOverallScore(holderAnalysis: HolderAnalysis): number {
  let score = 100;

  // Deduct points based on jeeter risk
  score -= holderAnalysis.jeeterRiskScore * 0.5; // Jeeter risk heavily impacts score

  // Deduct for high holder concentration
  if (holderAnalysis.holderConcentration > 30) {
    score -= 20;
  } else if (holderAnalysis.holderConcentration > 20) {
    score -= 10;
  }

  // Deduct for high jeeter percentage
  if (holderAnalysis.jeeterPercentage > 50) {
    score -= 15;
  } else if (holderAnalysis.jeeterPercentage > 30) {
    score -= 10;
  } else if (holderAnalysis.jeeterPercentage > 15) {
    score -= 5;
  }

  // Bonus for healthy holder distribution
  if (holderAnalysis.holderConcentration < 10 && holderAnalysis.jeeterPercentage < 10) {
    score += 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Generate recommendations based on analysis
 */
export function generateRecommendations(holderAnalysis: HolderAnalysis): string[] {
  const recommendations: string[] = [];

  if (holderAnalysis.jeeterRiskScore >= 80) {
    recommendations.push('⚠️ CRITICAL: Extreme jeeter activity detected. High risk of price manipulation.');
    recommendations.push('🚫 Avoid this token - likely to be heavily scalped.');
  } else if (holderAnalysis.jeeterRiskScore >= 50) {
    recommendations.push('⚠️ High jeeter activity. Be cautious with entry timing.');
    recommendations.push('💡 Consider waiting for jeeter activity to decrease.');
  } else if (holderAnalysis.jeeterRiskScore >= 20) {
    recommendations.push('⚡ Moderate jeeter presence. Monitor holder behavior.');
  }

  if (holderAnalysis.holderConcentration > 50) {
    recommendations.push('⚠️ Top 10 holders control >50% of supply. High centralization risk.');
  } else if (holderAnalysis.holderConcentration > 30) {
    recommendations.push('⚠️ Top 10 holders control >30% of supply. Monitor for dumps.');
  }

  if (holderAnalysis.bundleCount > 0) {
    recommendations.push(`⚠️ ${holderAnalysis.bundleCount} bundle groups detected. Possible coordinated activity.`);
  }

  if (holderAnalysis.averageHoldTime < 30) {
    recommendations.push('⚠️ Very low average hold time. Token may lack sticky holders.');
  }

  if (holderAnalysis.buySellRatio < 0.4) {
    recommendations.push('⚠️ Sell pressure is dominant. Wait for buying pressure to increase.');
  }

  if (holderAnalysis.jeeterRiskScore < 20 && holderAnalysis.holderConcentration < 20) {
    recommendations.push('✅ Healthy holder distribution with low jeeter activity.');
    recommendations.push('✅ Consider this token for longer-term holds.');
  }

  return recommendations;
}

