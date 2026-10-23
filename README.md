# spline · SPL-16

Draw the curve. Launch the coin. Hand-drawn bonding curves on Meteora DBC.

A creator draws up to 16 price points on a canvas. The drawing becomes a per-coin Meteora DBC config (`buildCurveWithCustomSqrtPrices`), created together with the pool in one transaction signed by the creator's wallet. spline is the partner on every config (fee claimer = `HOUSE_WALLET`); the creator is the pool creator. Nothing is held by the server.

## Run
```
npm install
cp .env.example .env   # fill HOUSE_WALLET, HELIUS_API_KEY
npm run dev            # http://localhost:8792
```
`DRY_RUN=1` fakes launches so you can click through locally with no wallet.

## Files
- `lib/curve.js` — points → prices → DBC config; `quote()` derives graduation SOL etc. from the real segments
- `lib/launch.js` — builds the unsigned createConfigAndPool tx for the creator to sign
- `lib/meteora.js` — SDK wrapper (pool stats, claims)
- `lib/icon.js` — a coin's icon is its curve (SVG; PNG if `sharp` is installed)
- `server.js` — API + price sampler
- `public/` — one HTML + one JS + one CSS

## Deploy
Render blueprint in `render.yaml`. Set `SITE_URL`, `HOUSE_WALLET`, `HELIUS_API_KEY`. Optional `PINATA_JWT` + `ASSET_STORE=pinata` to pin icons to IPFS.
