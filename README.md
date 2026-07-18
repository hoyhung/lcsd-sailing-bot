# LCSD Bot

This project is a Node.js bot that monitors sailboarding course availability from the Leisure and Cultural Services Department (LCSD) open data API. It checks for activities with remaining quota and sends WhatsApp notifications when new opportunities are detected.

## Features

- Fetches activity data from the LCSD open data API
- Filters for sailboarding activities
- Checks whether an activity is already open and still has places left
- Uses Upstash Redis to avoid sending duplicate notifications
- Sends alerts through CallMeBot WhatsApp

## Requirements

- Node.js 18+
- npm
- Upstash Redis account
- CallMeBot WhatsApp API key

## Installation

```bash
npm install
```

## Environment Variables

Create a `.env` file and add the following values:

```env
UPSTASH_REDIS_REST_URL=your_upstash_redis_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_token
PHONE_NUMBER=your_whatsapp_phone_number
CALLMEBOT_API_KEY=your_callmebot_api_key
```

## Run Locally

```bash
node index.js
```

## Project Structure

```text
.
├── index.js          # Main application logic
├── package.json      # Dependencies and scripts
├── .env              # Local environment variables
└── README.md         # Project documentation
```

## GitHub Actions Deployment

You can run this bot automatically using GitHub Actions.

### 1. Add a workflow file

Create a file at `.github/workflows/lcsd-bot.yml` with the following content:

```yaml
name: LCSD Bot

on:
  schedule:
    - cron: '*/30 * * * *'
  workflow_dispatch:

jobs:
  run-bot:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm install

      - name: Run bot
        env:
          UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}
          UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}
          PHONE_NUMBER: ${{ secrets.PHONE_NUMBER }}
          CALLMEBOT_API_KEY: ${{ secrets.CALLMEBOT_API_KEY }}
        run: node index.js
```

### 2. Add GitHub Secrets

In your GitHub repository, go to Settings → Secrets and variables → Actions and add these secrets:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `PHONE_NUMBER`
- `CALLMEBOT_API_KEY`

### 3. Enable workflow

Commit and push the workflow file. GitHub Actions will run the bot automatically based on the schedule.

## Notes

- The script currently checks the data once when it runs. For recurring checks, use GitHub Actions or another scheduler.
- If the LCSD API response format changes, the parsing logic may need to be updated.
- Redis is used to remember previously notified activities and avoid duplicate alerts.

## Dependencies

- axios
- dotenv
- @upstash/redis
- node-cron
