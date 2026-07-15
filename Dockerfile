FROM node:20-slim AS nodebuilder

WORKDIR /site
COPY VibeCodingBdd/package.json VibeCodingBdd/package-lock.json ./
RUN npm install

FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc libffi-dev postgresql-client \
    && rm -rf /var/lib/apt/lists/*

COPY --from=nodebuilder /usr/local/bin/node /usr/local/bin/node
COPY --from=nodebuilder /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bot.py db.py gdrive_backup.py discord_backup.py ./
COPY --from=nodebuilder /site/node_modules ./VibeCodingBdd/node_modules
COPY VibeCodingBdd/ ./VibeCodingBdd/

CMD ["python", "bot.py"]
