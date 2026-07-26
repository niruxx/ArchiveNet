# ArchiveNet
Self-Hosted & Easy to set up Archive.org and ArchiveBox alternative.

Type a URL into the address bar and ArchiveNet renders the page in headless Chrome, then saves it as both HTML and PDF. Same-domain links found on that page are archived too (one level deep).

## How archives are organized

```
archived/
  example.com/
    2026-07-25_21-35-56/            <- root URL (https://example.com/)
      page.html
      page.pdf
      metadata.json
    sub-links/
      blog/
        post-1/
          2026-07-25_21-36-10/      <- https://example.com/blog/post-1
            page.html
            page.pdf
            metadata.json
```

- A URL with no path goes directly under `archived/<domain>/<timestamp>/`.
- A URL with a path is nested under `archived/<domain>/sub-links/<path>/<timestamp>/`.
- This rule applies both to the URL you type and to any same-domain links discovered on that page (up to 15 per request, configured via `MAX_SUBLINKS` in `lib/archiver.js`).

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer.
- On Linux, Chromium (used via Puppeteer) needs a few system libraries. If `npm start` fails to launch the browser, install them, e.g. on Debian/Ubuntu:
  ```
  sudo apt-get install -y ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
    libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
    libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 xdg-utils
  ```

## Setup

```
npm install
```

The first install downloads a bundled Chromium via Puppeteer's postinstall script. If your environment blocks install scripts (e.g. npm's `allow-scripts` guard), approve it first:

```
npm approve-scripts puppeteer
npm install
```

## Running locally

```
npm start
```

Then open `http://localhost:3000`. The port can be changed with the `PORT` environment variable:

```
PORT=8080 npm start
```

Archived files are written to `archived/` in the project root and served back at `http://localhost:<port>/archived/...` so the result cards in the UI can link straight to the saved HTML/PDF.

## Hosting it

ArchiveNet is a plain Node/Express process — any host that can run a long-lived Node service works. A typical self-hosted setup:

1. **Get the code onto the server** and run `npm install` there (Chromium is downloaded per-platform, so don't just copy `node_modules/` from a different OS).
2. **Keep it running** with a process manager, for example [pm2](https://pm2.keymetrics.io/):
   ```
   npm install -g pm2
   pm2 start server.js --name archivenet
   pm2 save
   pm2 startup   # wires pm2 into your OS's boot process
   ```
   On Linux you can use a systemd unit instead:
   ```ini
   # /etc/systemd/system/archivenet.service
   [Unit]
   Description=ArchiveNet
   After=network.target

   [Service]
   WorkingDirectory=/opt/archivenet
   ExecStart=/usr/bin/node server.js
   Environment=PORT=3000
   Restart=on-failure
   User=archivenet

   [Install]
   WantedBy=multi-user.target
   ```
   Then `sudo systemctl enable --now archivenet`.
3. **Put a reverse proxy in front of it** (nginx, Caddy, etc.) to handle TLS and your domain name, proxying to `http://127.0.0.1:3000`. Caddy example:
   ```
   archive.yourdomain.com {
     reverse_proxy 127.0.0.1:3000
   }
   ```
4. **Persist the `archived/` directory.** It holds every saved archive, so back it up like you would a database and, if you containerize the app, mount it as a volume rather than baking it into the image.
5. **Access control.** ArchiveNet has no authentication of its own — anything reachable can trigger an archive and browse `archived/`. If exposing it beyond your local network, put it behind your reverse proxy's auth (e.g. Caddy's `basic_auth`, an nginx `auth_basic` block, or a VPN/tailnet) rather than the open internet.

### Docker (optional)

If you prefer a container, Puppeteer's official base image already includes Chromium and its dependencies:

```dockerfile
FROM ghcr.io/puppeteer/puppeteer:22.15.0
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
```

Mount `archived/` as a volume so archives survive container restarts:

```
docker build -t archivenet .
docker run -d -p 3000:3000 -v $(pwd)/archived:/app/archived --name archivenet archivenet
```
