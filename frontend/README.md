
## Token discovery

The web Swap tab displays a read-only 1inch token catalog for Robinhood Chain
(4663), Ethereum (1), and Monad (143). Robinhood Stock Token contracts are
cross-checked against Robinhood's official `/rhj/assets` API. The RWA filter on
Ethereum and Monad uses the explicit 1inch `RWA` token tag. A token's presence
in the list does not mean a Fusion order can be filled; a live quote for the
selected pair, amount, and wallet is required before adding execution.
The backend serves `GET /v1/tokens` in pages with explicit `chainId`,
`category`, `search`, `page` (zero based), and `items` (1–100) query fields.
The response includes `list`, `page`, `items`, and `total`. The Swap tab loads
60 tokens per page.

To load the catalog locally, put `ONEINCH_API_KEY` in `backend/.env` (see
`backend/.env.example`), start the backend, then run `npm run dev` in
`frontend/`. The key stays on the backend and must not use the `VITE_` prefix.
