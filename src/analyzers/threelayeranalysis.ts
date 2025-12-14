// threeLayerAnalysis.ts
/**
 * 3-Layer Solana Microcap Analysis Engine
 * Layer 1: MicrostructureEngine (5s–60s windows)
 * Layer 2: StructuralHealthEngine (wallets, LP, MEV)
 * Layer 3: OutcomePredictor (combines signals -> entry/trap scores)
 *
 * All functions are pure where possible and easily unit-testable.
 * Tune `PARAMS` to fit your environment / sampling cadence.
 */

import { JeeterZoneFlags, JeeterZoneDetector } from './jeeter-zone.detector';
import { LPHealthSignals, LPHealthAnalyzer } from './lp-health.analyzer';
import {
  SellerExhaustionSignals,
  SellerExhaustionAnalyzer,
} from './seller-exhaustion.analyzer';
import {
  WalletQualityAnalysis,
  WalletQualityAnalyzer,
} from './wallet-quality.analyzer';
import { HolderInfo, TokenInfo } from '../types/token.types';
import { TransactionAnalysis } from '../types/transaction.types';

/* ============================
  Interfaces / Types (adapt to your actual shapes)
   ============================ */

// Note: Using types from ../types/token.types.ts and ../types/transaction.types.ts
// Local type aliases for backward compatibility if needed
type LocalTransactionAnalysis = TransactionAnalysis;
type LocalHolderInfo = HolderInfo;
type LocalTokenInfo = TokenInfo;

/* ============================
    Tunable params
     ============================ */
const PARAMS = {
  // micro windows (in seconds)
  windows: {
    fast: 5,
    short: 15,
    medium: 60,
  },

  // thresholds
  thresholds: {
    buySellRatioStrong: 0.6,
    buySellRatioWeak: 0.35,
    volatilityCollapseStdDev: 0.03, // e.g., <3% per sample = tight
    volatilityCompressionPct: -0.15, // -15% change in volatility => collapse
    exhaustionScoreBottom: 60,
    jeeterRiskScore: 50,
    lpThinUSD: 5000,
    lpLowUSD: 10000,
    sniperDominancePct: 0.3,
    jeeterDominancePct: 0.4,
  },

  // weights for outcome predictor
  weights: {
    microstructure: 0.45,
    structural: 0.45,
    volatility: 0.1,
  },
};

/* ============================
    Utility functions
     ============================ */

/** safe percent difference (a-b)/a */
function pctDiff(a: number, b: number): number {
  if (!a) return 0;
  return (b - a) / Math.abs(a);
}

/** standard deviation of relative price changes */
function stdDevRelativeChanges(prices: number[]): number {
  if (prices.length < 2) return 0;
  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const change = (prices[i] - prices[i - 1]) / Math.max(1e-12, prices[i - 1]);
    changes.push(change);
  }
  const mean = changes.reduce((s, v) => s + v, 0) / changes.length;
  const variance =
    changes.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / changes.length;
  return Math.sqrt(variance);
}

/* ============================
    Layer 1: MicrostructureEngine
      - very short windows (5s-60s)
      - momentum, delta volumes, volatility compression,
        bot activity collapse / tx rate changes, LP micro-changes
     ============================ */

export interface MicrostructureSignals {
  momentum5s: number;
  momentum15s: number;
  momentum60s: number;
  buySellDelta5s: number;
  buySellDelta15s: number;
  buySellDelta60s: number;
  volatilityStdDevRecent: number;
  volatilityTrendPct: number; // negative = compression
  botActivityIndex: number; // 0-100, higher = bots active
  liquidityVelocity: number; // -inf..inf: (lpNow - lp30s)/lp30s
  microScore: number; // 0-100 composite microstructural score (higher = bottom-likely)
  reasons: string[];
}

/**
 * computeMicrostructureSignals
 * - prices: array of {price, timestamp} ordered ascending by time
 * - tx: TransactionAnalysis aggregated per provided intervals
 * - tokenInfo: for LP micro snapshots if available
 */
export function computeMicrostructureSignals(
  prices: Array<{ price: number; timestamp: number }>,
  tx: TransactionAnalysis,
  tokenInfo?: TokenInfo,
): MicrostructureSignals {
  const reasons: string[] = [];

  // compute momentums: use last N samples depending on window size
  const pricesOnly = prices.map((p) => p.price);
  const lastN = (n: number) =>
    pricesOnly.length >= n ? pricesOnly.slice(-n) : pricesOnly.slice(0);

  // Simple momentum: lastPrice / earlierPrice - 1
  // Clamp to reasonable range to avoid extreme values
  const momentum = (samples: number[]) => {
    if (samples.length < 2) return 0;
    const last = samples[samples.length - 1];
    const first = samples[0];
    if (first === 0 || Math.abs(first) < 1e-12) return 0; // Avoid division by zero
    const result = (last - first) / first;
    // Clamp to reasonable range (-10 to 10, i.e., -1000% to 1000%)
    return Math.max(-10, Math.min(10, result));
  };

  const m5 = momentum(lastN(Math.max(2, Math.min(5, pricesOnly.length))));
  const m15 = momentum(lastN(Math.max(3, Math.min(15, pricesOnly.length))));
  const m60 = momentum(lastN(Math.max(5, Math.min(60, pricesOnly.length))));

  // buy/sell deltas (fast -> medium)
  // Note: TransactionAnalysis uses 5m, 15m, 1h intervals, not seconds
  // Approximate: 5m ≈ 5s for micro analysis, 15m ≈ 15s, 1h ≈ 60s
  const bsr5 = tx.buySellRatio5m ?? tx.buySellRatio ?? 0.5;
  const bsr15 = tx.buySellRatio15m ?? tx.buySellRatio ?? 0.5;
  const bsr60 = tx.buySellRatio1h ?? tx.buySellRatio ?? 0.5;

  const buySellDelta5s = bsr5 - bsr15;
  const buySellDelta15s = bsr15 - bsr60;
  const buySellDelta60s = bsr60 - (tx.buySellRatio ?? 0.5);

  // volatility recent & trend
  // Clamp volatility to reasonable range to avoid extreme values
  const clampVolatility = (vol: number) => {
    // Clamp to 0-10 (0% to 1000% max)
    return Math.max(0, Math.min(10, vol));
  };

  const volatilityStdDevRecent = clampVolatility(
    stdDevRelativeChanges(pricesOnly.slice(-30)),
  ); // last ~N samples
  const earlier =
    pricesOnly.length > 60
      ? pricesOnly.slice(-60, -30)
      : pricesOnly.slice(0, -30);
  const earlierVol = clampVolatility(stdDevRelativeChanges(earlier));
  const volatilityTrendPct =
    earlierVol === 0
      ? 0
      : Math.max(
          -1,
          Math.min(
            1,
            (volatilityStdDevRecent - earlierVol) / Math.max(earlierVol, 0.01),
          ),
        );

  // bot activity index heuristic
  // high tx/min & many tiny txs => high bot index
  const txPerMin = tx.transactionsPerMinute ?? 0;
  const avgTxSize = tx.averageTransactionSize ?? 0;
  // normalize into 0-100
  const botActivityIndex = Math.min(
    100,
    Math.round(
      Math.max(
        0,
        (txPerMin / 30) * 50 + // more tx/min -> higher score (30 tx/min -> 50)
          (avgTxSize < 100 ? 25 : 0) + // small avg tx size -> bot-like
          (tx.mevPatterns.detected ? Math.min(tx.mevPatterns.score, 25) : 0),
      ),
    ),
  );

  // LP micro-velocity if provided
  // Note: TokenInfo doesn't have lpNow/lpLast30s, using current liquidity only
  let liquidityVelocity = 0;
  // For micro LP velocity, we would need historical LP data
  // For now, skip this check or implement LP tracking separately
  // if (tokenInfo && tokenInfo.liquidity) {
  //   // Would need historical LP data to calculate velocity
  // }

  // Composite micro score: we want high score when:
  // - buySellDelta improves (buyers returning)
  // - momentum down but decelerating (momentum negative but m15 > m60)
  // - volatility compression (volatilityTrendPct negative)
  // - botActivity low
  // - liquidityVelocity stabilizing or positive
  let microScore = 50;

  // buy/sell delta effect
  microScore += Math.max(-20, Math.min(20, Math.round(buySellDelta15s * 100))); // -20..+20

  // momentum effect: negative momentum but decelerating = good (towards bottom)
  const momentumDeceleration = (m15 - m60) * 100;
  microScore += Math.max(
    -15,
    Math.min(15, Math.round(-m60 * 50 + momentumDeceleration)),
  );

  // volatility compression
  if (volatilityTrendPct < PARAMS.thresholds.volatilityCompressionPct) {
    microScore += 15;
    reasons.push('Volatility compression detected');
  } else if (
    volatilityStdDevRecent < PARAMS.thresholds.volatilityCollapseStdDev
  ) {
    microScore += 10;
    reasons.push('Low recent volatility');
  } else {
    microScore -= 10;
  }

  // bot activity penalize
  microScore -= Math.round((botActivityIndex / 100) * 20);

  // liquidity velocity adjust
  microScore += Math.max(
    -10,
    Math.min(10, Math.round(liquidityVelocity * 100)),
  );

  // clamp
  microScore = Math.max(0, Math.min(100, Math.round(microScore)));

  // Reasons for debug
  if (buySellDelta15s > 0.05)
    reasons.push('Buy pressure increasing on short window');
  if (buySellDelta15s < -0.05)
    reasons.push('Buy pressure falling on short window');

  return {
    momentum5s: m5,
    momentum15s: m15,
    momentum60s: m60,
    buySellDelta5s,
    buySellDelta15s,
    buySellDelta60s,
    volatilityStdDevRecent,
    volatilityTrendPct,
    botActivityIndex,
    liquidityVelocity,
    microScore,
    reasons,
  };
}

/* ============================
    Layer 2: StructuralHealthEngine
      - wallet composition, LP health, MEV, sniper/jeeter dominance
     ============================ */

export interface StructuralSignals {
  walletQualityAnalysis: WalletQualityAnalysis;
  lpHealthSignals: LPHealthSignals;
  sellerExhaustion: SellerExhaustionSignals;
  jeeterFlags: JeeterZoneFlags;
  structuralScore: number; // 0-100 higher = healthier / bottom-likely
  reasons: string[];
}

/* Reuse your earlier analyzers as pure functions or keep them as classes.
     For brevity, I provide simplified wiring functions that call your implementations.
     Assume: WalletQualityAnalyzer, LPHealthAnalyzer, SellerExhaustionAnalyzer, JeeterZoneDetector exist and are imported.
  */

/**
 * computeStructuralSignals
 */
export function computeStructuralSignals(
  holders: HolderInfo[],
  tx: TransactionAnalysis,
  tokenInfo: TokenInfo,
  priceHistory: Array<{ price: number; timestamp: number }> = [],
): StructuralSignals {
  const reasons: string[] = [];

  const walletAnalyzer = new WalletQualityAnalyzer();
  const walletQuality = walletAnalyzer.analyze(holders);

  const lpAnalyzer = new LPHealthAnalyzer();
  const lpSignals = lpAnalyzer.analyze(tokenInfo);

  const sellerExhaustionAnalyzer = new SellerExhaustionAnalyzer();
  const exhaustionSignals = sellerExhaustionAnalyzer.analyze(tx, priceHistory);

  const jeeterDetector = new JeeterZoneDetector();
  const jeeterFlags = jeeterDetector.detect(tx, walletQuality, tokenInfo);

  // Structural score composition
  // Handle NaN values by using fallbacks
  const walletQualityScore = isNaN(walletQuality.overallQualityScore)
    ? 0
    : walletQuality.overallQualityScore;
  const lpHealthScore = isNaN(lpSignals.healthScore)
    ? 0
    : lpSignals.healthScore;
  const exhaustionScore = isNaN(exhaustionSignals.exhaustionScore)
    ? 0
    : exhaustionSignals.exhaustionScore;
  const jeeterRiskScore = isNaN(jeeterFlags.riskScore)
    ? 0
    : jeeterFlags.riskScore;

  let structuralScore = 50;
  structuralScore += walletQualityScore * 0.3; // wallet quality matters a lot
  structuralScore += lpHealthScore * 0.3;
  structuralScore += exhaustionScore * 0.25;
  structuralScore -= jeeterRiskScore * 0.4; // penalize heavy jeeter risk

  // normalize and clamp
  structuralScore = Math.max(0, Math.min(100, Math.round(structuralScore)));

  if (jeeterFlags.isJeeterZone) reasons.push('Jeeter zone detected');
  if (!lpSignals.isHealthy) reasons.push('LP health low');
  if (exhaustionSignals.isBottomSignal)
    reasons.push('Seller exhaustion bottom signal');

  return {
    walletQualityAnalysis: walletQuality,
    lpHealthSignals: lpSignals,
    sellerExhaustion: exhaustionSignals,
    jeeterFlags,
    structuralScore,
    reasons,
  };
}

/* ============================
    Layer 3: OutcomePredictor
      - combine microstructure + structural + volatility cues
      - produce final entry/trap decision, entry zone, expected dip depth, confidence
     ============================ */

export interface Outcome {
  isDipOpportunity: boolean;
  isDipTrap: boolean;
  dipConfidence: number; // 0-100
  expectedDipDepthPct: number; // percent
  entryZone: { min: number; max: number; optimal: number };
  combinedScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high';
  debug: string[];
}

/**
 * combineSignals -> Outcome
 */
export function predictOutcome(
  currentPrice: number,
  micro: MicrostructureSignals,
  structural: StructuralSignals,
): Outcome {
  const debug: string[] = [];

  // combined score weighted
  // Handle NaN values with fallbacks
  const microScore = isNaN(micro.microScore) ? 0 : micro.microScore;
  const structuralScore = isNaN(structural.structuralScore)
    ? 0
    : structural.structuralScore;
  const volatilityTrendPct = isNaN(micro.volatilityTrendPct)
    ? 0
    : micro.volatilityTrendPct;

  const combinedScoreRaw =
    microScore * PARAMS.weights.microstructure +
    structuralScore * PARAMS.weights.structural +
    Math.max(0, (1 - Math.abs(volatilityTrendPct)) * 100) *
      PARAMS.weights.volatility;

  const combinedScore = isNaN(combinedScoreRaw)
    ? 0
    : Math.max(0, Math.min(100, Math.round(combinedScoreRaw)));

  debug.push(`microScore=${microScore}, structural=${structuralScore}`);
  debug.push(`combinedScoreRaw=${combinedScoreRaw}`);

  // simple decision thresholds (tuneable)
  const isJeeter = structural.jeeterFlags.isJeeterZone;
  const microGood = microScore >= 60;
  const structuralGood = structuralScore >= 55;

  let isDipOpportunity = false;
  let isDipTrap = false;
  let dipConfidence = combinedScore; // Already validated above
  let expectedDipDepthPct = 0;
  let entryZone = {
    min: currentPrice * 0.95,
    max: currentPrice * 1.02,
    optimal: currentPrice * 0.99,
  };

  // High-level logic:
  // - If jeeter zone -> trap
  // - If micro good & structural good -> opportunity
  // - If micro poor & structural poor -> trap
  // - Else -> wait (low confidence)

  if (isJeeter) {
    isDipTrap = true;
    const jeeterRisk = isNaN(structural.jeeterFlags.riskScore)
      ? 50
      : structural.jeeterFlags.riskScore;
    dipConfidence = Math.max(dipConfidence, jeeterRisk);
    expectedDipDepthPct = 20 + Math.min(40, jeeterRisk / 2);
    entryZone = {
      min: currentPrice * 0.65,
      max: currentPrice * 0.9,
      optimal: currentPrice * 0.8,
    };
    debug.push('Decision: Jeeter zone => Trap');
  } else if (microGood && structuralGood) {
    isDipOpportunity = true;
    dipConfidence = Math.max(dipConfidence, 60);
    expectedDipDepthPct =
      3 +
      Math.max(0, 10 - Math.round((micro.volatilityStdDevRecent || 0) * 100));
    entryZone = {
      min: currentPrice * 0.92,
      max: currentPrice * 1.02,
      optimal: currentPrice * 0.98,
    };
    debug.push('Decision: microGood & structuralGood => Opportunity');
  } else if (!microGood && !structuralGood) {
    isDipTrap = true;
    dipConfidence = Math.max(dipConfidence, 55);
    expectedDipDepthPct = 12;
    entryZone = {
      min: currentPrice * 0.75,
      max: currentPrice * 0.95,
      optimal: currentPrice * 0.85,
    };
    debug.push('Decision: microPoor & structuralPoor => Trap');
  } else {
    // Mixed signals -> be cautious
    dipConfidence = Math.round(dipConfidence * 0.7);
    expectedDipDepthPct = 8;
    entryZone = {
      min: currentPrice * 0.85,
      max: currentPrice * 1.0,
      optimal: currentPrice * 0.92,
    };
    debug.push('Decision: Mixed signals => Wait/Cautious');
  }

  // risk level by combined score & jeeter flags
  let riskLevel: 'low' | 'medium' | 'high' = 'medium';
  if (
    isJeeter ||
    structural.jeeterFlags.riskScore > PARAMS.thresholds.jeeterRiskScore
  )
    riskLevel = 'high';
  else if (combinedScore > 70 && !isJeeter) riskLevel = 'low';

  // Final validation to ensure no NaN values
  const finalDipConfidence = isNaN(dipConfidence)
    ? 0
    : Math.max(0, Math.min(100, Math.round(dipConfidence)));
  const finalExpectedDipDepth = isNaN(expectedDipDepthPct)
    ? 0
    : Math.max(0, Math.min(100, expectedDipDepthPct));

  return {
    isDipOpportunity,
    isDipTrap,
    dipConfidence: finalDipConfidence,
    expectedDipDepthPct: finalExpectedDipDepth,
    entryZone,
    combinedScore,
    riskLevel,
    debug,
  };
}

/* ============================
    Orchestrator (AnalysisService)
     ============================ */

export class ThreeLayerAnalysisService {
  /**
   * Top-level function called by your bot.
   * Accepts price history (high-frequency), tx aggregates (multi-window),
   * holder snapshot, token info, and returns final outcome.
   */
  async analyzeToken(
    priceHistory: Array<{ price: number; timestamp: number }>,
    txAnalysis: TransactionAnalysis,
    holders: HolderInfo[],
    tokenInfo: TokenInfo,
  ): Promise<Outcome> {
    // Layer 1
    const microSignals = computeMicrostructureSignals(
      priceHistory,
      txAnalysis,
      tokenInfo,
    );

    // Layer 2
    const structural = computeStructuralSignals(
      holders,
      txAnalysis,
      tokenInfo,
      priceHistory,
    );

    // Layer 3
    const outcome = predictOutcome(
      priceHistory[priceHistory.length - 1].price,
      microSignals,
      structural,
    );

    // Attach debug metadata
    // (You can persist microSignals/structural for auditing)
    (outcome as any).meta = { microSignals, structural };

    return outcome;
  }
}

/* ============================
    Notes:
    - Wire these functions to your data pipeline:
       * priceHistory should be sampled at a cadence you control (e.g., 1s or 2s)
       * txAnalysis should provide multi-window aggregates (5s, 15s, 60s)
       * tokenInfo should include micro LP snapshots (last 30s and now)
    - Unit test each function:
       * computeMicrostructureSignals with synthetic price + tx patterns
       * computeStructuralSignals with crafted holder sets
       * predictOutcome for expected behavior
    - Tuning: adjust PARAMS.weights and thresholds per historical backtest
    - Keep historical snapshots (micro signals + final outcome) for supervised learning
     ============================ */
