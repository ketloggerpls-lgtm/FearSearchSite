#!/bin/sh
set -e

if [ "$SERVICE_ROLE" = "bot" ]; then
  exec python bot.py
else
  cd /app/VibeCodingBdd
  exec node src/server.js
fi
