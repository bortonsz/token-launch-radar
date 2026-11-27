[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/bortonsz/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/bortonsz/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar (radar-2)

A token launch radar for the MAKE.FUN `token-radar-01` bounty. It reads a sealed
DefiLlama snapshot of 758 protocols and ranks every protocol that records no token
yet — and is not a wrapped, staked, bridged or versioned product of one that already
trades — by the value a launch would imply at today's record, each with a concrete
farm plan. On this snapshot the board holds 198 protocols: the full 40-protocol
watchlist plus 158 early finds below the watchlist floor.

## The model

`implied = TVL x peerMultiple x growth x maturity x breadth`

- **Peer multiple** — the median market-cap / TVL of live-token protocols in the same
  category (shrunk toward the global live median, 0.214x here, by sample size), so a
  launch is priced the way the market already prices its traded neighbours.
- **Growth** — the 7-day TVL change, clamped to [-50%, +100%] at weight 0.6; an
  unreported change scores 0.97, never free momentum.
- **Maturity** — a longer track record with no token is worth more (0.65 to 1.15 over
  four years; unknown listing date scores as one year).
- **Breadth** — +3% per additional chain, up to seven.

A 0-100 **confidence** score grades the record behind each number (completeness,
scale, peer-set size, breadth). It is shown on the board and never moves the price.
Live-token protocols are never ranked: they form the peer set and are shown
separately with the market's own values. No protocol name is special-cased anywhere.

Implied values are this radar's own claims, not a prediction that any token will be
issued, and "records no token" is a statement about the snapshot's record, not proof
that a protocol has none.

## Run it

Node 22.18+, standard library only, no network:

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to
the output directory. Two runs write identical bytes.

## Layout

- `main.ts` — entrypoint: snapshot in, board + dashboard + dossier out
- `lib/model.ts` — board membership, peer pricing, implied value, confidence, farm plans
- `dashboard/` — the static page (board, filters, sort, detail view, farm plan)
- `screenshots/` — the board, a detail view (USDD) and a filtered view (Dexs)
- `vendor/makefun-board.ts` — the kit's dossier library, vendored unchanged
