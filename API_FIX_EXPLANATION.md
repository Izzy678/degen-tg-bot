# API Fix Explanation

## The Problem

The Helius Enhanced Transactions API was returning an error:

```
{ jsonrpc: '2.0', error: { code: -32600, message: 'invalid address' } }
```

## Root Cause

**Token Address vs Pair Address Confusion:**

1. **Token Address (Mint Address)**:

   - The SPL token mint address (e.g., `9cu2U81U...`)
   - Identifies the token itself
   - Example: The USDC token mint address

2. **Pair Address (Liquidity Pool Address)**:
   - The DEX liquidity pool address where trades happen (e.g., `28K1LdM3eUGTxJRFewJ7mTEjjFLH3tj1JZZ3i5ufCUFL`)
   - This is where swap transactions actually occur
   - Example: A Raydium SOL/USDC pool address

**The Issue**: We were trying to use the Enhanced API with addresses it might not accept, or the API format was incorrect.

## The Solution

Instead of relying on the Enhanced API (which has unclear requirements), we now:

1. **Get the pair address** from DexScreener (where swaps actually happen)
2. **Use standard Solana RPC** `getSignaturesForAddress()` on the pair address
3. **Parse transaction data** by fetching full transaction details
4. **Determine buy/sell** by analyzing token balance changes

## How It Works Now

```
Token Address (from user)
    ↓
Get Pair Address (from DexScreener)
    ↓
Get Transaction Signatures (RPC: getSignaturesForAddress on pair)
    ↓
Fetch & Parse Transactions (RPC: getTransaction)
    ↓
Analyze Buy/Sell from token balance changes
    ↓
Calculate ratios, detect MEV, etc.
```

## Benefits

✅ **More Reliable**: Uses standard RPC methods that work consistently  
✅ **Free Tier Compatible**: Stays within Helius free tier limits  
✅ **Accurate**: Parses actual transaction data to determine buy/sell  
✅ **Fallback**: Works even if Enhanced API is unavailable

## Trade-offs

⚠️ **Slower**: Parsing individual transactions takes more time  
⚠️ **Limited Sample**: Parses first 20 transactions to save API calls  
⚠️ **More API Calls**: Each transaction requires a separate `getTransaction` call

## Future Improvements

- Cache parsed transaction data more aggressively
- Use Helius Enhanced API if/when format is clarified
- Batch transaction parsing for better performance
- Add more sophisticated buy/sell detection from DEX instruction parsing
