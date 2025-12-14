import { Connection, PublicKey, ParsedAccountData } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

// TOKEN_PROGRAM_ID constant if import fails
const TOKEN_PROGRAM_ID_ALT = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
);

export class SolanaService {
  private connection: Connection;
  private rpcEndpoint: string;

  constructor(rpcEndpoint?: string) {
    // Use provided RPC or default to Helius free tier
    // If no endpoint provided, will use public Solana RPC (limited)
    this.rpcEndpoint = rpcEndpoint || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(this.rpcEndpoint, 'confirmed');
  }

  /**
   * Get token supply information
   */
  async getTokenSupply(tokenAddress: string): Promise<{
    supply: number;
    decimals: number;
  }> {
    try {
      console.log(
        `[SolanaService] Fetching token supply for ${tokenAddress.slice(
          0,
          8,
        )}...`,
      );
      const mintPubkey = new PublicKey(tokenAddress);
      const supplyInfo = await this.connection.getTokenSupply(mintPubkey);

      const supply =
        Number(supplyInfo.value.amount) /
        Math.pow(10, supplyInfo.value.decimals);
      console.log(
        `[SolanaService] Token supply: ${supply.toLocaleString()}, decimals: ${
          supplyInfo.value.decimals
        }`,
      );

      return {
        supply,
        decimals: supplyInfo.value.decimals,
      };
    } catch (error) {
      console.error('[SolanaService] Error fetching token supply:', error);
      throw error;
    }
  }

  /**
   * Get all token accounts for a specific token (holders)
   * This fetches all accounts holding the token
   */
  async getTokenHolders(
    tokenAddress: string,
    limit: number = 200,
  ): Promise<
    Array<{
      address: string;
      balance: number;
    }>
  > {
    try {
      console.log(
        `[SolanaService] Fetching token holders for ${tokenAddress.slice(
          0,
          8,
        )}... (limit: ${limit})`,
      );
      const mintPubkey = new PublicKey(tokenAddress);
      const tokenProgramId = TOKEN_PROGRAM_ID || TOKEN_PROGRAM_ID_ALT;

      console.log(
        `[SolanaService] Querying token program accounts with mint filter...`,
      );

      // Try multiple approaches to get token holders
      // The mint is stored as raw bytes (32 bytes) at offset 0 in token account
      let tokenAccounts: any[] = [];

      // Approach 1: Try getParsedProgramAccounts with base58 (some RPCs accept this)
      try {
        console.log(
          `[SolanaService] Attempting method 1: getParsedProgramAccounts with base58...`,
        );
        tokenAccounts = await this.connection.getParsedProgramAccounts(
          tokenProgramId,
          {
            filters: [
              {
                dataSize: 165,
              },
              {
                memcmp: {
                  offset: 0,
                  bytes: mintPubkey.toBase58(), // Try base58 string
                },
              },
            ],
          },
        );
        console.log(
          `[SolanaService] Method 1 succeeded: Found ${tokenAccounts.length} accounts`,
        );

        // If Method 1 returned 0 results, try Helius getTokenAccounts API
        // This is Helius's dedicated method for getting token holders
        // See: https://www.helius.dev/blog/how-to-get-token-holders-on-solana
        if (tokenAccounts.length === 0) {
          console.log(
            `[SolanaService] Method 1 returned 0 results, trying Helius getTokenAccounts API...`,
          );
          try {
            const mintAddress = mintPubkey.toBase58();

            // Fetch token decimals once (needed for converting raw amount to UI amount)
            let decimals = 6; // Default fallback
            try {
              const supplyInfo = await this.getTokenSupply(tokenAddress);
              decimals = supplyInfo.decimals;
              console.log(`[SolanaService] Token decimals: ${decimals}`);
            } catch (decimalsError) {
              console.warn(
                `[SolanaService] Could not fetch token decimals, using default 6: ${
                  decimalsError instanceof Error
                    ? decimalsError.message
                    : decimalsError
                }`,
              );
            }

            let allTokenAccounts: any[] = [];
            let page = 1;
            const maxPages = 100; // Safety limit

            while (page <= maxPages) {
              console.log(
                `[SolanaService] Fetching token accounts page ${page}...`,
              );

              // Use Helius getTokenAccounts API
              // Documentation: https://www.helius.dev/blog/how-to-get-token-holders-on-solana
              const rpcBody = {
                jsonrpc: '2.0',
                method: 'getTokenAccounts',
                id: `helius-${page}`,
                params: {
                  page: page,
                  limit: 1000, // Max 1000 per page
                  displayOptions: {},
                  mint: mintAddress,
                },
              };

              const response = await fetch(this.rpcEndpoint, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(rpcBody),
              });

              if (!response.ok) {
                throw new Error(
                  `HTTP ${response.status}: ${response.statusText}`,
                );
              }

              const data = (await response.json()) as {
                error?: { message: string };
                result?: {
                  token_accounts: Array<{
                    address: string;
                    mint: string;
                    owner: string;
                    amount: number;
                    delegated_amount: number;
                    frozen: boolean;
                  }>;
                };
              };

              if (data.error) {
                throw new Error(data.error.message || 'RPC error');
              }

              if (
                !data.result ||
                !data.result.token_accounts ||
                data.result.token_accounts.length === 0
              ) {
                console.log(
                  `[SolanaService] No more results. Total pages: ${page - 1}`,
                );
                break;
              }

              console.log(
                `[SolanaService] Page ${page}: Found ${data.result.token_accounts.length} token accounts`,
              );

              // Convert Helius format to our expected format
              const convertedAccounts = data.result.token_accounts.map(
                (tokenAccount) => {
                  // Convert raw amount to UI amount using actual decimals
                  const uiAmount = tokenAccount.amount / Math.pow(10, decimals);

                  return {
                    pubkey: new PublicKey(tokenAccount.address),
                    account: {
                      data: {
                        parsed: {
                          info: {
                            mint: tokenAccount.mint,
                            owner: tokenAccount.owner,
                            tokenAmount: {
                              uiAmount: uiAmount,
                              amount: tokenAccount.amount.toString(),
                            },
                          },
                        },
                      } as ParsedAccountData,
                      executable: false,
                      lamports: 0,
                      owner: new PublicKey(tokenAccount.owner),
                    },
                  };
                },
              );

              allTokenAccounts = allTokenAccounts.concat(convertedAccounts);
              page++;
            }

            tokenAccounts = allTokenAccounts;
            console.log(
              `[SolanaService] Helius getTokenAccounts succeeded: Found ${
                tokenAccounts.length
              } token accounts across ${page - 1} pages`,
            );
          } catch (method3Error) {
            console.error(
              `[SolanaService] Helius getTokenAccounts failed: ${
                method3Error instanceof Error
                  ? method3Error.message
                  : method3Error
              }`,
            );
            console.warn(
              `[SolanaService] Cannot fetch holders - Helius API method failed. Make sure you're using a Helius RPC endpoint with getTokenAccounts support.`,
            );
          }
        }
      } catch (error1) {
        console.log(
          `[SolanaService] Method 1 failed: ${
            error1 instanceof Error ? error1.message : error1
          }`,
        );

        // Approach 2: Use getProgramAccounts with base64 bytes
        try {
          console.log(
            `[SolanaService] Attempting method 2: getProgramAccounts with base64...`,
          );
          const mintBytes = mintPubkey.toBuffer();
          const mintBase64 = Buffer.from(mintBytes).toString('base64');

          const accounts = await this.connection.getProgramAccounts(
            tokenProgramId,
            {
              filters: [
                {
                  dataSize: 165,
                },
                {
                  memcmp: {
                    offset: 0,
                    bytes: mintBase64,
                  },
                },
              ],
            },
          );

          // Parse accounts
          tokenAccounts = await Promise.all(
            accounts.map(async (account) => {
              try {
                const parsed = await this.connection.getParsedAccountInfo(
                  account.pubkey,
                );
                if (parsed.value && parsed.value.data) {
                  return {
                    pubkey: account.pubkey,
                    account: parsed.value,
                  };
                }
                return null;
              } catch {
                return null;
              }
            }),
          );
          tokenAccounts = tokenAccounts.filter((a) => a !== null);
          console.log(
            `[SolanaService] Method 2 succeeded: Found ${tokenAccounts.length} accounts`,
          );
        } catch (error2) {
          console.log(
            `[SolanaService] Method 2 failed: ${
              error2 instanceof Error ? error2.message : error2
            }`,
          );

          // Approach 3: Get all token accounts and filter manually (works but slower)
          try {
            console.log(
              `[SolanaService] Attempting method 3: Get all accounts and filter...`,
            );
            const allAccounts = await this.connection.getParsedProgramAccounts(
              tokenProgramId,
              {
                filters: [
                  {
                    dataSize: 165,
                  },
                ],
              },
            );

            // Filter by mint manually
            tokenAccounts = allAccounts.filter((account) => {
              const parsed = account.account.data as ParsedAccountData;
              const accountMint = parsed.parsed?.info?.mint;
              return accountMint === mintPubkey.toBase58();
            });

            console.log(
              `[SolanaService] Method 3 succeeded: Found ${tokenAccounts.length} accounts (filtered from ${allAccounts.length} total)`,
            );
          } catch (error3) {
            console.error(
              `[SolanaService] All methods failed. Last error: ${
                error3 instanceof Error ? error3.message : error3
              }`,
            );
            return [];
          }
        }
      }

      console.log(
        `[SolanaService] Found ${tokenAccounts.length} token accounts, processing...`,
      );

      if (tokenAccounts.length === 0) {
        console.warn(
          `[SolanaService] ⚠️ No token accounts found. Possible reasons:`,
        );
        console.warn(
          `[SolanaService] 1. Public RPC endpoint limitations (rate limits or query restrictions)`,
        );
        console.warn(
          `[SolanaService] 2. Token might be very new with no holders yet`,
        );
        console.warn(
          `[SolanaService] 3. Query complexity exceeds public RPC limits`,
        );
        console.warn(
          `[SolanaService] 💡 Recommendation: Use a premium RPC endpoint (Helius, QuickNode) for reliable holder data`,
        );
        return [];
      }

      const holders: Array<{ address: string; balance: number }> = [];

      for (const account of tokenAccounts) {
        const parsedInfo = account.account.data as ParsedAccountData;
        if (parsedInfo.parsed?.info?.tokenAmount) {
          const owner = parsedInfo.parsed.info.owner;
          const amount = parsedInfo.parsed.info.tokenAmount.uiAmount || 0;

          if (amount > 0) {
            holders.push({
              address: owner,
              balance: amount,
            });
          }
        }
      }

      // Sort by balance descending and limit
      holders.sort((a, b) => b.balance - a.balance);
      const limitedHolders = holders.slice(0, limit);
      console.log(
        `[SolanaService] Returning ${
          limitedHolders.length
        } holders (top holder: ${
          limitedHolders[0]?.balance.toLocaleString() || 0
        })`,
      );

      if (limitedHolders.length === 0) {
        console.warn(`[SolanaService] No holders found. This might indicate:`);
        console.warn(`[SolanaService] 1. Token has no holders yet`);
        console.warn(`[SolanaService] 2. RPC rate limiting`);
        console.warn(`[SolanaService] 3. Token account structure issue`);
      }

      return limitedHolders;
    } catch (error) {
      console.error('[SolanaService] Error fetching token holders:', error);
      if (error instanceof Error) {
        console.error('[SolanaService] Error details:', error.message);
        if (
          error.message.includes('429') ||
          error.message.includes('rate limit')
        ) {
          console.error(
            '[SolanaService] Rate limit hit - consider using a premium RPC endpoint',
          );
        }
      }
      // Fallback: Try using a different method or return empty array
      console.warn(
        '[SolanaService] Falling back to alternative method or returning empty results',
      );
      return [];
    }
  }

  /**
   * Get transaction history for a wallet
   * This helps analyze trading patterns
   * NOTE: This is rate-limited and should be used sparingly
   */
  async getWalletTransactions(
    walletAddress: string,
    limit: number = 100,
  ): Promise<
    Array<{
      signature: string;
      timestamp: Date;
      type: 'buy' | 'sell' | 'unknown';
    }>
  > {
    try {
      console.log(
        `[SolanaService] Fetching transactions for wallet ${walletAddress.slice(
          0,
          8,
        )}... (limit: ${limit})`,
      );
      const pubkey = new PublicKey(walletAddress);
      const signatures = await this.connection.getSignaturesForAddress(pubkey, {
        limit,
      });

      console.log(
        `[SolanaService] Found ${signatures.length} transactions for wallet`,
      );

      // Note: Full transaction parsing would require more complex logic
      // This is a simplified version - you'd need to parse transaction details
      // to determine buy/sell with certainty
      return signatures.map((sig) => ({
        signature: sig.signature,
        timestamp: new Date(sig.blockTime! * 1000),
        type: 'unknown' as const, // Would need transaction parsing to determine
      }));
    } catch (error) {
      console.error(
        '[SolanaService] Error fetching wallet transactions:',
        error,
      );
      if (error instanceof Error && error.message.includes('429')) {
        console.warn(
          '[SolanaService] Rate limit hit - skipping transaction fetch',
        );
      }
      return [];
    }
  }

  /**
   * Get token account info for a specific wallet and token
   */
  async getTokenAccountInfo(
    walletAddress: string,
    tokenAddress: string,
  ): Promise<{ balance: number; owner: string } | null> {
    try {
      const walletPubkey = new PublicKey(walletAddress);
      const tokenMintPubkey = new PublicKey(tokenAddress);

      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { mint: tokenMintPubkey },
      );

      if (tokenAccounts.value.length > 0) {
        const account = tokenAccounts.value[0];
        const balance =
          account.account.data.parsed.info.tokenAmount.uiAmount || 0;
        return {
          balance,
          owner: walletAddress,
        };
      }

      return null;
    } catch (error) {
      console.error('Error fetching token account info:', error);
      return null;
    }
  }

  /**
   * Get recent transactions for a token
   * This helps analyze trading patterns
   */
  async getTokenTransactions(
    tokenAddress: string,
    limit: number = 50,
  ): Promise<
    Array<{
      signature: string;
      timestamp: Date;
    }>
  > {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      // This is a simplified approach - in production you'd use a more sophisticated method
      // to get token-specific transactions
      const signatures = await this.connection.getSignaturesForAddress(
        mintPubkey,
        { limit },
      );

      return signatures.map((sig) => ({
        signature: sig.signature,
        timestamp: new Date(sig.blockTime! * 1000),
      }));
    } catch (error) {
      console.error('Error fetching token transactions:', error);
      return [];
    }
  }
}
