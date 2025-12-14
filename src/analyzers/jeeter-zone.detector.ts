import { TransactionAnalysis } from '../types/transaction.types';
import { WalletQualityAnalysis } from './wallet-quality.analyzer';
import { TokenInfo } from '../types/token.types';

/**
 * Jeeter Zone Detector
 * Flags immediate red flags that indicate dangerous token conditions
 */
export interface JeeterZoneFlags {
  highSellToBuyRatio: boolean;
  fastHolderRotation: boolean;
  snipersEnteringEarly: boolean;
  quickDumps: boolean;
  liquidityDrainage: boolean;
  mevSpam: boolean;
  tooManySwapBots: boolean;
  noStrongWalletAccumulation: boolean;
  lpTooThin: boolean;
  routerArbitragePump: boolean;
  creatorWalletActivity: boolean;
  suspiciousLPBehavior: boolean;
  riskScore: number; // 0-100, higher = more dangerous
  isJeeterZone: boolean;
}

export class JeeterZoneDetector {
  /**
   * Detect if token is in "Jeeter Zone" (dangerous)
   */
  detect(
    transactionAnalysis: TransactionAnalysis,
    walletQuality: WalletQualityAnalysis,
    tokenInfo: TokenInfo,
  ): JeeterZoneFlags {
    const flags: JeeterZoneFlags = {
      highSellToBuyRatio: false,
      fastHolderRotation: false,
      snipersEnteringEarly: false,
      quickDumps: false,
      liquidityDrainage: false,
      mevSpam: false,
      tooManySwapBots: false,
      noStrongWalletAccumulation: false,
      lpTooThin: false,
      routerArbitragePump: false,
      creatorWalletActivity: false,
      suspiciousLPBehavior: false,
      riskScore: 0,
      isJeeterZone: false,
    };

    // 1. High sell-to-buy ratio
    const sellBuyRatio = 1 - transactionAnalysis.buySellRatio;
    if (sellBuyRatio > 0.6) {
      flags.highSellToBuyRatio = true;
      flags.riskScore += 15;
    }

    // 2. Fast holder rotation (low average hold time)
    if (walletQuality.averageHoldTime < 10) {
      flags.fastHolderRotation = true;
      flags.riskScore += 15;
    }

    // 3. Snipers entering early
    const sniperCount = walletQuality.categoryDistribution.get('sniper') || 0;
    const totalWallets = Array.from(
      walletQuality.categoryDistribution.values(),
    ).reduce((a, b) => a + b, 0);
    if (sniperCount / totalWallets > 0.3) {
      flags.snipersEnteringEarly = true;
      flags.riskScore += 20;
    }

    // 4. Quick dumps (wallets dumping within 1-5 minutes)
    if (walletQuality.averageHoldTime < 5) {
      flags.quickDumps = true;
      flags.riskScore += 20;
    }

    // 5. Liquidity drainage (checking if liquidity is decreasing)
    // This would need historical liquidity data - simplified for now
    if (tokenInfo.liquidity && tokenInfo.liquidity < 10000) {
      flags.lpTooThin = true;
      flags.riskScore += 15;
    }

    // 6. MEV spam
    if (
      transactionAnalysis.mevPatterns.detected &&
      transactionAnalysis.mevPatterns.score > 50
    ) {
      flags.mevSpam = true;
      flags.riskScore += 15;
    }

    // 7. Too many swap bots
    const mevBotCount = walletQuality.categoryDistribution.get('mev_bot') || 0;
    if (mevBotCount / totalWallets > 0.2) {
      flags.tooManySwapBots = true;
      flags.riskScore += 10;
    }

    // 8. No strong wallet accumulation
    if (walletQuality.highQualityWalletCount === 0) {
      flags.noStrongWalletAccumulation = true;
      flags.riskScore += 15;
    }

    // 9. LP too thin
    if (tokenInfo.liquidity && tokenInfo.liquidity < 5000) {
      flags.lpTooThin = true;
      flags.riskScore += 20;
    }

    // 10. Router arbitrage pump (high transaction frequency with low volume per tx)
    if (
      transactionAnalysis.transactionsPerMinute > 5 &&
      transactionAnalysis.averageTransactionSize < 100
    ) {
      flags.routerArbitragePump = true;
      flags.riskScore += 10;
    }

    // 11. Jeeter dominance
    if (walletQuality.jeeterDominance) {
      flags.riskScore += 25;
    }

    // 12. Sniper dominance
    if (walletQuality.sniperDominance) {
      flags.riskScore += 20;
    }

    // Is Jeeter Zone if risk score > 50
    flags.isJeeterZone = flags.riskScore >= 50;

    return flags;
  }
}
