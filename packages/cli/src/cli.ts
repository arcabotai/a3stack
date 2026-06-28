#!/usr/bin/env node
/**
 * a3stack CLI — identity, payments, and data for AI agents
 *
 * Usage:
 *   npx a3stack verify <globalId|ENS|wallet>  Verify an agent identity or all registrations for an owner
 *   npx a3stack lookup <wallet|ENS>           Find all chain registrations for an owner
 *   npx a3stack probe <globalId>              Discover an agent's capabilities
 *   npx a3stack chains                        List supported ERC-8004 chains
 *   npx a3stack count [chainId]               Count registered agents on a chain
 *   npx a3stack init                          Scaffold a new A3Stack agent project
 */

import { createPublicClient, http, getAddress, type Hex, type PublicClient } from "viem";
import * as chains from "viem/chains";

// ─── Constants (inlined to keep the npx CLI self-contained) ────────────────

const VERSION = "0.1.1";
const REGISTRY_ADDRESS = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const REGISTRY_ABI = [
  { inputs: [{ name: "agentId", type: "uint256" }], name: "ownerOf", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "agentId", type: "uint256" }], name: "tokenURI", outputs: [{ type: "string" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "owner", type: "address" }], name: "balanceOf", outputs: [{ type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "agentId", type: "uint256" }], name: "getAgentWallet", outputs: [{ type: "address" }], stateMutability: "view", type: "function" },
] as const;

const TRANSFER_EVENT = {
  type: "event" as const,
  name: "Transfer" as const,
  inputs: [
    { type: "address" as const, indexed: true, name: "from" as const },
    { type: "address" as const, indexed: true, name: "to" as const },
    { type: "uint256" as const, indexed: true, name: "tokenId" as const },
  ],
};

type ChainConfig = {
  name: string;
  rpcs: string[];
  viemChain?: any;
  scanSlug?: string;
  /** First known block where the registry has bytecode. Keeps public-RPC log scans sane. */
  fromBlock?: bigint;
};

const SUPPORTED_CHAINS: Record<number, ChainConfig> = {
  1: { name: "Ethereum", viemChain: chains.mainnet, scanSlug: "ethereum", fromBlock: 24_339_871n, rpcs: ["https://eth.drpc.org", "https://ethereum.publicnode.com", "https://eth.llamarpc.com"] },
  10: { name: "Optimism", viemChain: chains.optimism, scanSlug: "optimism", fromBlock: 147_514_947n, rpcs: ["https://mainnet.optimism.io", "https://optimism.publicnode.com"] },
  56: { name: "BNB Chain", viemChain: chains.bsc, scanSlug: "bsc", rpcs: ["https://bsc.publicnode.com", "https://bsc-dataseed.binance.org"] },
  100: { name: "Gnosis", viemChain: chains.gnosis, scanSlug: "gnosis", fromBlock: 44_505_010n, rpcs: ["https://rpc.gnosischain.com", "https://gnosis.publicnode.com"] },
  137: { name: "Polygon", viemChain: chains.polygon, scanSlug: "polygon", rpcs: ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"] },
  143: { name: "Monad", scanSlug: "monad", rpcs: ["https://rpc.monad.xyz"] },
  196: { name: "X Layer", scanSlug: "xlayer", fromBlock: 51_947_237n, rpcs: ["https://rpc.xlayer.tech"] },
  360: { name: "Shape", scanSlug: "shape", fromBlock: 25_649_378n, rpcs: ["https://mainnet.shape.network"] },
  1088: { name: "Metis", viemChain: chains.metis, scanSlug: "metis", fromBlock: 22_161_525n, rpcs: ["https://andromeda.metis.io/?owner=1088", "https://metis.publicnode.com"] },
  1776: { name: "Injective EVM", scanSlug: "injective", rpcs: ["https://blockscout.injective.network/api/eth-rpc"] },
  2345: { name: "GOAT Network", scanSlug: "goat", rpcs: ["https://rpc.goat.network"] },
  2741: { name: "Abstract", viemChain: chains.abstract, scanSlug: "abstract", fromBlock: 39_596_871n, rpcs: ["https://api.mainnet.abs.xyz"] },
  4326: { name: "MegaETH", scanSlug: "megaeth", rpcs: ["https://carrot.megaeth.com/rpc"] },
  5000: { name: "Mantle", viemChain: chains.mantle, scanSlug: "mantle", rpcs: ["https://rpc.mantle.xyz", "https://mantle.publicnode.com"] },
  8453: { name: "Base", viemChain: chains.base, scanSlug: "base", fromBlock: 41_663_783n, rpcs: ["https://mainnet.base.org", "https://base.publicnode.com"] },
  42161: { name: "Arbitrum", viemChain: chains.arbitrum, scanSlug: "arbitrum", rpcs: ["https://arb1.arbitrum.io/rpc", "https://arbitrum-one.publicnode.com"] },
  42220: { name: "Celo", viemChain: chains.celo, scanSlug: "celo", fromBlock: 58_396_724n, rpcs: ["https://forno.celo.org", "https://celo.drpc.org"] },
  43114: { name: "Avalanche", viemChain: chains.avalanche, scanSlug: "avalanche", rpcs: ["https://api.avax.network/ext/bc/C/rpc", "https://avalanche-c-chain-rpc.publicnode.com"] },
  59144: { name: "Linea", viemChain: chains.linea, scanSlug: "linea", fromBlock: 28_662_553n, rpcs: ["https://rpc.linea.build", "https://linea-rpc.publicnode.com"] },
  167000: { name: "Taiko", viemChain: chains.taiko, scanSlug: "taiko", fromBlock: 4_305_747n, rpcs: ["https://taiko-rpc.publicnode.com", "https://rpc.mainnet.taiko.xyz"] },
  534352: { name: "Scroll", viemChain: chains.scroll, scanSlug: "scroll", fromBlock: 29_432_417n, rpcs: ["https://rpc.scroll.io", "https://scroll.publicnode.com"] },
  1187947933: { name: "SKALE Base", scanSlug: "skale-base", rpcs: ["https://mainnet.skalenodes.com/v1/elated-tan-skat"] },
};

type AgentRef = { chainId: number; registry: Hex; agentId: bigint };
type Registration = { chain: string; chainId: number; agentId: bigint; globalId: string; uri: string; owner: string };
type ChainError = { chain: string; chainId: number; message: string };
const KNOWN_METADATA_BY_OWNER: Record<string, string[]> = {
  // Public demo agent used throughout the docs/site. The metadata file itself is
  // verified against ownerOf/tokenURI before a row is returned; it is a hint, not trust.
  "0x1be93c700ddc596d701e8f2106b8f9166c625adb": ["https://arcabot.ai/agent-metadata.json"],
};

// ─── Tiny formatting helpers ────────────────────────────────────────────────

function bold(s: string) { return `\x1b[1m${s}\x1b[0m`; }
function green(s: string) { return `\x1b[32m${s}\x1b[0m`; }
function red(s: string) { return `\x1b[31m${s}\x1b[0m`; }
function dim(s: string) { return `\x1b[2m${s}\x1b[0m`; }
function cyan(s: string) { return `\x1b[36m${s}\x1b[0m`; }
function yellow(s: string) { return `\x1b[33m${s}\x1b[0m`; }

// ─── Core helpers ───────────────────────────────────────────────────────────

function parseGlobalId(id: string): AgentRef {
  const normalized = id.replace("/", "#");
  const match = normalized.match(/^eip155:(\d+):(0x[a-fA-F0-9]{40})#(\d+)$/);
  if (!match) {
    throw new Error(`Invalid global ID format: ${id}\nExpected: eip155:<chainId>:<registry>#<agentId>`);
  }
  return { chainId: Number(match[1]), registry: getAddress(match[2]) as Hex, agentId: BigInt(match[3]) };
}

function looksLikeGlobalId(value: string): boolean {
  return /^eip155:\d+:0x[a-fA-F0-9]{40}[#/](\d+)$/.test(value);
}

function selectedChainIds(): number[] {
  const raw = process.env.A3STACK_CHAIN_IDS;
  if (!raw) return Object.keys(SUPPORTED_CHAINS).map(Number);
  return raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && SUPPORTED_CHAINS[id]);
}

function rpcUrls(chainId: number): string[] {
  const chain = SUPPORTED_CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported chain: ${chainId}. Run 'a3stack chains' to see supported chains.`);

  const specific = process.env[`A3STACK_RPC_${chainId}`];
  const generic = process.env.A3STACK_RPC_URL;
  return [...new Set([specific, generic, ...chain.rpcs].filter(Boolean) as string[])];
}

function makeClient(chainId: number, rpc: string): PublicClient {
  const cfg = SUPPORTED_CHAINS[chainId];
  return createPublicClient({
    chain: cfg?.viemChain,
    transport: http(rpc, { timeout: Number(process.env.A3STACK_RPC_TIMEOUT_MS ?? 15000), retryCount: 1 }),
  }) as PublicClient;
}

async function withRpcFallback<T>(chainId: number, fn: (client: PublicClient, rpc: string) => Promise<T>): Promise<T> {
  const errors: string[] = [];
  for (const rpc of rpcUrls(chainId)) {
    try {
      return await fn(makeClient(chainId, rpc), rpc);
    } catch (e) {
      errors.push(`${rpc}: ${shortError(e)}`);
    }
  }
  throw new Error(errors.join(" | "));
}

function shortError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\s+/g, " ").slice(0, 240);
}

function isMissingTokenError(e: unknown): boolean {
  const msg = shortError(e).toLowerCase();
  return msg.includes("revert") || msg.includes("erc721") || msg.includes("nonexistent") || msg.includes("invalid token id") || msg.includes("owner query");
}

function defaultChunkSize(): bigint {
  const raw = process.env.A3STACK_LOOKUP_CHUNK_SIZE;
  if (raw && /^\d+$/.test(raw)) return BigInt(raw);
  return 50_000n;
}

function chainFromBlock(chainId: number): bigint {
  const envKey = process.env[`A3STACK_FROM_BLOCK_${chainId}`] ?? process.env.A3STACK_FROM_BLOCK;
  if (envKey && /^\d+$/.test(envKey)) return BigInt(envKey);
  return SUPPORTED_CHAINS[chainId]?.fromBlock ?? 0n;
}

function chainToBlock(chainId: number, latest: bigint): bigint {
  const envKey = process.env[`A3STACK_TO_BLOCK_${chainId}`] ?? process.env.A3STACK_TO_BLOCK;
  if (envKey && /^\d+$/.test(envKey)) return BigInt(envKey);
  return latest;
}

async function getLogsChunked(
  client: PublicClient,
  args: { from?: `0x${string}`; to?: `0x${string}` },
  fromBlock: bigint,
  toBlock: bigint,
  chunkSize = defaultChunkSize(),
): Promise<any[]> {
  const logs: any[] = [];
  let start = fromBlock;
  let size = chunkSize;

  while (start <= toBlock) {
    const end = start + size - 1n > toBlock ? toBlock : start + size - 1n;
    try {
      const chunk = await client.getLogs({
        address: REGISTRY_ADDRESS,
        event: TRANSFER_EVENT,
        args,
        fromBlock: start,
        toBlock: end,
      } as any);
      logs.push(...chunk);
      start = end + 1n;
    } catch (e) {
      if (size > 1_000n) {
        size = size / 2n;
        continue;
      }
      throw e;
    }
  }

  return logs;
}

async function fetchMetadata(uri: string): Promise<any | null> {
  try {
    if (uri.startsWith("data:application/json")) {
      const payload = uri.includes("base64,")
        ? Buffer.from(uri.split("base64,")[1], "base64").toString()
        : decodeURIComponent(uri.split(",")[1] ?? "{}");
      return JSON.parse(payload);
    }

    if (uri.startsWith("ipfs://") || uri.startsWith("http")) {
      const fetchUrl = uri.startsWith("ipfs://")
        ? `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`
        : uri;
      const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
      if (!res.ok) return null;
      return await res.json();
    }
  } catch {
    return null;
  }
  return null;
}

async function resolveOwner(input: string): Promise<{ address: `0x${string}`; label: string; resolved: boolean }> {
  if (!input) throw new Error("Missing owner. Use a wallet address or ENS name.");

  if (input.startsWith("0x")) {
    return { address: getAddress(input) as `0x${string}`, label: getAddress(input), resolved: false };
  }

  if (!input.includes(".")) {
    throw new Error(`"${input}" is not a wallet address, ENS name, or ERC-8004 global ID.`);
  }

  const address = await withRpcFallback(1, async (client) => {
    const resolved = await (client as any).getEnsAddress({ name: input });
    if (!resolved) throw new Error(`ENS name ${input} did not resolve to an address`);
    return getAddress(resolved) as `0x${string}`;
  });

  return { address, label: input, resolved: true };
}

async function readOwnerAndUri(ref: AgentRef): Promise<{ owner: string; uri: string; paymentWallet: string | null }> {
  return withRpcFallback(ref.chainId, async (client) => {
    const owner = await client.readContract({
      address: ref.registry,
      abi: REGISTRY_ABI,
      functionName: "ownerOf",
      args: [ref.agentId],
    }) as string;

    const uri = await client.readContract({
      address: ref.registry,
      abi: REGISTRY_ABI,
      functionName: "tokenURI",
      args: [ref.agentId],
    }) as string;

    let paymentWallet: string | null = null;
    try {
      const raw = await client.readContract({
        address: ref.registry,
        abi: REGISTRY_ABI,
        functionName: "getAgentWallet",
        args: [ref.agentId],
      }) as string;
      paymentWallet = raw.toLowerCase() === ZERO_ADDRESS ? null : raw;
    } catch {
      paymentWallet = null;
    }

    return { owner, uri, paymentWallet };
  });
}

async function findRegistrationsFromMetadataHints(owner: `0x${string}`): Promise<{ results: Registration[]; errors: ChainError[] }> {
  if (process.env.A3STACK_DISABLE_METADATA_HINTS === "1") return { results: [], errors: [] };

  const urls = KNOWN_METADATA_BY_OWNER[owner.toLowerCase()] ?? [];
  if (!urls.length) return { results: [], errors: [] };

  const allowed = new Set(selectedChainIds());
  const results: Registration[] = [];
  const errors: ChainError[] = [];

  for (const url of urls) {
    const metadata = await fetchMetadata(url);
    if (!metadata?.registrations?.length) continue;

    for (const reg of metadata.registrations) {
      const match = String(reg.agentRegistry ?? "").match(/^eip155:(\d+):(0x[a-fA-F0-9]{40})$/);
      if (!match) continue;

      const chainId = Number(match[1]);
      const chain = SUPPORTED_CHAINS[chainId];
      if (!allowed.has(chainId) || !chain) continue;

      const ref: AgentRef = {
        chainId,
        registry: getAddress(match[2]) as Hex,
        agentId: BigInt(reg.agentId),
      };

      try {
        const onchain = await readOwnerAndUri(ref);
        if (onchain.owner.toLowerCase() !== owner.toLowerCase()) {
          errors.push({ chain: chain.name, chainId, message: `metadata hint owner mismatch for #${ref.agentId}` });
          continue;
        }
        results.push({
          chain: chain.name,
          chainId,
          agentId: ref.agentId,
          owner: onchain.owner,
          uri: onchain.uri,
          globalId: `eip155:${chainId}:${ref.registry}#${ref.agentId}`,
        });
      } catch (e) {
        errors.push({ chain: chain.name, chainId, message: shortError(e) });
      }
    }
  }

  return { results, errors };
}

async function findRegistrations(owner: `0x${string}`): Promise<{ results: Registration[]; errors: ChainError[] }> {
  const hinted = await findRegistrationsFromMetadataHints(owner);
  if (hinted.results.length > 0) {
    hinted.results.sort((a, b) => a.chainId - b.chainId || Number(a.agentId - b.agentId));
    hinted.errors.sort((a, b) => a.chainId - b.chainId);
    return hinted;
  }

  const results: Registration[] = [];
  const errors: ChainError[] = [];

  await Promise.allSettled(selectedChainIds().map(async (chainId) => {
    const chain = SUPPORTED_CHAINS[chainId];
    if (!chain) return;

    try {
      await withRpcFallback(chainId, async (client) => {
        const balance = await client.readContract({
          address: REGISTRY_ADDRESS,
          abi: REGISTRY_ABI,
          functionName: "balanceOf",
          args: [owner],
        }) as bigint;

        if (balance === 0n) return;

        const latest = await client.getBlockNumber();
        const fromBlock = chainFromBlock(chainId);
        const toBlock = chainToBlock(chainId, latest);
        const logs = await getLogsChunked(client, {
          from: ZERO_ADDRESS,
          to: owner,
        }, fromBlock, toBlock);

        for (const log of logs) {
          const agentId = (log as any).args.tokenId as bigint;

          const currentOwner = await client.readContract({
            address: REGISTRY_ADDRESS,
            abi: REGISTRY_ABI,
            functionName: "ownerOf",
            args: [agentId],
          }) as string;

          if (currentOwner.toLowerCase() !== owner.toLowerCase()) continue;

          const uri = await client.readContract({
            address: REGISTRY_ADDRESS,
            abi: REGISTRY_ABI,
            functionName: "tokenURI",
            args: [agentId],
          }) as string;

          results.push({
            chain: chain.name,
            chainId,
            agentId,
            owner: currentOwner,
            uri,
            globalId: `eip155:${chainId}:${REGISTRY_ADDRESS}#${agentId}`,
          });
        }
      });
    } catch (e) {
      errors.push({ chain: chain.name, chainId, message: shortError(e) });
    }
  }));

  const seen = new Set<string>();
  const unique = results.filter((r) => {
    if (seen.has(r.globalId)) return false;
    seen.add(r.globalId);
    return true;
  });

  unique.sort((a, b) => a.chainId - b.chainId || Number(a.agentId - b.agentId));
  errors.sort((a, b) => a.chainId - b.chainId);
  return { results: unique, errors };
}

function printRegistrationRows(results: Registration[]) {
  for (const r of results) {
    console.log(`   ${green("✓")} ${r.chain.padEnd(15)} ${yellow("#" + r.agentId.toString().padEnd(6))} ${dim(r.globalId)}`);
  }
}

function printErrors(errors: ChainError[]) {
  if (!errors.length) return;
  console.log(`\n   ${yellow("⚠")} ${errors.length} chain(s) skipped or degraded:`);
  for (const e of errors.slice(0, 8)) {
    console.log(`   ${dim("•")} ${e.chain} (${e.chainId}): ${dim(e.message)}`);
  }
  if (errors.length > 8) console.log(`   ${dim(`… ${errors.length - 8} more`)}`);
}

function backrefValid(metadata: any, ref: AgentRef): boolean | null {
  if (!metadata?.registrations) return null;
  const registryPrefix = `eip155:${ref.chainId}:${ref.registry.toLowerCase()}`;
  return metadata.registrations.some((r: any) =>
    Number(r.agentId) === Number(ref.agentId) &&
    String(r.agentRegistry).toLowerCase() === registryPrefix
  );
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function verify(input?: string) {
  if (!input) throw new Error("Usage: a3stack verify <globalId|ENS|wallet>");
  console.log(`\n${bold("🔍 Verifying agent identity")}\n`);

  if (!looksLikeGlobalId(input)) {
    return verifyOwner(input);
  }

  const ref = parseGlobalId(input);
  const chainName = SUPPORTED_CHAINS[ref.chainId]?.name ?? `Chain ${ref.chainId}`;

  console.log(`   Chain:    ${cyan(chainName)} (${ref.chainId})`);
  console.log(`   Registry: ${dim(ref.registry)}`);
  console.log(`   Agent ID: ${bold("#" + ref.agentId.toString())}\n`);

  let onchain: { owner: string; uri: string; paymentWallet: string | null };
  try {
    onchain = await readOwnerAndUri(ref);
  } catch (e) {
    if (isMissingTokenError(e)) {
      console.log(`   ${red("✗")} Agent #${ref.agentId.toString()} not found on ${chainName}\n`);
    } else {
      console.log(`   ${red("✗")} RPC/read failed on ${chainName}: ${shortError(e)}\n`);
    }
    process.exit(1);
  }

  console.log(`   ${green("✓")} ${bold("Verified on-chain")}`);
  console.log(`   Owner: ${onchain.owner}`);
  console.log(`   URI:   ${dim(onchain.uri)}`);
  if (onchain.paymentWallet) console.log(`   Pay:   ${dim(onchain.paymentWallet)}`);

  const metadata = await fetchMetadata(onchain.uri);
  if (metadata) {
    if (metadata.name) console.log(`   Name:  ${bold(metadata.name)}`);
    if (metadata.description) console.log(`   Desc:  ${metadata.description}`);

    const backref = backrefValid(metadata, ref);
    if (backref === true) console.log(`   ${green("✓")} Metadata back-reference present`);
    if (backref === false) console.log(`   ${yellow("⚠")} Metadata missing back-reference for this chain`);

    if (metadata.services?.length) {
      console.log(`\n   ${bold("Services:")}`);
      for (const s of metadata.services) {
        console.log(`   ${cyan("→")} ${s.name}: ${s.endpoint}`);
      }
    }
  }

  console.log();
}

async function verifyOwner(input: string) {
  const resolved = await resolveOwner(input);
  if (resolved.resolved) {
    console.log(`   ${green("✓")} Resolved ${bold(resolved.label)} → ${resolved.address}\n`);
  } else {
    console.log(`   Owner: ${resolved.address}\n`);
  }

  const { results, errors } = await findRegistrations(resolved.address);
  if (results.length === 0) {
    console.log(`   ${red("✗")} No ERC-8004 registrations found for ${resolved.address}`);
    printErrors(errors);
    console.log();
    process.exit(1);
  }

  console.log(`   ${green("✓")} Found ${green(String(results.length))} EVM registration(s):\n`);
  printRegistrationRows(results);

  const firstMetadata = await fetchMetadata(results[0].uri);
  if (firstMetadata?.name) {
    console.log(`\n   Name: ${bold(firstMetadata.name)}`);
    if (firstMetadata.description) console.log(`   Desc: ${firstMetadata.description}`);
  }

  printErrors(errors);
  console.log();
}

async function lookup(input?: string) {
  if (!input) throw new Error("Usage: a3stack lookup <wallet|ENS>");

  const resolved = await resolveOwner(input);
  if (resolved.resolved) {
    console.log(`\n${bold("🌐 Scanning all chains")} for ${dim(`${resolved.label} (${resolved.address})`)}\n`);
  } else {
    console.log(`\n${bold("🌐 Scanning all chains")} for ${dim(resolved.address)}\n`);
  }

  const { results, errors } = await findRegistrations(resolved.address);

  if (results.length === 0) {
    console.log(`   No registrations found.`);
    printErrors(errors);
    console.log();
    return;
  }

  console.log(`   Found ${green(results.length.toString())} registration(s):\n`);
  printRegistrationRows(results);
  printErrors(errors);
  console.log();
}

async function probe(globalId?: string) {
  if (!globalId) throw new Error("Usage: a3stack probe <globalId>");

  console.log(`\n${bold("🔬 Probing agent")} ${dim(globalId)}\n`);

  const ref = parseGlobalId(globalId);
  const chainName = SUPPORTED_CHAINS[ref.chainId]?.name ?? `Chain ${ref.chainId}`;

  let onchain: { owner: string; uri: string; paymentWallet: string | null };
  try {
    onchain = await readOwnerAndUri(ref);
  } catch (e) {
    console.log(`   ${red("✗")} Agent read failed: ${shortError(e)}\n`);
    process.exit(1);
  }

  console.log(`   ${green("✓")} Identity verified on ${cyan(chainName)}`);
  console.log(`   Owner: ${dim(onchain.owner)}`);
  console.log(`   URI:   ${dim(onchain.uri)}`);
  if (onchain.paymentWallet) console.log(`   Pay to: ${dim(onchain.paymentWallet)}`);

  const metadata = await fetchMetadata(onchain.uri);
  if (!metadata) {
    console.log(`   ${yellow("⚠")} Metadata fetch failed\n`);
    return;
  }

  console.log(`   Name:   ${bold(metadata.name ?? "unnamed")}`);
  if (metadata.description) console.log(`   Desc:   ${metadata.description}`);
  if (metadata.active !== undefined) console.log(`   Active: ${metadata.active ? green("yes") : red("no")}`);
  if (metadata.x402Support) console.log(`   x402:   ${green("accepts payments")}`);

  if (metadata.services?.length) {
    console.log(`\n   ${bold("Endpoints:")}`);
    for (const s of metadata.services) {
      console.log(`   ${cyan("→")} ${String(s.name).padEnd(8)} ${s.endpoint}`);

      if (String(s.name).toUpperCase() === "MCP" && metadata.x402Support) {
        try {
          const r = await fetch(s.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
            signal: AbortSignal.timeout(5000),
          });
          if (r.status === 402) {
            console.log(`     ${yellow("$")} Payment required (HTTP 402)`);
          } else if (r.ok) {
            console.log(`     ${green("✓")} Endpoint reachable (free)`);
          }
        } catch {
          console.log(`     ${dim("⚠ Endpoint not reachable")}`);
        }
      }
    }
  }

  if (metadata.registrations?.length) {
    console.log(`\n   ${bold("Cross-chain IDs:")}`);
    for (const reg of metadata.registrations) {
      console.log(`   ${dim("•")} Agent #${reg.agentId} @ ${dim(reg.agentRegistry)}`);
    }
  }

  console.log();
}

async function showChains() {
  console.log(`\n${bold("🌐 Supported ERC-8004 EVM chains")}\n`);
  console.log(`   ${dim("Chain".padEnd(16))} ${dim("ID".padEnd(12))} ${dim("Registry")}\n`);

  for (const id of Object.keys(SUPPORTED_CHAINS).map(Number).sort((a, b) => a - b)) {
    const chain = SUPPORTED_CHAINS[id];
    console.log(`   ${chain.name.padEnd(16)} ${String(id).padEnd(12)} ${dim(REGISTRY_ADDRESS)}`);
  }
  console.log(`\n   ${bold(Object.keys(SUPPORTED_CHAINS).length.toString())} EVM chains — same registry address on all.`);
  console.log(`   ${dim("Use A3STACK_CHAIN_IDS=1,8453 to limit lookup/count scans.")}\n`);
}

async function count(chainIdStr?: string) {
  const chainIds = chainIdStr ? [Number(chainIdStr)] : selectedChainIds();

  console.log(`\n${bold("📊 Agent count")} ${dim("(chunked Transfer-event scan)")}\n`);

  const results = await Promise.all(chainIds.map(async (chainId) => {
    const chain = SUPPORTED_CHAINS[chainId];
    if (!chain) return { chainId, name: `Unknown (${chainId})`, count: -1, error: "unsupported" };

    try {
      return await withRpcFallback(chainId, async (client) => {
        const latest = await client.getBlockNumber();
        const fromBlock = chainFromBlock(chainId);
        const toBlock = chainToBlock(chainId, latest);
        const logs = await getLogsChunked(client, { from: ZERO_ADDRESS }, fromBlock, toBlock);
        return { chainId, name: chain.name, count: logs.length, error: "" };
      });
    } catch (e) {
      return { chainId, name: chain.name, count: -1, error: shortError(e) };
    }
  }));

  results.sort((a, b) => b.count - a.count);

  for (const r of results) {
    if (r.count >= 0) {
      console.log(`   ${r.name.padEnd(16)} ${yellow(r.count.toString().padStart(6))} agents`);
    } else {
      console.log(`   ${r.name.padEnd(16)} ${dim("  error")} ${dim(r.error)}`);
    }
  }
  console.log();
}

function scaffoldInit() {
  console.log(`\n${bold("🚀 Scaffold a new A3Stack agent")}\n`);
  console.log(`${dim("Coming in v0.2.0 — for now, install the packages directly:")}\n`);
  console.log(`   ${cyan("npm install @a3stack/core viem")}\n`);
  console.log(`   Then in your code:\n`);
  console.log(`   ${dim('import { A3Stack } from "@a3stack/core";')}`);
  console.log(`   ${dim('const agent = new A3Stack({ account, chain: base });')}`);
  console.log(`   ${dim('await agent.register({ name: "my-agent" });')}\n`);
  console.log(`   Docs: ${cyan("https://a3stack.arcabot.ai")}\n`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

const HELP = `
${bold("a3stack")} — identity, payments, and data for AI agents

${bold("Commands:")}
  ${cyan("verify")} <globalId|ENS|wallet>  Verify one global ID, or all registrations owned by ENS/wallet
  ${cyan("lookup")} <wallet|ENS>           Find all chain registrations for an owner
  ${cyan("probe")}  <globalId>             Discover an agent's capabilities & endpoints
  ${cyan("chains")}                         List supported ERC-8004 EVM chains
  ${cyan("count")}  [chainId]               Count registered agents (all chains or one)
  ${cyan("init")}                           Scaffold a new agent project

${bold("Examples:")}
  npx a3stack verify arcabot.eth
  npx a3stack verify "eip155:8453:${REGISTRY_ADDRESS}#2376"
  npx a3stack lookup arcabot.eth
  A3STACK_CHAIN_IDS=1,8453 npx a3stack lookup 0xYOUR_WALLET_ADDRESS
  npx a3stack probe "eip155:8453:${REGISTRY_ADDRESS}#2376"

${dim(`v${VERSION} • https://a3stack.arcabot.ai • github.com/arcabotai/a3stack`)}
`;

const [cmd, ...args] = process.argv.slice(2);

async function main() {
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(HELP);
    return;
  }

  if (cmd === "--version" || cmd === "-v") {
    console.log(`a3stack v${VERSION}`);
    return;
  }

  switch (cmd) {
    case "verify": return verify(args[0]);
    case "lookup": return lookup(args[0]);
    case "probe": return probe(args[0]);
    case "chains": return showChains();
    case "count": return count(args[0]);
    case "init": return scaffoldInit();
    default:
      console.error(`${red("Unknown command:")} ${cmd}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${red("Error:")} ${err.message}`);
  process.exit(1);
});
