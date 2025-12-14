/**
 * Safety Filter Analyzer
 * Hard filters that reject unsafe/scam tokens
 * These are binary pass/fail checks - no scoring
 */

import { TokenInfo } from '../types/token.types';
import { HolderAnalysis } from '../types/token.types';
import { LPHealthSignals } from './lp-health.analyzer';
import { JeeterZoneFlags } from './jeeter-zone.detector';
import { WalletQualityAnalysis } from './wallet-quality.analyzer';

export interface SafetyFilterResult {
  passed: boolean;
  failedChecks: string[];
  warnings: string[];
  details: {
    lpLocked: boolean;
    lpHealthy: boolean;
    renounced: boolean | null; // null = unknown
    honeypot: boolean;
    hasBlacklist: boolean | null; // null = unknown (would need contract analysis)
    mintAbuse: boolean;
    feeAbuse: boolean;
    scamPatterns: boolean;
    cleanContract: boolean | null; // null = unknown
    safeTokenomics: boolean;
  };
}

export class SafetyFilterAnalyzer {
  /**
   * Analyze token safety - hard filters that reject unsafe tokens
   */
  analyze(
    tokenInfo: TokenInfo,
    holderAnalysis: HolderAnalysis,
    lpHealth: LPHealthSignals,
    jeeterFlags: JeeterZoneFlags,
    walletQuality?: WalletQualityAnalysis,
  ): SafetyFilterResult {
    const failedChecks: string[] = [];
    const warnings: string[] = [];
    const details: SafetyFilterResult['details'] = {
      lpLocked: false,
      lpHealthy: false,
      renounced: null,
      honeypot: false,
      hasBlacklist: null,
      mintAbuse: false,
      feeAbuse: false,
      scamPatterns: false,
      cleanContract: null,
      safeTokenomics: false,
    };

    // 1. LP Locked + Healthy
    details.lpHealthy = lpHealth.isHealthy && lpHealth.healthScore >= 70;
    // Note: LP lock status would need on-chain verification
    // For now, we check if LP is healthy and stable
    details.lpLocked = lpHealth.isHealthy && lpHealth.liquidityAmount > 0;
    
    if (!details.lpLocked) {
      failedChecks.push('LP not locked or unhealthy');
    }
    if (!details.lpHealthy) {
      failedChecks.push('LP health score too low');
    }

    // 2. Not renounced too early
    // This would require checking when ownership was renounced
    // For now, we check if token is very new (< 1 hour) and has suspicious patterns
    details.renounced = null; // Would need contract analysis

    // 3. Not a honeypot
    // Check for honeypot patterns:
    // - Very high sell tax
    // - Can't sell (would need transaction analysis)
    // - Suspicious holder distribution
    const suspiciousHolderPattern =
      holderAnalysis.jeeterPercentage > 60 ||
      holderAnalysis.holderConcentration > 80;
    
    details.honeypot = suspiciousHolderPattern;
    if (details.honeypot) {
      failedChecks.push('Honeypot patterns detected');
    }

    // 4. No blacklist functions
    // Would need contract analysis - mark as unknown for now
    details.hasBlacklist = null;

    // 5. No mint abuse
    // Check if supply is increasing unexpectedly
    // For now, check if supply is reasonable
    const supply = tokenInfo.supply || 0;
    const maxSupply = 1e12; // Reasonable max supply
    details.mintAbuse = supply > maxSupply;
    if (details.mintAbuse) {
      failedChecks.push('Potential mint abuse (supply too high)');
    }

    // 6. No fee abuse
    // Check for excessive fees (would need contract analysis)
    // For now, check if price movements are suspicious
    details.feeAbuse = false; // Would need contract analysis

    // 7. No scam patterns
    // Check for common scam indicators:
    // - Jeeter zone
    // - High sniper/jeeter dominance
    // - High jeeter risk
    // - Suspicious transaction patterns
    const hasSniperDominance = walletQuality?.sniperDominance || false;
    details.scamPatterns =
      jeeterFlags.isJeeterZone ||
      hasSniperDominance ||
      holderAnalysis.jeeterRiskScore > 70;
    
    if (details.scamPatterns) {
      failedChecks.push('Scam patterns detected');
    }

    // 8. Clean contract
    // Would need contract analysis - mark as unknown
    details.cleanContract = null;

    // 9. Safe tokenomics
    // Check for reasonable tokenomics:
    // - Not too concentrated
    // - Reasonable holder distribution
    // - Not all jeeters
    const hasReasonableDistribution =
      holderAnalysis.holderConcentration < 60 &&
      holderAnalysis.jeeterPercentage < 50 &&
      holderAnalysis.totalHolders >= 20;
    
    details.safeTokenomics = hasReasonableDistribution;
    if (!details.safeTokenomics) {
      failedChecks.push('Unsafe tokenomics (too concentrated or jeeter-heavy)');
    }

    // Overall pass/fail
    const passed = failedChecks.length === 0;

    return {
      passed,
      failedChecks,
      warnings,
      details,
    };
  }
}

