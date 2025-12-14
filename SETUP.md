# Degen Bot Setup Guide

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Telegram Bot Token (required)
BOT_TOKEN=your_telegram_bot_token_here

# Solana RPC Endpoint (Helius recommended)
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your_helius_api_key_here

# Helius API Key (for enhanced transaction analysis)
HELIUS_API_KEY=your_helius_api_key_here
```

## Getting Your API Keys

### 1. Telegram Bot Token

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow the instructions
3. Copy the bot token provided

### 2. Helius API Key (Free Tier)

1. Go to [https://helius.dev](https://helius.dev)
2. Sign up for a free account
3. Navigate to Dashboard → API Keys
4. Create a new API key
5. Copy the API key

**Note:** The free tier includes:

- 1M credits/month
- 10 requests/second
- Community support

## Installation

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run the bot
npm start

# Or run in development mode
npm run dev
```

## Features

### Phase 1: Real Transaction Analysis ✅

- Real buy/sell ratio calculation from on-chain data
- Large transaction detection (>$5k)
- Whale activity tracking
- MEV/bot pattern detection
- Multi-timeframe buy/sell ratios (5m, 15m, 1h, 24h)

### Commands

- `/scan <token_address>` - Full token analysis with transaction data
- `/holders <token_address>` - Detailed holder analysis
- `/score <token_address>` - Quick risk/profitability score
- `/entry <token_address>` - Entry point recommendation with market activity

## Rate Limiting

The bot includes built-in rate limiting to stay within Helius free tier limits:

- Maximum 8 requests/second (stays under 10 req/s limit)
- 1-minute caching for transaction data
- Automatic request throttling

## Troubleshooting

### "HELIUS_API_KEY not set" warning

- This is normal if you haven't set up Helius yet
- Transaction analysis will be limited but the bot will still work
- Set `HELIUS_API_KEY` in `.env` to enable full features

### Rate limit errors

- The bot automatically throttles requests
- If you see rate limit errors, wait a few seconds and try again
- Consider upgrading to Helius Developer plan ($49/month) for higher limits

### No transaction data

- New tokens may not have enough transaction history
- Check that the token address is correct
- Ensure Helius API key is valid
