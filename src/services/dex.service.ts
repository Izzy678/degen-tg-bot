import axios from 'axios';
import { TokenInfo } from '../types/token.types';

export class DexService {
  private dexScreenerApi = 'https://api.dexscreener.com/latest/dex';

  /**
   * Get token information from DexScreener
   */
  async getTokenInfo(tokenAddress: string): Promise<TokenInfo | null> {
    try {
      console.log(`[DexService] Fetching token info from DexScreener for ${tokenAddress.slice(0, 8)}...`);
      const response = await axios.get(
        `${this.dexScreenerApi}/tokens/${tokenAddress}`
      );
      console.log(`[DexService] DexScreener response received`);

      if (response.data?.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0]; // Get the most liquid pair
        
        return {
          address: tokenAddress,
          symbol: pair.baseToken?.symbol,
          name: pair.baseToken?.name,
          decimals: pair.baseToken?.decimals || 9,
          supply: parseFloat(pair.baseToken?.totalSupply || '0'),
          marketCap: pair.marketCap || 0,
          price: pair.priceUsd ? parseFloat(pair.priceUsd) : undefined,
          liquidity: pair.liquidity?.usd || 0,
        };
      }

      return null;
    } catch (error) {
      console.error('Error fetching token info from DexScreener:', error);
      return null;
    }
  }

  /**
   * Get price data for a token
   */
  async getTokenPrice(tokenAddress: string): Promise<number | null> {
    try {
      const tokenInfo = await this.getTokenInfo(tokenAddress);
      return tokenInfo?.price || null;
    } catch (error) {
      console.error('Error fetching token price:', error);
      return null;
    }
  }

  /**
   * Get trading volume data
   */
  async getTradingVolume(tokenAddress: string): Promise<{
    volume24h: number;
    volume5m: number;
    volume1h: number;
  } | null> {
    try {
      const response = await axios.get(
        `${this.dexScreenerApi}/tokens/${tokenAddress}`
      );

      if (response.data?.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0];
        return {
          volume24h: pair.volume?.h24 || 0,
          volume5m: pair.volume?.m5 || 0,
          volume1h: pair.volume?.h1 || 0,
        };
      }

      return null;
    } catch (error) {
      console.error('Error fetching trading volume:', error);
      return null;
    }
  }

  /**
   * Get buy/sell ratio (if available)
   */
  async getBuySellRatio(tokenAddress: string): Promise<number | null> {
    try {
      // DexScreener might not have this directly, but we can infer from price movements
      // This is a placeholder - you might need to use other APIs or calculate from transactions
      const volume = await this.getTradingVolume(tokenAddress);
      if (!volume) return null;

      // Simplified: if price is going up, assume more buys than sells
      // In production, you'd analyze actual transaction data
      return null; // Would need transaction-level analysis
    } catch (error) {
      console.error('Error calculating buy/sell ratio:', error);
      return null;
    }
  }

  /**
   * Get price history for technical analysis
   * Note: DexScreener doesn't provide historical OHLCV data directly
   * This is a simplified version using current pair data
   */
  async getPriceHistory(tokenAddress: string): Promise<Array<{
    timestamp: number;
    price: number;
    volume: number;
  }> | null> {
    try {
      console.log(`[DexService] Fetching price history for ${tokenAddress.slice(0, 8)}...`);
      const response = await axios.get(
        `${this.dexScreenerApi}/tokens/${tokenAddress}`
      );

      if (response.data?.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0];
        const currentPrice = pair.priceUsd ? parseFloat(pair.priceUsd) : 0;
        
        // DexScreener doesn't provide historical data in free API
        // We'll create a simplified price array based on current data
        // In production, you'd use a different API or fetch from blockchain
        const priceHistory: Array<{
          timestamp: number;
          price: number;
          volume: number;
        }> = [];

        // Use price change data to simulate recent price history
        const priceChange24h = pair.priceChange?.h24 || 0;
        const currentTime = Date.now();
        
        // Create 24 data points (hourly) based on price change
        for (let i = 23; i >= 0; i--) {
          const hoursAgo = i;
          const timestamp = currentTime - (hoursAgo * 60 * 60 * 1000);
          // Simulate price based on 24h change (linear interpolation)
          const priceMultiplier = 1 - (priceChange24h / 100) * (hoursAgo / 24);
          const price = currentPrice * priceMultiplier;
          const volume = (pair.volume?.h24 || 0) / 24; // Distribute 24h volume evenly
          
          priceHistory.push({
            timestamp,
            price: Math.max(0, price),
            volume,
          });
        }

        console.log(`[DexService] Generated ${priceHistory.length} price data points`);
        return priceHistory;
      }

      return null;
    } catch (error) {
      console.error('[DexService] Error fetching price history:', error);
      return null;
    }
  }

  /**
   * Get detailed pair information including price changes
   */
  async getPairData(tokenAddress: string): Promise<{
    price: number;
    priceChange24h: number;
    priceChange1h: number;
    priceChange5m: number;
    high24h: number;
    low24h: number;
    volume24h: number;
  } | null> {
    try {
      const response = await axios.get(
        `${this.dexScreenerApi}/tokens/${tokenAddress}`
      );

      if (response.data?.pairs && response.data.pairs.length > 0) {
        const pair = response.data.pairs[0];
        return {
          price: pair.priceUsd ? parseFloat(pair.priceUsd) : 0,
          priceChange24h: pair.priceChange?.h24 || 0,
          priceChange1h: pair.priceChange?.h1 || 0,
          priceChange5m: pair.priceChange?.m5 || 0,
          high24h: pair.priceUsd ? parseFloat(pair.priceUsd) * (1 + Math.abs(pair.priceChange?.h24 || 0) / 100) : 0,
          low24h: pair.priceUsd ? parseFloat(pair.priceUsd) * (1 - Math.abs(pair.priceChange?.h24 || 0) / 100) : 0,
          volume24h: pair.volume?.h24 || 0,
        };
      }

      return null;
    } catch (error) {
      console.error('[DexService] Error fetching pair data:', error);
      return null;
    }
  }
}

