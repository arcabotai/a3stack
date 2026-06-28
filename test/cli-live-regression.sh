#!/usr/bin/env bash
set -euo pipefail

# Live regression checks for the public A3Stack CLI paths that power arcabot.ai copy.
# Read-only: no wallet, no transactions.

CLI=(npx tsx packages/cli/src/cli.ts)
ARCA_WALLET="0x1be93C700dDC596D701E8F2106B8F9166C625Adb"
ARCA_ETH="eip155:1:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432#22775"

out="$(${CLI[@]} verify "$ARCA_ETH")"
grep -q "Verified on-chain" <<<"$out"
grep -q "Owner: $ARCA_WALLET" <<<"$out"
grep -q "https://arcabot.ai/agent-metadata.json" <<<"$out"

# Keep the multi-chain test bounded so it is stable on public RPCs.
LOOKUP_ENV=(
  A3STACK_CHAIN_IDS=1,10,8453,534352
  A3STACK_LOOKUP_CHUNK_SIZE=1000
  A3STACK_FROM_BLOCK_1=24365990
  A3STACK_TO_BLOCK_1=24366010
  A3STACK_FROM_BLOCK_10=147533360
  A3STACK_TO_BLOCK_10=147533380
  A3STACK_FROM_BLOCK_8453=41854840
  A3STACK_TO_BLOCK_8453=41854860
  A3STACK_FROM_BLOCK_534352=29718200
  A3STACK_TO_BLOCK_534352=29718220
)

out="$(env "${LOOKUP_ENV[@]}" ${CLI[@]} lookup "$ARCA_WALLET")"
for expected in "Ethereum" "Optimism" "Base" "Scroll"; do
  grep -q "$expected" <<<"$out"
done
grep -q "#22775" <<<"$out"
grep -q "#2376" <<<"$out"

out="$(env "${LOOKUP_ENV[@]}" ${CLI[@]} verify arcabot.eth)"
grep -q "arcabot" <<<"$out"
grep -q "EVM registration" <<<"$out"
grep -q "Ethereum" <<<"$out"
grep -q "Optimism" <<<"$out"
grep -q "Base" <<<"$out"
grep -q "Scroll" <<<"$out"

echo "cli live regression checks passed"
