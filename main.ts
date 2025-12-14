import { Bot, Context } from 'grammy';
import dotenv from 'dotenv';
import { SolanaService } from './src/services/solana.service';
import { DexService } from './src/services/dex.service';
import { HolderService } from './src/services/holder.service';
import { AnalysisService } from './src/services/analysis.service';
import { TransactionService } from './src/services/transaction.service';
import { MicrocapAnalysisService } from './src/services/microcap-analysis.service';
import { ThreeLayerAnalysisService } from './src/analyzers/threelayeranalysis';
import { CoinDiscoveryService } from './src/services/coin-discovery.service';

// Load environment variables
dotenv.config();

// Initialize bot
const bot = new Bot(process.env.BOT_TOKEN || '');

// Initialize Solana services
// Use Helius RPC if API key is available, otherwise fall back to SOLANA_RPC_URL or default
const heliusApiKey = process.env.HELIUS_API_KEY;
const solanaRpcUrl = heliusApiKey
  ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
  : process.env.SOLANA_RPC_URL;

if (heliusApiKey) {
  console.log('✅ Using Helius RPC endpoint for SolanaService');
} else {
  console.warn(
    '⚠️ HELIUS_API_KEY not set - using public RPC (holder queries may be limited)',
  );
}

const solanaService = new SolanaService(solanaRpcUrl);
const dexService = new DexService();

// Initialize TransactionService if Helius API key is available
const transactionService = heliusApiKey
  ? new TransactionService(heliusApiKey, solanaRpcUrl)
  : undefined;

if (!transactionService) {
  console.warn(
    '⚠️ HELIUS_API_KEY not set - transaction analysis will be limited',
  );
}

const holderService = new HolderService(
  solanaService,
  dexService,
  transactionService,
);
const analysisService = new AnalysisService(dexService, transactionService);
const microcapAnalysisService = new MicrocapAnalysisService(
  dexService,
  holderService,
  transactionService,
);
const threeLayerAnalysisService = new ThreeLayerAnalysisService();
const coinDiscoveryService = new CoinDiscoveryService(
  dexService,
  solanaService,
  holderService,
  transactionService,
  heliusApiKey,
);

// Helper function to escape Markdown special characters
// Only escape characters that are actually used in Markdown formatting
function escapeMarkdown(text: string | undefined | null): string {
  if (!text) return '';
  return String(text)
    .replace(/\_/g, '\\_') // underscore
    .replace(/\*/g, '\\*') // asterisk
    .replace(/\[/g, '\\[') // square brackets
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(') // parentheses (for links)
    .replace(/\)/g, '\\)')
    .replace(/\~/g, '\\~') // strikethrough
    .replace(/\`/g, '\\`'); // code blocks
}

// Crypto API configuration (using CoinGecko free API)
const COINGECKO_API = 'https://api.coingecko.com/api/v3';

// Interface for price data
interface PriceData {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
}

// Store for price alerts (in production, use a database)
const alerts: Map<
  number,
  Array<{ symbol: string; targetPrice: number; direction: 'above' | 'below' }>
> = new Map();

// Start command
bot.command('start', async (ctx: Context) => {
  await ctx.reply(
    `👋 Welcome to Degen Bot - Solana Memecoin Analyst!

I help you analyze Solana memecoins to avoid jeeters and find profitable opportunities.

*Solana Analysis Commands:*
/scan <token_address> - Full comprehensive analysis
/microcap <token_address> - 🔥 Microcap analysis (wallet patterns, NO RSI/MACD)
/threelayer <token_address> - 🔬 3-layer analysis (microstructure + structural + outcome)
/scannew auto [hours] - 🔍 Auto-discover & scan new coins (default: 24h)
/scannew <token1> [token2] ... - 🔍 Scan specific coins (safety + market health + profit potential)
/holders <token_address> - Detailed holder analysis
/score <token_address> - Quick risk/profitability score
/entry <token_address> - Get entry point recommendation

*General Commands:*
/price <symbol> - Get crypto price
/help - Show all commands

*Example:*
/scan <Solana_token_address>
/entry <Solana_token_address>
  `,
    { parse_mode: 'Markdown' },
  );
});

// Help command
bot.command('help', async (ctx: Context) => {
  await ctx.reply(
    `📚 *Available Commands:*

*Solana Memecoin Analysis:*
/scan <token_address> - Full token analysis (holders, jeeters, risk)
/microcap <token_address> - 🔥 Microcap analysis (wallet quality, seller exhaustion, NO TA)
/threelayer <token_address> - 🔬 3-layer analysis (microstructure + structural + outcome prediction)
/scannew auto [hours] - 🔍 Auto-discover & scan new coins (default: 24h)
/scannew <token1> [token2] ... - 🔍 Scan specific coins (auto-filter + rank by profit potential)
/holders <token_address> - Detailed holder analysis
/score <token_address> - Quick risk/profitability score
/entry <token_address> - Entry point recommendation with technical analysis

*General Crypto:*
/price <symbol> - Get current cryptocurrency price
  Example: /price btc or /price bitcoin

/alert <symbol> <price> - Set a price alert
/alerts - View your active alerts
/clear - Clear all your alerts

*Examples:*
/scan <Solana_token_address>
/holders <Solana_token_address>
  `,
    { parse_mode: 'Markdown' },
  );
});

// Clear command
bot.command('clear', async (ctx: Context) => {
  const userId = ctx.from?.id;

  if (!userId) {
    await ctx.reply('❌ Unable to identify user.');
    return;
  }

  alerts.delete(userId);
  await ctx.reply('✅ All alerts cleared!');
});

// ==================== SOLANA MEMECOIN ANALYSIS COMMANDS ====================

// Scan command - Full token analysis
bot.command('scan', async (ctx: Context) => {
  const message = ctx.message?.text || '';
  const parts = message.split(' ');
  const userId = ctx.from?.id || 'unknown';

  console.log(`[Bot] /scan command received from user ${userId}`);

  if (parts.length < 2) {
    await ctx.reply(
      '❌ Please provide a Solana token address.\n\nExample: /scan <token_address>',
    );
    return;
  }

  const tokenAddress = parts[1].trim();
  console.log(`[Bot] Analyzing token: ${tokenAddress}`);

  // Validate Solana address format (basic check)
  if (tokenAddress.length < 32 || tokenAddress.length > 44) {
    await ctx.reply('❌ Invalid Solana address format.');
    return;
  }

  await ctx.reply('⏳ Analyzing token... This may take a moment.');

  try {
    const analysis = await holderService.analyzeToken(tokenAddress);

    const riskEmoji = {
      Low: '✅',
      Moderate: '⚠️',
      High: '🔴',
      Critical: '🚨',
    };

    let message = `${riskEmoji[analysis.riskLevel]} *Token Analysis*\n\n`;
    message += `*Token:* ${escapeMarkdown(analysis.token.name || 'Unknown')}\n`;
    message += `*Symbol:* ${escapeMarkdown(analysis.token.symbol || 'N/A')}\n`;
    message += `*Address:* \`${tokenAddress.slice(0, 8)}...${tokenAddress.slice(
      -8,
    )}\`\n\n`;

    if (analysis.token.price) {
      // Format market cap helper
      const formatMC = (mc: number) => {
        if (mc >= 1e9) return ` ($${(mc / 1e9).toFixed(2)}B)`;
        if (mc >= 1e6) return ` ($${(mc / 1e6).toFixed(2)}M)`;
        if (mc >= 1e3) return ` ($${(mc / 1e3).toFixed(2)}K)`;
        return ` ($${mc.toFixed(2)})`;
      };
      const mcDisplay = analysis.token.marketCap
        ? formatMC(analysis.token.marketCap)
        : '';
      message += `💵 *Price:* $${analysis.token.price.toFixed(
        8,
      )}${mcDisplay}\n`;
    }
    if (analysis.token.liquidity) {
      message += `💧 *Liquidity:* $${(analysis.token.liquidity / 1e3).toFixed(
        2,
      )}K\n`;
    }

    message += `\n📊 *Holder Analysis:*\n`;
    message += `Total Holders: ${analysis.holderAnalysis.totalHolders}\n`;
    message += `Top 10 Concentration: ${analysis.holderAnalysis.holderConcentration.toFixed(
      2,
    )}%\n`;
    message += `Jeeter Count: ${
      analysis.holderAnalysis.jeeterCount
    } (${analysis.holderAnalysis.jeeterPercentage.toFixed(1)}%)\n`;
    message += `Bundle Groups: ${analysis.holderAnalysis.bundleCount}\n`;
    if (analysis.holderAnalysis.averageHoldTime > 0) {
      message += `Avg Hold Time: ${analysis.holderAnalysis.averageHoldTime.toFixed(
        1,
      )} min\n`;
    }

    message += `\n🎯 *Jeeter Risk Score:* ${analysis.holderAnalysis.jeeterRiskScore}/100\n`;
    message += `*Risk Level:* ${escapeMarkdown(analysis.riskLevel)}\n`;
    message += `*Overall Score:* ${analysis.overallScore}/100\n`;

    // Add transaction analysis if available
    if (analysis.holderAnalysis.transactionAnalysis) {
      const tx = analysis.holderAnalysis.transactionAnalysis;
      message += `\n📈 *Transaction Analysis:*\n`;
      message += `Buy/Sell Ratio: ${(tx.buySellRatio * 100).toFixed(
        1,
      )}% buys\n`;
      message += `• 5m: ${(tx.buySellRatio5m * 100).toFixed(1)}% | 15m: ${(
        tx.buySellRatio15m * 100
      ).toFixed(1)}% | 1h: ${(tx.buySellRatio1h * 100).toFixed(1)}%\n`;
      message += `Buy Volume: $${(tx.buyVolume / 1000).toFixed(1)}K | Sell: $${(
        tx.sellVolume / 1000
      ).toFixed(1)}K\n`;
      message += `Large Buys: ${tx.largeBuyCount} | Large Sells: ${tx.largeSellCount}\n`;
      message += `Whale Activity: ${tx.whaleActivity.count} tx ($${(
        tx.whaleActivity.totalVolume / 1000
      ).toFixed(1)}K)\n`;
      if (tx.mevDetected) {
        message += `⚠️ MEV Detected (Score: ${tx.mevScore}/100)\n`;
      } else {
        message += `✅ No MEV patterns detected\n`;
      }
      message += `Tx Rate: ${tx.transactionsPerMinute.toFixed(1)}/min\n`;
    }

    if (analysis.recommendations.length > 0) {
      message += `\n💡 *Recommendations:*\n`;
      analysis.recommendations.slice(0, 5).forEach((rec) => {
        message += `${escapeMarkdown(rec)}\n`;
      });
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in scan command:', error);
    await ctx.reply(
      `❌ Error analyzing token. Please check:\n` +
        `- Token address is correct\n` +
        `- Token exists on Solana\n` +
        `- Token has holders\n\n` +
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
});

// Microcap command - Microcap-specific analysis (NO RSI/MACD)
bot.command('microcap', async (ctx: Context) => {
  const message = ctx.message?.text || '';
  const parts = message.split(' ');
  const userId = ctx.from?.id || 'unknown';

  console.log(`[Bot] /microcap command received from user ${userId}`);

  if (parts.length < 2) {
    await ctx.reply(
      '❌ Please provide a Solana token address.\n\nExample: /microcap <token_address>',
    );
    return;
  }

  const tokenAddress = parts[1].trim();
  console.log(`[Bot] Running microcap analysis for token: ${tokenAddress}`);

  // Validate Solana address format
  if (tokenAddress.length < 32 || tokenAddress.length > 44) {
    await ctx.reply('❌ Invalid Solana address format.');
    return;
  }

  await ctx.reply('🔥 Analyzing microcap patterns... This may take a moment.');

  try {
    const analysis = await microcapAnalysisService.analyze(tokenAddress);

    // Format recommendation emoji
    const recEmoji = {
      avoid: '🚨',
      cautious: '⚠️',
      good: '✅',
      strong: '🟢',
    };

    // Format risk level emoji
    const riskEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🔴',
    };

    let message = `${
      recEmoji[analysis.entryRecommendation]
    } *Microcap Analysis*\n\n`;
    message += `*Score:* ${analysis.score}/100\n`;
    message += `*Risk Level:* ${
      riskEmoji[analysis.riskLevel]
    } ${analysis.riskLevel.toUpperCase()}\n`;
    message += `*Recommendation:* ${analysis.entryRecommendation.toUpperCase()}\n`;
    message += `*Jeeter Dominated:* ${
      analysis.isJeeterDominated ? '🚩 YES' : '✅ NO'
    }\n\n`;

    // Seller Exhaustion
    message += `*🔥 Seller Exhaustion:*\n`;
    message += `Exhaustion Score: ${analysis.signals.sellerExhaustion.exhaustionScore}/100\n`;
    message += `Bottom Signal: ${
      analysis.signals.sellerExhaustion.isBottomSignal ? '✅ YES' : '❌ NO'
    }\n`;
    if (analysis.signals.sellerExhaustion.signals.length > 0) {
      message += `Signals: ${analysis.signals.sellerExhaustion.signals.join(
        ', ',
      )}\n`;
    }
    message += `\n`;

    // Wallet Quality
    message += `*👥 Wallet Quality:*\n`;
    message += `Quality Score: ${analysis.signals.walletQuality.overallQualityScore.toFixed(
      1,
    )}/100\n`;
    message += `High Quality Wallets: ${analysis.signals.walletQuality.highQualityWalletCount}\n`;
    message += `Jeeter Dominance: ${
      analysis.signals.walletQuality.jeeterDominance ? '🚩 YES' : '✅ NO'
    }\n`;
    message += `Sniper Dominance: ${
      analysis.signals.walletQuality.sniperDominance ? '🎯 YES' : '✅ NO'
    }\n`;
    message += `\n`;

    // Wallet Categories
    const categories = analysis.signals.walletQuality.categoryDistribution;
    const categoryEntries = Object.entries(categories).filter(
      ([_, count]) => count > 0,
    );
    if (categoryEntries.length > 0) {
      message += `*Wallet Breakdown:*\n`;
      categoryEntries.forEach(([category, count]) => {
        const emoji = {
          sniper: '🎯',
          jeeter: '🚩',
          weak_hands: '💧',
          strong_hands: '💎',
          whale: '🐋',
          mev_bot: '🤖',
          router_arbitrage_bot: '⚡',
          unknown: '❓',
        };
        message += `${
          emoji[category as keyof typeof emoji] || '•'
        } ${category}: ${count}\n`;
      });
      message += `\n`;
    }

    // Sniper Detection
    message += `*🎯 Snipers:*\n`;
    message += `Count: ${analysis.signals.sniperDetection.sniperCount}\n`;
    message += `Percentage: ${analysis.signals.sniperDetection.sniperPercentage.toFixed(
      1,
    )}%\n`;
    message += `Heavy: ${
      analysis.signals.sniperDetection.isSniperHeavy ? '⚠️ YES' : '✅ NO'
    }\n`;
    message += `\n`;

    // LP Health
    message += `*💧 LP Health:*\n`;
    message += `Health Score: ${analysis.signals.lpHealth.healthScore}/100\n`;
    message += `Status: ${
      analysis.signals.lpHealth.isHealthy ? '✅ Healthy' : '⚠️ Unhealthy'
    }\n`;
    message += `Liquidity: $${(
      analysis.signals.lpHealth.liquidityAmount / 1000
    ).toFixed(1)}K\n`;
    message += `LP/MC Ratio: ${(
      analysis.signals.lpHealth.lpRatio * 100
    ).toFixed(1)}%\n`;
    if (analysis.signals.lpHealth.risks.length > 0) {
      message += `Risks: ${analysis.signals.lpHealth.risks.join(', ')}\n`;
    }
    message += `\n`;

    // Whale Activity
    message += `*🐋 Whale Activity:*\n`;
    message += `Whale Count: ${analysis.signals.whaleActivity.whaleCount}\n`;
    message += `Accumulating: ${
      analysis.signals.whaleActivity.whaleAccumulation ? '✅ YES' : '❌ NO'
    }\n`;
    message += `Distributing: ${
      analysis.signals.whaleActivity.whaleDistribution ? '⚠️ YES' : '✅ NO'
    }\n`;
    message += `\n`;

    // Jeeter Flags
    if (analysis.signals.jeeterFlags.length > 0) {
      message += `*🚩 Jeeter Flags:*\n`;
      analysis.signals.jeeterFlags.forEach((flag) => {
        message += `⚠️ ${flag}\n`;
      });
      message += `\n`;
    }

    // Reasoning
    if (analysis.debug.reasoning.length > 0) {
      message += `*💡 Analysis Reasoning:*\n`;
      analysis.debug.reasoning.slice(0, 5).forEach((reason) => {
        message += `${escapeMarkdown(reason)}\n`;
      });
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in microcap command:', error);
    await ctx.reply(
      `❌ Error analyzing microcap: ${
        error instanceof Error ? error.message : 'Unknown error'
      }\n\n` +
        `Please check:\n` +
        `- Token address is correct\n` +
        `- Token has trading data available\n` +
        `- HELIUS_API_KEY is set for transaction analysis`,
    );
  }
});

// Three-Layer Analysis command
bot.command('threelayer', async (ctx: Context) => {
  const message = ctx.message?.text || '';
  const parts = message.split(' ');
  const userId = ctx.from?.id || 'unknown';

  console.log(`[Bot] /threelayer command received from user ${userId}`);

  if (parts.length < 2) {
    await ctx.reply(
      '❌ Please provide a Solana token address.\n\nExample: /threelayer <token_address>',
    );
    return;
  }

  const tokenAddress = parts[1].trim();
  console.log(`[Bot] Running three-layer analysis for token: ${tokenAddress}`);

  // Validate Solana address format
  if (tokenAddress.length < 32 || tokenAddress.length > 44) {
    await ctx.reply('❌ Invalid Solana address format.');
    return;
  }

  if (!transactionService) {
    await ctx.reply(
      '❌ Three-layer analysis requires HELIUS_API_KEY to be set for transaction data.',
    );
    return;
  }

  await ctx.reply('🔬 Running 3-layer analysis... This may take a moment.');

  try {
    // 1. Get token info
    const tokenInfo = await dexService.getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      await ctx.reply('❌ Token not found. Please check the address.');
      return;
    }

    // 2. Get price history
    const priceHistory = await dexService.getPriceHistory(tokenAddress);
    const priceHistoryWithTimestamps =
      priceHistory?.map((p, i) => ({
        price: p.price,
        timestamp:
          p.timestamp || Date.now() - (priceHistory.length - i) * 3600000,
      })) || [];

    if (priceHistoryWithTimestamps.length === 0) {
      await ctx.reply(
        '❌ Insufficient price history data. Token may be too new.',
      );
      return;
    }

    // 3. Get transaction analysis
    const txData = await transactionService.getTokenTransactions(
      tokenAddress,
      100,
    );
    if (!txData || !txData.analysis) {
      await ctx.reply(
        '❌ Could not fetch transaction analysis. Please try again later.',
      );
      return;
    }

    // 4. Get holders
    const holderAnalysis = await holderService.analyzeHolders(tokenAddress);
    const holders = holderAnalysis.topHolders;

    // 5. Run three-layer analysis
    const outcome = await threeLayerAnalysisService.analyzeToken(
      priceHistoryWithTimestamps,
      txData.analysis,
      holders,
      tokenInfo,
    );

    // Format output
    const riskEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🔴',
    };

    const opportunityEmoji = outcome.isDipOpportunity
      ? '✅'
      : outcome.isDipTrap
      ? '🚨'
      : '⚠️';

    let message = `${opportunityEmoji} *3-Layer Analysis*\n\n`;

    // Outcome Summary
    message += `*Outcome:*\n`;
    message += `Type: ${
      outcome.isDipOpportunity
        ? '✅ DIP OPPORTUNITY'
        : outcome.isDipTrap
        ? '🚨 DIP TRAP'
        : '⚠️ MIXED SIGNALS'
    }\n`;
    message += `Confidence: ${outcome.dipConfidence}/100\n`;
    message += `Combined Score: ${outcome.combinedScore}/100\n`;
    message += `Risk Level: ${
      riskEmoji[outcome.riskLevel]
    } ${outcome.riskLevel.toUpperCase()}\n\n`;

    // Entry Zone
    message += `*🎯 Entry Zone:*\n`;

    // Calculate market cap for each entry price
    // Market cap = price * supply
    // Try to get supply from tokenInfo, or calculate from marketCap/price if available
    let supply = tokenInfo.supply || 0;
    if (!supply || supply === 0) {
      // Fallback: calculate supply from marketCap and current price if available
      if (tokenInfo.marketCap && tokenInfo.price && tokenInfo.price > 0) {
        supply = tokenInfo.marketCap / tokenInfo.price;
      }
    }

    const formatMarketCap = (price: number) => {
      if (!supply || supply === 0) return '';
      const mc = price * supply;
      if (mc >= 1e9) return ` ($${(mc / 1e9).toFixed(2)}B)`;
      if (mc >= 1e6) return ` ($${(mc / 1e6).toFixed(2)}M)`;
      if (mc >= 1e3) return ` ($${(mc / 1e3).toFixed(2)}K)`;
      return ` ($${mc.toFixed(2)})`;
    };

    message += `Optimal: $${outcome.entryZone.optimal.toFixed(
      8,
    )}${formatMarketCap(outcome.entryZone.optimal)}\n`;
    message += `Range: $${outcome.entryZone.min.toFixed(8)}${formatMarketCap(
      outcome.entryZone.min,
    )} - $${outcome.entryZone.max.toFixed(8)}${formatMarketCap(
      outcome.entryZone.max,
    )}\n`;
    message += `Expected Dip Depth: ${outcome.expectedDipDepthPct.toFixed(
      1,
    )}%\n\n`;

    // Current Price Context
    const currentPrice =
      priceHistoryWithTimestamps[priceHistoryWithTimestamps.length - 1].price;
    const currentMarketCap = currentPrice * supply || 0;
    message += `*💰 Current Price:* $${currentPrice.toFixed(
      8,
    )}${formatMarketCap(currentMarketCap)}\n`;
    const priceDiff =
      ((currentPrice - outcome.entryZone.optimal) / currentPrice) * 100;
    message += `Distance to Optimal Entry: ${
      priceDiff > 0 ? '+' : ''
    }${priceDiff.toFixed(1)}%\n\n`;

    // Layer Details (from meta if available)
    const meta = (outcome as any).meta;
    if (meta) {
      const { microSignals, structural } = meta;

      message += `*📊 Layer 1 - Microstructure:*\n`;
      message += `Micro Score: ${microSignals.microScore}/100\n`;
      message += `Momentum (5s/15s/60s): ${(
        microSignals.momentum5s * 100
      ).toFixed(1)}% / ${(microSignals.momentum15s * 100).toFixed(1)}% / ${(
        microSignals.momentum60s * 100
      ).toFixed(1)}%\n`;
      message += `Buy/Sell Delta: ${(
        microSignals.buySellDelta15s * 100
      ).toFixed(1)}%\n`;
      message += `Volatility: ${(
        microSignals.volatilityStdDevRecent * 100
      ).toFixed(2)}% (${
        microSignals.volatilityTrendPct < 0 ? '📉 Compressing' : '📈 Expanding'
      })\n`;
      message += `Bot Activity: ${microSignals.botActivityIndex}/100\n`;
      if (microSignals.reasons.length > 0) {
        message += `Signals: ${microSignals.reasons.slice(0, 3).join(', ')}\n`;
      }
      message += `\n`;

      message += `*🏗️ Layer 2 - Structural Health:*\n`;
      message += `Structural Score: ${structural.structuralScore}/100\n`;
      message += `Wallet Quality: ${structural.walletQualityAnalysis.overallQualityScore.toFixed(
        1,
      )}/100\n`;
      message += `LP Health: ${structural.lpHealthSignals.healthScore.toFixed(
        1,
      )}/100\n`;
      message += `Seller Exhaustion: ${structural.sellerExhaustion.exhaustionScore.toFixed(
        1,
      )}/100\n`;
      message += `Jeeter Zone: ${
        structural.jeeterFlags.isJeeterZone ? '🚩 YES' : '✅ NO'
      }\n`;
      if (structural.reasons.length > 0) {
        message += `Signals: ${structural.reasons.slice(0, 3).join(', ')}\n`;
      }
      message += `\n`;
    }

    // Debug info (if available)
    if (outcome.debug && outcome.debug.length > 0) {
      message += `*🔍 Debug Info:*\n`;
      outcome.debug.slice(0, 3).forEach((debug) => {
        message += `${escapeMarkdown(debug)}\n`;
      });
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in threelayer command:', error);
    await ctx.reply(
      `❌ Error running three-layer analysis: ${
        error instanceof Error ? error.message : 'Unknown error'
      }\n\n` +
        `Please check:\n` +
        `- Token address is correct\n` +
        `- Token has sufficient trading data\n` +
        `- HELIUS_API_KEY is set and valid`,
    );
  }
});

// Holders command - Detailed holder analysis
bot.command('holders', async (ctx: Context) => {
  const message = ctx.message?.text || '';
  const parts = message.split(' ');
  const userId = ctx.from?.id || 'unknown';

  console.log(`[Bot] /holders command received from user ${userId}`);

  if (parts.length < 2) {
    await ctx.reply(
      '❌ Please provide a Solana token address.\n\nExample: /holders <token_address>',
    );
    return;
  }

  const tokenAddress = parts[1].trim();
  console.log(`[Bot] Analyzing holders for token: ${tokenAddress}`);

  await ctx.reply('⏳ Analyzing holders... This may take a moment.');

  try {
    const analysis = await holderService.analyzeHolders(tokenAddress, 150);

    let message = `📊 *Holder Analysis*\n\n`;
    message += `Total Holders Analyzed: ${analysis.totalHolders}\n`;
    message += `Top 10 Concentration: ${analysis.holderConcentration.toFixed(
      2,
    )}%\n\n`;

    message += `*Jeeter Analysis:*\n`;
    message += `Jeeter Count: ${analysis.jeeterCount}\n`;
    message += `Jeeter Percentage: ${analysis.jeeterPercentage.toFixed(1)}%\n`;
    message += `Jeeter Risk Score: ${analysis.jeeterRiskScore}/100\n`;
    message += `Risk Level: ${escapeMarkdown(analysis.riskLevel)}\n\n`;

    message += `Bundle Groups Detected: ${analysis.bundleCount}\n`;
    if (analysis.averageHoldTime > 0) {
      message += `Average Hold Time: ${analysis.averageHoldTime.toFixed(
        1,
      )} minutes\n`;
    }

    message += `\n*Top 10 Holders:*\n`;
    analysis.topHolders.slice(0, 10).forEach((holder, index) => {
      const jeeterBadge = holder.isJeeter ? '🚩' : '';
      message += `${index + 1}. ${holder.address.slice(
        0,
        8,
      )}...${holder.address.slice(-6)} ${jeeterBadge}\n`;
      message += `   ${holder.percentage.toFixed(
        2,
      )}% (${holder.balance.toLocaleString()})\n`;
    });

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in holders command:', error);
    await ctx.reply(
      `❌ Error analyzing holders: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
});

// Score command - Quick risk/profitability score
bot.command('score', async (ctx: Context) => {
  const message = ctx.message?.text || '';
  const parts = message.split(' ');
  const userId = ctx.from?.id || 'unknown';

  console.log(`[Bot] /score command received from user ${userId}`);

  if (parts.length < 2) {
    await ctx.reply(
      '❌ Please provide a Solana token address.\n\nExample: /score <token_address>',
    );
    return;
  }

  const tokenAddress = parts[1].trim();
  console.log(`[Bot] Calculating score for token: ${tokenAddress}`);

  await ctx.reply('⏳ Calculating score...');

  try {
    const analysis = await holderService.analyzeToken(tokenAddress);

    const scoreEmoji =
      analysis.overallScore >= 70
        ? '🟢'
        : analysis.overallScore >= 50
        ? '🟡'
        : analysis.overallScore >= 30
        ? '🟠'
        : '🔴';

    let message = `${scoreEmoji} *Token Score*\n\n`;
    message += `*Overall Score:* ${analysis.overallScore}/100\n`;
    message += `*Risk Level:* ${escapeMarkdown(analysis.riskLevel)}\n\n`;

    message += `*Breakdown:*\n`;
    message += `Jeeter Risk: ${analysis.holderAnalysis.jeeterRiskScore}/100\n`;
    message += `Holder Concentration: ${analysis.holderAnalysis.holderConcentration.toFixed(
      1,
    )}%\n`;
    message += `Jeeter Percentage: ${analysis.holderAnalysis.jeeterPercentage.toFixed(
      1,
    )}%\n`;

    if (analysis.overallScore >= 70) {
      message += `\n✅ Good investment opportunity`;
    } else if (analysis.overallScore >= 50) {
      message += `\n⚠️ Moderate risk - proceed with caution`;
    } else {
      message += `\n🚨 High risk - consider avoiding`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in score command:', error);
    await ctx.reply(
      `❌ Error calculating score: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
});

// Entry command - Entry point recommendation
bot.command('entry', async (ctx: Context) => {
  const message = ctx.message?.text || '';
  const parts = message.split(' ');
  const userId = ctx.from?.id || 'unknown';

  console.log(`[Bot] /entry command received from user ${userId}`);

  if (parts.length < 2) {
    await ctx.reply(
      '❌ Please provide a Solana token address.\n\nExample: /entry <token_address>',
    );
    return;
  }

  const tokenAddress = parts[1].trim();
  console.log(`[Bot] Analyzing entry point for token: ${tokenAddress}`);

  // Validate Solana address format
  if (tokenAddress.length < 32 || tokenAddress.length > 44) {
    await ctx.reply('❌ Invalid Solana address format.');
    return;
  }

  await ctx.reply('⏳ Analyzing entry point... This may take a moment.');

  try {
    // Get current token price
    const tokenInfo = await dexService.getTokenInfo(tokenAddress);
    if (!tokenInfo || !tokenInfo.price) {
      await ctx.reply(
        '❌ Could not fetch token price. Please check the token address.',
      );
      return;
    }

    const currentPrice = tokenInfo.price;

    // Get token supply from Solana (more reliable)
    let tokenSupply = 0;
    try {
      console.log(`[Bot] Fetching token supply from Solana...`);
      const supplyInfo = await solanaService.getTokenSupply(tokenAddress);
      tokenSupply = supplyInfo.supply;
      console.log(
        `[Bot] Token supply from Solana: ${tokenSupply.toLocaleString()}`,
      );
    } catch (error) {
      console.warn(
        `[Bot] Failed to get supply from Solana, trying fallback methods...`,
      );
      // Fallback 1: Use supply from DexScreener if available
      if (tokenInfo.supply && tokenInfo.supply > 0) {
        tokenSupply = tokenInfo.supply;
        console.log(
          `[Bot] Using supply from DexScreener: ${tokenSupply.toLocaleString()}`,
        );
      }
      // Fallback 2: Calculate from market cap if available
      else if (
        tokenInfo.marketCap &&
        tokenInfo.marketCap > 0 &&
        currentPrice > 0
      ) {
        tokenSupply = tokenInfo.marketCap / currentPrice;
        console.log(
          `[Bot] Calculated supply from market cap: ${tokenSupply.toLocaleString()}`,
        );
      } else {
        console.error(`[Bot] Could not determine token supply`);
        await ctx.reply(
          '⚠️ Warning: Could not fetch token supply. Market cap calculations may be inaccurate.',
        );
      }
    }

    // Analyze entry point
    const entryAnalysis = await analysisService.analyzeEntryPoint(
      tokenAddress,
      currentPrice,
      tokenSupply,
    );

    // Helper function to format market cap
    function formatMarketCap(mc: number): string {
      if (mc >= 1e9) return `${(mc / 1e9).toFixed(2)}B`;
      if (mc >= 1e6) return `${(mc / 1e6).toFixed(2)}M`;
      if (mc >= 1e3) return `${(mc / 1e3).toFixed(2)}K`;
      return mc.toFixed(0);
    }

    // Format response
    const signalEmoji = {
      'Strong Buy': '🟢',
      Buy: '🟡',
      Wait: '🟠',
      Avoid: '🔴',
    };

    let message = `${
      signalEmoji[entryAnalysis.entrySignal]
    } *Entry Point Analysis*\n\n`;
    message += `*Current Price:* $${currentPrice.toFixed(8)} (${formatMarketCap(
      entryAnalysis.currentMarketCap || 0,
    )} MC)\n`;
    message += `*Entry Signal:* ${entryAnalysis.entrySignal}\n`;

    // Clarify confidence meaning based on signal
    if (entryAnalysis.entrySignal === 'Avoid') {
      message += `*Risk Confidence:* ${entryAnalysis.entryConfidence}% (certainty you should avoid)\n\n`;
    } else if (
      entryAnalysis.entrySignal === 'Strong Buy' ||
      entryAnalysis.entrySignal === 'Buy'
    ) {
      message += `*Confidence:* ${entryAnalysis.entryConfidence}% (entry opportunity strength)\n\n`;
    } else {
      message += `*Confidence:* ${entryAnalysis.entryConfidence}% (analysis certainty)\n\n`;
    }

    message += `*Recommended Entry Price:*\n`;
    message += `Optimal: $${entryAnalysis.entryPriceRange.optimal.toFixed(
      8,
    )} (${formatMarketCap(entryAnalysis.entryMarketCaps?.optimal || 0)} MC)\n`;
    message += `Range: $${entryAnalysis.entryPriceRange.min.toFixed(
      8,
    )} (${formatMarketCap(
      entryAnalysis.entryMarketCaps?.min || 0,
    )} MC) - $${entryAnalysis.entryPriceRange.max.toFixed(
      8,
    )} (${formatMarketCap(entryAnalysis.entryMarketCaps?.max || 0)} MC)\n\n`;

    message += `*Risk Management:*\n`;
    message += `Stop Loss: $${entryAnalysis.stopLoss.toFixed(
      8,
    )} (${formatMarketCap(entryAnalysis.stopLossMarketCap || 0)} MC)\n`;
    message += `Take Profit 1: $${
      entryAnalysis.takeProfit[0]?.toFixed(8) || 'N/A'
    }${
      entryAnalysis.takeProfit[0]
        ? ` (${formatMarketCap(
            entryAnalysis.takeProfitMarketCaps?.[0] || 0,
          )} MC)`
        : ''
    }\n`;
    if (entryAnalysis.takeProfit[1]) {
      message += `Take Profit 2: $${entryAnalysis.takeProfit[1].toFixed(
        8,
      )} (${formatMarketCap(
        entryAnalysis.takeProfitMarketCaps?.[1] || 0,
      )} MC)\n`;
    }
    message += `Risk/Reward Ratio: 1:${entryAnalysis.riskRewardRatio.toFixed(
      2,
    )}\n\n`;

    message += `*Technical Indicators:*\n`;
    message += `RSI: ${entryAnalysis.technicalIndicators.rsi.toFixed(2)} `;
    if (entryAnalysis.technicalIndicators.rsi < 30) {
      message += `(Oversold ✅)\n`;
    } else if (entryAnalysis.technicalIndicators.rsi > 70) {
      message += `(Overbought ⚠️)\n`;
    } else {
      message += `(Neutral)\n`;
    }
    message += `MACD: ${
      entryAnalysis.technicalIndicators.macd.macd > 0 ? 'Bullish' : 'Bearish'
    }\n`;
    message += `Trend: ${entryAnalysis.technicalIndicators.currentTrend}\n\n`;

    if (entryAnalysis.technicalIndicators.supportLevels.length > 0) {
      message += `*Support Levels:*\n`;
      entryAnalysis.technicalIndicators.supportLevels.forEach((level, i) => {
        const supportMC = level * tokenSupply;
        message += `${i + 1}. $${level.toFixed(8)} (${formatMarketCap(
          supportMC,
        )} MC)\n`;
      });
      message += `\n`;
    }

    if (entryAnalysis.technicalIndicators.resistanceLevels.length > 0) {
      message += `*Resistance Levels:*\n`;
      entryAnalysis.technicalIndicators.resistanceLevels.forEach((level, i) => {
        const resistanceMC = level * tokenSupply;
        message += `${i + 1}. $${level.toFixed(8)} (${formatMarketCap(
          resistanceMC,
        )} MC)\n`;
      });
      message += `\n`;
    }

    message += `*Best Entry Time:* ${entryAnalysis.bestEntryTime}\n\n`;

    // Add transaction-based reasoning if available
    if (transactionService) {
      try {
        const txData = await transactionService.getTokenTransactions(
          tokenAddress,
          50,
        );
        if (txData && txData.analysis) {
          message += `*Market Activity:*\n`;
          const buyRatio = txData.analysis.buySellRatio;
          if (buyRatio > 0.6) {
            message += `✅ Strong buying pressure (${(buyRatio * 100).toFixed(
              1,
            )}% buys)\n`;
          } else if (buyRatio < 0.4) {
            message += `⚠️ Selling pressure dominant (${(
              (1 - buyRatio) *
              100
            ).toFixed(1)}% sells)\n`;
          } else {
            message += `⚖️ Balanced market (${(buyRatio * 100).toFixed(
              1,
            )}% buys)\n`;
          }

          if (txData.analysis.largeBuyCount > txData.analysis.largeSellCount) {
            message += `✅ More large buys than sells (bullish)\n`;
          } else if (
            txData.analysis.largeSellCount > txData.analysis.largeBuyCount
          ) {
            message += `⚠️ More large sells than buys (bearish)\n`;
          }

          if (txData.analysis.mevPatterns.detected) {
            message += `⚠️ MEV activity detected - be cautious\n`;
          }
          message += `\n`;
        }
      } catch (error) {
        // Silently fail - transaction data is optional
      }
    }

    message += `*Analysis Reasoning:*\n`;
    entryAnalysis.reasoning.slice(0, 5).forEach((reason) => {
      message += `${escapeMarkdown(reason)}\n`;
    });

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in entry command:', error);
    await ctx.reply(
      `❌ Error analyzing entry point: ${
        error instanceof Error ? error.message : 'Unknown error'
      }\n\n` +
        `Please check:\n` +
        `- Token address is correct\n` +
        `- Token has trading data available`,
    );
  }
});

// Scan New Coins command
bot.command('scannew', async (ctx: Context) => {
  const message = ctx.message?.text || '';
  const parts = message.split(' ');
  const userId = ctx.from?.id || 'unknown';

  console.log(`[Bot] /scannew command received from user ${userId}`);

  if (!transactionService) {
    await ctx.reply(
      '❌ Coin discovery requires HELIUS_API_KEY to be set for transaction analysis.',
    );
    return;
  }

  // Parse command - support "auto" mode or manual token addresses
  let tokenAddresses: string[] = [];
  let autoMode = false;
  let hours = 24;

  if (parts.length < 2) {
    await ctx.reply(
      '❌ Please provide token address(es) or use auto mode.\n\n' +
        'Examples:\n' +
        '/scannew auto [hours] - Auto-discover tokens from last N hours (default: 24)\n' +
        '/scannew <token_address> - Scan specific token\n' +
        '/scannew <token1> <token2> <token3> - Scan multiple tokens\n\n' +
        '💡 Tip: Use "auto" mode to automatically find and scan new tokens!',
    );
    return;
  }

  // Check if first argument is "auto"
  if (parts[1].toLowerCase() === 'auto') {
    autoMode = true;
    // Parse hours if provided
    if (parts.length > 2) {
      const hoursInput = parseInt(parts[2], 10);
      if (!isNaN(hoursInput) && hoursInput > 0 && hoursInput <= 168) {
        hours = hoursInput; // Max 7 days
      }
    }

    await ctx.reply(
      `🔍 Auto-discovering tokens from last ${hours} hours...\n\n` +
        `⏳ This may take a few minutes. Finding tradeable tokens...`,
    );

    try {
      const discoveredTokens = await coinDiscoveryService.discoverNewTokens(
        hours,
        50, // Limit to 50 for discovery, then filter down
      );

      if (discoveredTokens.length === 0) {
        await ctx.reply(
          `❌ No new tokens automatically discovered in the last ${hours} hours.\n\n` +
            `💡 *Why this might happen:*\n` +
            `• Automatic discovery is limited on free tier\n` +
            `• Token parsing requires detailed transaction analysis\n\n` +
            `*Try these alternatives:*\n` +
            `• Increase hours: \`/scannew auto 48\`\n` +
            `• Provide tokens manually: \`/scannew <token1> <token2>\`\n` +
            `• Get tokens from DexScreener trending/new pairs page\n\n` +
            `*Future:* Full auto-discovery requires Helius webhooks (premium feature)`,
          { parse_mode: 'Markdown' },
        );
        return;
      }

      tokenAddresses = discoveredTokens.slice(0, 20); // Limit to 20 for scanning
      console.log(
        `[Bot] Auto-discovered ${discoveredTokens.length} tokens, scanning top ${tokenAddresses.length}`,
      );
    } catch (error) {
      console.error('[Bot] Error in auto-discovery:', error);
      await ctx.reply(
        `❌ Error during auto-discovery: ${
          error instanceof Error ? error.message : 'Unknown error'
        }\n\n` +
          `💡 You can still provide token addresses manually: /scannew <token1> <token2>`,
      );
      return;
    }
  } else {
    // Manual mode: parse token addresses
    tokenAddresses = parts.slice(1).filter((addr) => {
      const trimmed = addr.trim().replace(',', '');
      return trimmed.length >= 32 && trimmed.length <= 44;
    });

    if (tokenAddresses.length === 0) {
      await ctx.reply('❌ No valid token addresses provided.');
      return;
    }

    if (tokenAddresses.length > 10) {
      await ctx.reply(
        '❌ Maximum 10 tokens per scan. Please reduce the number of tokens.',
      );
      return;
    }
  }

  await ctx.reply(
    `🔍 Scanning ${tokenAddresses.length} token(s)... This may take a few minutes.\n\n` +
      `⏳ Applying safety filters → Market health filters → 3-layer analysis...`,
  );

  try {
    const results: Array<{
      coin: any;
      score: number;
    }> = [];

    // Scan each token
    for (let i = 0; i < tokenAddresses.length; i++) {
      const tokenAddress = tokenAddresses[i].trim().replace(',', '');
      console.log(
        `[Bot] Scanning token ${i + 1}/${
          tokenAddresses.length
        }: ${tokenAddress.slice(0, 8)}...`,
      );

      try {
        const discoveredCoin = await coinDiscoveryService.scanToken(
          tokenAddress,
        );

        if (discoveredCoin) {
          results.push({
            coin: discoveredCoin,
            score: discoveredCoin.overallScore,
          });
        }
      } catch (error) {
        console.error(`[Bot] Error scanning token ${tokenAddress}:`, error);
        // Continue with next token
      }
    }

    // Sort by overall score (highest first)
    results.sort((a, b) => b.score - a.score);

    // Filter to only passed tokens
    const passedTokens = results.filter(
      (r) =>
        r.coin.safetyFilter.passed &&
        r.coin.marketHealthFilter.passed &&
        r.coin.profitPotential > 0,
    );

    if (passedTokens.length === 0) {
      await ctx.reply(
        `❌ No tokens passed all filters from ${tokenAddresses.length} scanned.\n\n` +
          `All tokens were filtered out by:\n` +
          `- Safety filters (scams, honeypots, etc.)\n` +
          `- Market health filters (MC, liquidity, holders, etc.)\n` +
          `- 3-layer analysis (entry opportunity assessment)`,
      );
      return;
    }

    // Format results
    let message = `✅ *Coin Discovery Results*\n\n`;
    message += `📊 *Summary:*\n`;
    message += `Scanned: ${tokenAddresses.length}\n`;
    message += `Passed All Filters: ${passedTokens.length}\n`;
    message += `Top Opportunities: ${Math.min(5, passedTokens.length)}\n\n`;

    // Show top 5 opportunities
    const topOpportunities = passedTokens.slice(0, 5);
    message += `🎯 *Top Opportunities:*\n\n`;

    topOpportunities.forEach((result, index) => {
      const coin = result.coin;
      const recEmoji = {
        strong: '🟢',
        good: '✅',
        cautious: '⚠️',
        avoid: '🚨',
      };

      message += `${index + 1}. *${coin.tokenInfo.name || 'Unknown'}* (${
        coin.tokenInfo.symbol || 'N/A'
      })\n`;
      message += `   Address: \`${coin.tokenAddress.slice(
        0,
        8,
      )}...${coin.tokenAddress.slice(-6)}\`\n`;

      if (coin.tokenInfo.price) {
        const supply = coin.tokenInfo.supply || 0;
        const mc = coin.tokenInfo.price * supply;
        const formatMC = (mc: number) => {
          if (mc >= 1e9) return `$${(mc / 1e9).toFixed(2)}B`;
          if (mc >= 1e6) return `$${(mc / 1e6).toFixed(2)}M`;
          if (mc >= 1e3) return `$${(mc / 1e3).toFixed(2)}K`;
          return `$${mc.toFixed(2)}`;
        };
        message += `   Price: $${coin.tokenInfo.price.toFixed(8)} (${formatMC(
          mc,
        )} MC)\n`;
      }

      message += `   Score: ${coin.overallScore}/100\n`;
      message += `   Profit Potential: ${coin.profitPotential}%\n`;

      if (coin.threeLayerAnalysis) {
        message += `   Entry: ${
          recEmoji[
            coin.threeLayerAnalysis.entryRecommendation as keyof typeof recEmoji
          ]
        } ${coin.threeLayerAnalysis.entryRecommendation.toUpperCase()}\n`;
      }

      message += `\n`;
    });

    // Add details for top opportunity
    if (topOpportunities.length > 0) {
      const top = topOpportunities[0].coin;
      message += `\n📋 *Top Pick Details:*\n`;
      message += `Safety: ✅ Passed\n`;
      message += `Market Health: ${top.marketHealthFilter.score}/100\n`;

      if (top.threeLayerAnalysis) {
        message += `3-Layer Score: ${top.threeLayerAnalysis.combinedScore}/100\n`;
        message += `Opportunity: ${
          top.threeLayerAnalysis.isDipOpportunity ? '✅ YES' : '❌ NO'
        }\n`;
      }

      message += `\n💡 Use /threelayer ${top.tokenAddress} for full analysis`;
    }

    await ctx.reply(message, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error in scannew command:', error);
    await ctx.reply(
      `❌ Error scanning tokens: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    );
  }
});

// Error handling
bot.catch((err: { ctx: Context; error: unknown }) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;

  if (e instanceof Error) {
    console.error('Error details:', e.message);
  }
});

// Start bot
console.log('🤖 Bot is starting...');

if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN is not set in environment variables!');
  console.error('Please create a .env file with your bot token.');
  process.exit(1);
}

// Test bot connection first
console.log('🔍 Testing bot connection...');
bot.api
  .getMe()
  .then((me) => {
    console.log(`✅ Connected as @${me.username}`);
    console.log('🚀 Starting bot polling...');
    return bot.start();
  })
  .then(() => {
    console.log('✅ Bot is running and ready!');
  })
  .catch((error: unknown) => {
    console.error('❌ Failed to start bot:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }
    process.exit(1);
  });
