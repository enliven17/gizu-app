# Authorized mainnet test — September 29, 2026

Saved budgets: Ethereum 7.652756 USDC; Robinhood 3.279753 USDC. Both use the same two destination addresses and 10/90 confidential payout weights. Only wallet 2 invests. No wallet-to-wallet transfer, new helper, common application fee recipient, or joint transaction involving both destination wallets is introduced.

## Robinhood — complete, optimal residual achieved

- Source funding transaction: `0x2a2b3be973f3bbe5749fead7850a412e8a92d0f3df868ae35cf68b473925e6d5`.
- Confirmed transfer: 3.267261 Monad USDC to the quoted deposit address. Actual Pimlico gas charge: 0.001626 USDC (signed maximum 0.002626).
- Aurora advanced funding succeeded; authenticated confidential balance: 3.265954 USDC.
- Wallet 1 payout input: 0.326595 confidential USDC; actual received: 0.174875 USDG.
- Wallet 2 payout input: 2.939359 confidential USDC; actual received: 2.773924 USDG.
- Actual deposit: **2.521136 USDG**; 2.499895838304782214 shares minted. The refreshed execution plan kept a 0.175350 USDG withdrawal reserve.
- Full redemption: **2.521136 USDG**; zero shares afterward.
- Aurora return funded: **2.650000 USDG**. Aurora reported SUCCESS and authenticated private balance confirmed **2.636109 USDC**, using the original confidential Monad-USDC asset.
- Final wallet-2 remainder: **0.044207 USDG, zero ETH, zero shares**. Fresh valuation: **0.044211 USDC**, meeting both <0.5 acceptance and <0.1 optimal targets.
- Wallet 1 retains its intentional 10% payout: **0.174875 USDG**. It did not participate in the vault operations.
- Monad source remaining: **7.663622 USDC**, including the untouched 7.652756 Ethereum allocation and 0.010866 unused Robinhood source allowance.

| Operation | Signed maximum gas charge (USDG) | Actual charge (USDG) | Transaction |
| --- | ---: | ---: | --- |
| Deposit | 0.073750 | 0.042774 | `0xc9b55f68e8440744f76826f8bee960abc53183e062d49656b3b173a1d565f551` |
| Withdrawal | 0.059697 | 0.025875 | `0xd73878e17d1e230d3dff97bdbd41e45ad877fe6864d6285fc7589f874810dbb0` |
| Return transfer | 0.025334 | 0.011068 | `0x6a039a08bbde5b823ea6c5ee8ba68123544aa3df448d569deae9cee9bad88c7b` |

Total destination gas paid: **0.079717 USDG**. Receipts show actual fee transfers to the established provider recipient, rather than a Circle-style upfront maximum pull followed by a refund. The final 0.044207 remainder is the 0.055275 return reserve minus the 0.011068 actual return charge. It includes deliberately unused reserve, not just signed-cap headroom.

Evidence: [receipt events](fixtures/robinhood-mainnet-receipts.json) and [independent final balances](fixtures/mainnet-final-balances.json).

Initial Aurora payout quoting returned HTTP 400, then a fresh unsigned quote passed. A source paymaster preparation also stopped on a rate/approval mismatch before any signature; a fresh preparation passed. The confirmed source deposit briefly remained PENDING_DEPOSIT; Aurora's optional deposit notification returned `Empty AMQP response`, but the route subsequently succeeded and authenticated credit was verified. No duplicate funding transfer was sent.

## Ethereum — complete, zero residual achieved

**Completed Ethereum mainnet cycle:** the revised Fusion order filled, wallet 2 deposited **1.084570 USDC**, redeemed all old/new shares for **1.218730 USDC**, and returned **1.268730 USDC + 0.000678997020223204 ETH** through separate Aurora intents. Both intents report SUCCESS; authenticated private credit is **3.081997 Monad-asset USDC**. Final wallet-2 balances are **zero ETH, USDC, WETH and shares**, meeting both residual targets. Wallet 1's ETH and USDC match its pre-test balances. No second Fusion purchase, helper, wallet-to-wallet transfer or joint destination transaction was used. [Mainnet evidence](fixtures/ethereum-mainnet-cycle.json).

| Step | Amount / actual gas | Transaction |
| --- | --- | --- |
| Fusion | 5.121694 USDC → 0.001133295335295891 native ETH | [Receipt](https://eth.blockscout.com/tx/0x84ebe0def4280bc6bad436c8f777696c6d51b230cb0abfbed416d22955815202) |
| approve_deposit | 0.00003079308789181 ETH at 0.554251195 gwei | [Receipt](https://eth.blockscout.com/tx/0xd3f15d713e3d131aab284f966fc24cb7da3bfd6c650cda0c31b8d98ba5f0ce41) |
| deposit | 0.000176694376170259 ETH at 0.568337347 gwei | [Receipt](https://eth.blockscout.com/tx/0xf8eefbb2fe0531e7f3163e759b26ad0ddf9e6f105cd0cef3c75acb5e9d7309d5) |
| approve_withdraw | 0.000025755692155296 ETH at 0.560101169 gwei | [Receipt](https://eth.blockscout.com/tx/0x30fdde9da342ce61ddf1edfdb8cb33a510f98f5f4ade5ca70ef47b2917f10600) |
| withdraw | 0.00017201310622037 ETH at 0.58431739 gwei | [Receipt](https://eth.blockscout.com/tx/0xf05040a31622f38a37250e96060524f43ce1b429a1c8f0f369c6a126f47c5998) |
| return_usdc | 0.000033866934480952 ETH at 0.589523299 gwei | [Receipt](https://eth.blockscout.com/tx/0xcb9a5c5a8b4b8bc56d9d06032c9adefef649a1ce856d6e7f3a40cb9a40673e88) |
| return_eth | 0.000015175118154 ETH at 0.722624674 gwei | [Receipt](https://eth.blockscout.com/tx/0x0267b347ddc9682b624571e448686130bb02647574b743d3da1f5f8978ab0903) |

Total owner-paid native gas across the six approval/deposit/withdrawal/return transactions: **0.000454298315072687 ETH**. This excludes resolver gas, which is embedded in the Fusion exchange terms. Purchased ETH reconciles exactly: 0.001133295335295891 − 0.000454298315072687 = **0.000678997020223204 ETH returned**. The 0.05 USDC retained during investment was included in the USDC return, not left as final dust. The returned credit is inside Aurora's confidential account in the Monad-USDC asset; it is not a public transfer to the Monad source wallet.

The custom Fusion order `0x3f4b7b95536125f34cef8d8606bb12ea396bef82d4e3fb1ed6903395b511d81f` filled on mainnet at block 26085618. The entire resolver transaction used 373,418 gas at 0.640090638 gwei; do not treat that as a separately charged wallet fee. The provider estimate used in the order budget was 587,612 gas before the configured headroom. This run proves resolver admission for these terms, not that this conservative allowance is the minimum necessary.

One preparation expired before submission. After the fill, increased fees temporarily made the fresh deposit/withdrawal reserve unaffordable; the runner sent no vault transaction. Fees subsequently fell, a transient public-RPC missing-header error was retried, and the original ETH purchase covered all six native transactions. No reserve, freshness or residual check was weakened. All six native receipts succeeded, without replacements or a second ETH purchase. The original 10/90 funding and payouts were not repeated.

Evidence captures independent receipts, exact fees, both wallets' balances, successful Aurora statuses and authenticated confidential credit. Wallet 1 was compared with block 26085617: 1.125870 USDC and 0.000030933 ETH before and after. Its intentional payout is excluded from wallet 2's residual criterion. This is one completed mainnet cycle; future gas, resolver economics and route eligibility remain variable. The previously verified suite contains 118 passing tests; this mainnet run changed documentation/evidence only.

### Earlier attempts and implementation history — superseded by the completed run above


**Pre-run resolver-economics implementation:** At this earlier checkpoint no third public order had been submitted. The runner now incorporates a custom full-fill auction priced for provider-estimated gas, gas/fee headroom and a proportional profit allowance. The old second order covered only about **0.080245 gwei** using its 202,859-gas direct-fill replay and recorded token prices, before resolver profit/routing costs. The revised local test used block 26085513 wallet state and recorded 0.675754118/1.351508236 gwei native caps: **4.648302 USDC** purchased ETH, **1.557962 USDC** deposited, and 0.05 USDC stayed liquid. It filled locally at 1/90/180 seconds at **0.844692648 gwei**, with positive modeled margins, then withdrew all old/new shares without injecting ETH into the owner. Provider gas estimate was 587,548 versus 202,485–202,600 measured for the inventory-funded direct fill. Public acceptance, actual resolver routing cost and current affordability are still unproved. This is a recorded fee scenario, not a live mainnet quote. See [pricing equation](NATIVE-CLI.md#resolver-pricing-after-the-two-expired-orders) and [evidence](fixtures/fusion-economics-lab.json).

**Latest attempt, 25th-percentile policy:** the user approved the full median of eight recent blocks' 25th-percentile tips. All 108 regression tests passed. The next production plan used **0.1 gwei priority / 0.675754118 gwei deposit cap / 1.351508236 gwei withdrawal reserve cap**. It quoted 2.886457 USDC to buy gas, leaving 3.319807 USDC investable and 0.05 USDC liquid. Submitted Fusion order `0x527bc047e3f0238c9d0f6d4fead5c8a650284bead8f76e8fb31dc7f4090d20b0` guaranteed 0.001050470836515788 ETH but expired at 20:03:32 UTC with no fills.

The exact saved order, extension and signature were replayed on a fork at preparation block 26085368 with liquidity supplied only to the resolver locally. The fill succeeded, used **202,859 gas**, debited exactly 2.886457 USDC, credited exactly the quoted minimum native ETH, left zero WETH, and preserved old shares. This proves executable order terms and settlement, not public resolver profitability/admission. [Signed-order replay](fixtures/native-fusion-signed-replay.json), reproduced by `node --env-file=.env scripts/replay-native-fusion.mjs` while historical RPC state and a matching resolver address remain available.

Latest independent read at **20:05:01 UTC / block 26085396**: **6.256264 USDC, zero ETH, original 0.133013839453606864 shares**, no active order, both Fusion attempts expired, zero native transactions. No Fusion input or Ethereum gas was spent. Public resolver settlement remains the blocker, separate from our later native transaction's 25th-percentile fee policy. [Current balances and order history](fixtures/ethereum-mainnet-progress.json).

At 19:25–19:35 UTC, lower fees allowed the authorized test to resume. A current fork using actual existing shares and pinned mainnet fee history passed before source funding. It projected 1.511376 USDC investable from the 6.193701 minimum payout at a 1.028323424 gwei deposit cap. Return-eligibility probes accepted both USDC and ETH inputs.

The source transferred 7.640235 Monad USDC in `0xa13359701c6619c3f157eeec822638df5d3fa17ae104def0686959c416d43453`, paying 0.001646 USDC gas. Aurora authenticated 7.637178 confidential USDC. Separate 10/90 payouts delivered 0.161805 Ethereum USDC to wallet 1 and 6.256264 to wallet 2. Source USDC remaining: 0.021741. [Funding/payout evidence](fixtures/ethereum-mainnet-progress.json).

A higher fee sample initially blocked the funded-wallet deposit before signing. A later fresh plan used a 0.332593217 gwei tip and 1.185350716 gwei deposit cap. Fusion order `0x2859ab5785c9ca3923b6f3304ea8378827da0838f079a17d4ac9035a6328fd26` offered 5.642965 USDC for at least 0.002027222285278474 native ETH. The order expired at 19:39:25 UTC without any fills; its expiry and unchanged balances were checked against mainnet. Two later preparations failed the reference-block freshness check before any new submission. No native vault transaction has been submitted, no active order remains, and no Ethereum gas or Fusion input was spent. The accepted estimated quote did not prove resolver execution; the provider returned no reason for the non-fill.

Final independent read at 19:43:49 UTC, block 26085292: wallet 2 holds **6.256264 USDC, zero ETH, and the original 0.133013839453606864 shares**. The new Ethereum cycle is incomplete. Source and payout route fees have been spent as recorded above; do not repeat source funding or payouts. Resume from the existing native journal only after a fresh valid gas/Fusion plan. The stale-plan retries are a separate preparation-latency issue; no freshness check was relaxed to force a submission.

The native price reader now uses the tested cache-bypass helper already used by Robinhood. A direct cached response was over 75 minutes old; the five-minute freshness policy remains enforced. The existing-share preview harness now pins real mainnet fee history so synthetic donor/empty blocks cannot lower its fee forecast. Full regression suite: **107 passed**.

The disputed 1 gwei median at block 26085239 was independently reproduced from all 2,047 receipts in blocks 26085232–26085239. Each transaction's actual `effectiveGasPrice - baseFeePerGas`, weighted by its actual gas used, reproduced the RPC's 40th-percentile values exactly. Their median is 1 gwei; the median 10th-percentile tip is 0.05 gwei. The former was a bidding policy, not a minimum necessary for inclusion. After comparing the alternatives, the user approved the full median of 25th-percentile tips, which is now implemented. [Receipt-based audit](fixtures/ethereum-fee-history-audit.json).

### Earlier affordability checks

User approved carrying the existing 0.133013839453606864 vault shares through the new investment, then withdrawing everything together. The runner records the starting share balance, checks it again before funding and deposit, simulates full redemption, and verifies the old balance plus newly minted shares against deposit events.

The production native CLI passed a local fork test with the real old position and synthetic 6 USDC funding: full redemption returned 6.134158 USDC, zero shares. Wallet 1 was unchanged. Evidence: `fixtures/native-existing-shares.json`. Regression suite after all mainnet-discovered fixes: **103 tests passed**.

Before the resumption above, the source route was quoted but not funded. Projected wallet-2 output: 6.256291 USDC; minimum 6.193728 USDC. At that gas quote, deposit plus the prescribed withdrawal stress reserve required 0.003502749828113457 ETH. Selling 6.143727 USDC (almost the entire minimum payout, retaining 0.05) through Fusion guaranteed only 0.001875671484736201 ETH. The affordability preflight stopped. It did not reduce fee bids or withdrawal reserves to force execution.

Local journals and detailed provider outputs are in `.local/ethereum/`, `.local/robinhood/`, and `.local/mainnet-preflight/`. Never delete an unresolved operation or create a replacement funding transfer merely because a provider status is delayed.

## Issues found and corrected during the live test

- Aurora token-registry caching returned prices over ten minutes old. Valuation now bypasses the cached response but retains the five-minute freshness requirement; stale origin prices still fail closed.
- Fresh return quotes intermittently returned `No liquidity available`, including alternate USDC assets. An earlier accepted quote for 2.65 USDG remained valid. The runner now supports an explicitly supplied, still-unfunded accepted quote through `ROBINHOOD_RETURN_QUOTE_FILE`. It revalidates the original assets, confidential recipient, refund owner, input amount and deadline, then obtains current paymaster estimates and enforces the same residual bounds. This run used the original Monad-USDC confidential asset, not an alternate asset.
- A quote's deposit address can remain active beyond its requested swap deadline. Quote validation, funding, payout signing, and return planning now use the earlier of those deadlines. Expired saved quotes are rejected.

All three fixes have regression tests. No extra public funding transfer was sent to work around Aurora's delays or liquidity errors. Do not reuse this run's funded return quote or delete its completed journal.
