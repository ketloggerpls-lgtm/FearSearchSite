#!/bin/bash
set -e

# If DISCORD_TOKEN is set, this is the bot service
if [ -n "$DISCORD_TOKEN" ]; then
    echo "[entrypoint] Starting FearSearch Bot (Python)..."
    exec python bot.py
fi

# Otherwise, this is the site service
echo "[entrypoint] Starting FearSearch Site (Node.js)..."
cd /app/VibeCodingBdd
exec node src/server.js
