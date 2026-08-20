import { NextRequest, NextResponse } from "next/server";
import type postgres from "postgres";
import { getSql, requireAdminKey } from "@/lib/db";
import { DEFAULT_GROUP_SLUG, ensureGroupSchema } from "@/lib/groups";
import { allocateWinningPayouts, roundMoney } from "@/lib/futures";
import { ensureBettingTables } from "@/lib/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateBody = {
  key?: string;
  groupSlug?: string;
  title?: string;
  marketType?: string;
  settlementBasis?: string;
  opensAt?: string;
  closesAt?: string;
  rolloverAmount?: number;
  rolloverTargetMarketId?: number | null;
  autoCreated?: boolean;
  closeDescription?: string | null;
  lossRule?: string | null;
  options?: string[];
};

type PatchBody = {
  key?: string;
  marketId?: number;
  action?: "update" | "settle";
  title?: string;
  status?: "open" | "closed" | "void";
  opensAt?: string | null;
  closesAt?: string;
  rolloverAmount?: number;
  rolloverTargetMarketId?: number | null;
  closeDescription?: string | null;
  lossRule?: string | null;
  settledOptionId?: number | null;
  payoutRate?: number;
};

type SqlTransaction = postgres.TransactionSql<Record<string, never>>;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as CreateBody;
  try {
    requireAdminKey(request.headers.get("x-admin-key") ?? body.key ?? null);
  } catch {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }

  const title = clean(body.title);
  const marketType = clean(body.marketType) || "generic";
  const settlementBasis = clean(body.settlementBasis) || null;
  const opensAt = body.opensAt ? parseDate(body.opensAt) : null;
  const closesAt = parseDate(body.closesAt);
  const options = [...new Set((body.options ?? []).map(clean).filter(Boolean))];
  const rolloverAmount = parseMoney(body.rolloverAmount ?? 0);
  const rolloverTargetMarketId = Number.isInteger(body.rolloverTargetMarketId)
    ? body.rolloverTargetMarketId!
    : null;
  const closeDescription = clean(body.closeDescription) || null;
  const lossRule = clean(body.lossRule) || null;

  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (!closesAt) return NextResponse.json({ error: "Valid close time is required" }, { status: 400 });
  if (body.opensAt && !opensAt) return NextResponse.json({ error: "Valid open time is required" }, { status: 400 });
  if (opensAt && opensAt.getTime() >= closesAt.getTime()) {
    return NextResponse.json({ error: "Open time must be before close time" }, { status: 400 });
  }
  if (rolloverAmount === null) {
    return NextResponse.json({ error: "Rollover amount must be non-negative" }, { status: 400 });
  }
  if (options.length < 2) return NextResponse.json({ error: "At least two options are required" }, { status: 400 });

  const sql = getSql();

  try {
    await ensureBettingTables(sql);
    await ensureGroupSchema(sql);

    const result = await sql.begin(async (tx) => {
      const [group] = (await tx`
        select id, slug, name
        from sweepstake_groups
        where slug = ${body.groupSlug || DEFAULT_GROUP_SLUG}
        limit 1
      `) as Array<{ id: number; slug: string; name: string }>;
      if (!group) throw new Response("Group not found", { status: 404 });
      if (rolloverTargetMarketId !== null) {
        const targetRows = (await tx`
          select id
          from futures_markets
          where id = ${rolloverTargetMarketId}
            and pool_id = ${group.id}
          limit 1
        `) as Array<{ id: number }>;
        if (!targetRows.length) throw new Response("Rollover target not found in this group", { status: 404 });
      }

      const [market] = (await tx`
        insert into futures_markets (
          pool_id, title, market_type, settlement_basis, opens_at, closes_at, rollover_amount,
          rollover_target_market_id, auto_created, open_window_note, loss_rule, status
        )
        values (
          ${group.id}, ${title}, ${marketType}, ${settlementBasis}, ${opensAt?.toISOString() ?? null},
          ${closesAt.toISOString()}, ${rolloverAmount}, ${rolloverTargetMarketId}, ${Boolean(body.autoCreated)},
          ${closeDescription}, ${lossRule}, 'open'
        )
        returning id
      `) as Array<{ id: number }>;

      for (const [index, option] of options.entries()) {
        await tx`
          insert into futures_options (market_id, label, sort_order)
          values (${market.id}, ${option}, ${index})
        `;
      }

      return { marketId: market.id, groupSlug: group.slug };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) {
      return NextResponse.json({ error: await error.text() }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not create futures pool";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as PatchBody;
  try {
    requireAdminKey(request.headers.get("x-admin-key") ?? body.key ?? null);
  } catch {
    return NextResponse.json({ error: "Invalid admin key" }, { status: 401 });
  }

  if (!Number.isInteger(body.marketId)) {
    return NextResponse.json({ error: "Market id is required" }, { status: 400 });
  }

  const sql = getSql();

  try {
    await ensureBettingTables(sql);
    await ensureGroupSchema(sql);

    const result = await sql.begin(async (tx) => {
      const marketRows = (await tx`
        select id, status, rollover_amount, rollover_target_market_id
        from futures_markets
        where id = ${body.marketId!}
        for update
      `) as Array<{
        id: number;
        status: string;
        rollover_amount: string | number;
        rollover_target_market_id: number | null;
      }>;
      const [market] = marketRows;
      if (!market) throw new Response("Futures pool not found", { status: 404 });

      if (body.action === "settle") {
        const payoutRate = body.payoutRate === undefined ? 1 : parseRate(body.payoutRate);
        if (payoutRate === null) throw new Response("Payout rate must be greater than 0 and up to 1", { status: 400 });
        return settleMarket({
          tx,
          marketId: market.id,
          rolloverAmount: Number(market.rollover_amount),
          rolloverTargetMarketId: market.rollover_target_market_id,
          settledOptionId: body.settledOptionId ?? null,
          payoutRate
        });
      }

      if (market.status === "settled" || market.status === "rolled_over") {
        throw new Response("Settled futures pools cannot be edited", { status: 409 });
      }

      const title = body.title === undefined ? null : clean(body.title);
      const opensAt = body.opensAt === undefined ? undefined : body.opensAt === null ? null : parseDate(body.opensAt);
      const closesAt = body.closesAt === undefined ? null : parseDate(body.closesAt);
      const rolloverAmount = body.rolloverAmount === undefined ? null : parseMoney(body.rolloverAmount);
      const rolloverTargetMarketId =
        body.rolloverTargetMarketId === undefined
          ? undefined
          : Number.isInteger(body.rolloverTargetMarketId)
            ? body.rolloverTargetMarketId!
            : null;
      const closeDescription = body.closeDescription === undefined ? undefined : clean(body.closeDescription) || null;
      const lossRule = body.lossRule === undefined ? undefined : clean(body.lossRule) || null;
      const status = body.status ?? null;

      if (body.title !== undefined && !title) throw new Response("Title is required", { status: 400 });
      if (body.opensAt !== undefined && body.opensAt !== null && !opensAt) {
        throw new Response("Valid open time is required", { status: 400 });
      }
      if (body.closesAt !== undefined && !closesAt) {
        throw new Response("Valid close time is required", { status: 400 });
      }
      if (body.rolloverAmount !== undefined && rolloverAmount === null) {
        throw new Response("Rollover amount must be non-negative", { status: 400 });
      }
      if (status && !["open", "closed", "void"].includes(status)) {
        throw new Response("Invalid status", { status: 400 });
      }

      const nextOpensAt = opensAt instanceof Date ? opensAt.toISOString() : null;
      const nextRolloverTargetMarketId = rolloverTargetMarketId === undefined ? null : rolloverTargetMarketId;
      const nextCloseDescription = closeDescription === undefined ? null : closeDescription;
      const nextLossRule = lossRule === undefined ? null : lossRule;

      const [updated] = (await tx`
        update futures_markets
        set
          title = coalesce(${title}, title),
          opens_at = case when ${body.opensAt !== undefined} then ${nextOpensAt} else opens_at end,
          closes_at = coalesce(${closesAt?.toISOString() ?? null}, closes_at),
          rollover_amount = coalesce(${rolloverAmount}, rollover_amount),
          rollover_target_market_id = case when ${body.rolloverTargetMarketId !== undefined} then ${nextRolloverTargetMarketId} else rollover_target_market_id end,
          open_window_note = case when ${body.closeDescription !== undefined} then ${nextCloseDescription} else open_window_note end,
          loss_rule = case when ${body.lossRule !== undefined} then ${nextLossRule} else loss_rule end,
          status = coalesce(${status}, status)
        where id = ${market.id}
        returning id, status
      `) as unknown as Array<{ id: number; status: string }>;

      return { marketId: updated.id, status: updated.status };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) {
      return NextResponse.json({ error: await error.text() }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Could not update futures pool";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function settleMarket({
  tx,
  marketId,
  rolloverAmount,
  rolloverTargetMarketId,
  settledOptionId,
  payoutRate
}: {
  tx: SqlTransaction;
  marketId: number;
  rolloverAmount: number;
  rolloverTargetMarketId: number | null;
  settledOptionId: number | null;
  payoutRate: number;
}) {
  if (settledOptionId !== null) {
    const optionRows = (await tx`
      select id
      from futures_options
      where id = ${settledOptionId}
        and market_id = ${marketId}
      limit 1
    `) as Array<{ id: number }>;
    if (!optionRows.length) throw new Response("Winning option not found", { status: 404 });
  }

  const entryRows = (await tx`
    select id, option_id, amount
    from futures_entries
    where market_id = ${marketId}
    order by id
  `) as Array<{ id: number; option_id: number; amount: string | number }>;
  const entries = entryRows.map((entry) => ({
    id: entry.id,
    optionId: entry.option_id,
    amount: Number(entry.amount)
  }));
  const totalStake = entries.reduce((total, entry) => total + entry.amount, 0);
  const totalPot = roundMoney(totalStake + rolloverAmount);
  const payoutPool = roundMoney(totalPot * payoutRate);
  const payouts =
    settledOptionId === null || payoutPool <= 0
      ? new Map<number, number>()
      : allocateWinningPayouts(entries, settledOptionId, payoutPool);

  if (!payouts.size) {
    await tx`
      update futures_entries
      set status = 'settled', result = 'rollover', payout_amount = 0
      where market_id = ${marketId}
    `;
    await tx`
      update futures_markets
      set status = 'rolled_over', settled_option_id = ${settledOptionId}, settled_at = now()
      where id = ${marketId}
    `;
    if (rolloverTargetMarketId !== null && rolloverTargetMarketId !== marketId) {
      await tx`
        update futures_markets
        set rollover_amount = rollover_amount + ${totalPot}
        where id = ${rolloverTargetMarketId}
      `;
    }
    return { marketId, status: "rolled_over", rolloverAmount: totalPot };
  }

  let paidOut = 0;
  for (const entry of entries) {
    const payout = payouts.get(entry.id) ?? 0;
    paidOut = roundMoney(paidOut + payout);
    await tx`
      update futures_entries
      set
        status = 'settled',
        result = ${payout > 0 ? (payoutRate < 1 ? "partial_win" : "win") : "loss"},
        payout_amount = ${payout}
      where id = ${entry.id}
    `;
  }

  const rolledOver = roundMoney(totalPot - paidOut);

  await tx`
    update futures_markets
    set status = 'settled', settled_option_id = ${settledOptionId}, settled_at = now()
    where id = ${marketId}
  `;
  if (rolledOver > 0 && rolloverTargetMarketId !== null && rolloverTargetMarketId !== marketId) {
    await tx`
      update futures_markets
      set rollover_amount = rollover_amount + ${rolledOver}
      where id = ${rolloverTargetMarketId}
    `;
  }
  return { marketId, status: "settled", paidOut, rolledOver };
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function parseDate(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseMoney(value: unknown) {
  const amount = roundMoney(Number(value ?? 0));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function parseRate(value: unknown) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) return null;
  return rate;
}
