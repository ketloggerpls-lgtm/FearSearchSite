#!/bin/sh
set -e

if [ -n "$DISCORD_TOKEN" ]; then
  exec python bot.py
else
  cd /app/VibeCodingBdd
  exec node src/server.js
fi
