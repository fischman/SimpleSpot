FROM alpine
RUN apk add --no-cache chromium python3 \
  && wget -O /usr/local/bin/biome https://github.com/biomejs/biome/releases/latest/download/biome-linux-x64-musl \
  && chmod +x /usr/local/bin/biome
