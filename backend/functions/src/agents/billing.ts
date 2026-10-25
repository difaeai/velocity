/**
 * What an AI agent costs us, and what a customer pays for one.
 *
 * Two columns an admin edits on AI agents & billing: `cost` is what Twilio,
 * Google and Meta charge us; `price` is what we charge. A customer buys a
 * monthly package — so many agents, phone numbers and calls a day — and the
 * quote is the package priced at `price`, with `cost` beside it so the margin
 * is on the screen when the price is set rather than discovered on the invoice.
 *
 * The defaults are October 2026's published rates:
 *  - Twilio outbound to a Pakistani mobile: $0.18/min, billed per started minute.
 *  - Gemini Live (the voice): $0.005/min heard + $0.018/min spoken.
 *  - A Twilio number: from $1.15/month (Pakistani numbers are not sold).
 *  - WhatsApp in Pakistan: $0.0473 a marketing template, $0.015 a utility or
 *    service message past the first 1,000 a month.
 *
 * Pure, so the money is tested without a database.
 */

export interface RateCard {
  /** What it costs us, USD. */
  cost: {
    callPerMin: number;
    aiVoicePerMin: number;
    numberPerMonth: number;
    waTemplate: number;
    waMessage: number;
    /** One AI-written WhatsApp reply (a Flash call). */
    aiReply: number;
  };
  /** What a customer pays, USD. */
  price: {
    perAgentMonth: number;
    perNumberMonth: number;
    perMin: number;
    perWaMessage: number;
  };
  /** Rupees per dollar for the PKR a customer is asked to send. */
  usdToPkr: number;
}

export const DEFAULT_RATE_CARD: RateCard = {
  cost: { callPerMin: 0.18, aiVoicePerMin: 0.023, numberPerMonth: 1.15, waTemplate: 0.0473, waMessage: 0.015, aiReply: 0.002 },
  price: { perAgentMonth: 10, perNumberMonth: 3, perMin: 0.3, perWaMessage: 0.05 },
  usdToPkr: 280,
};

/** What a customer buys for a month. */
export interface AgentPackage {
  agents: number;
  /** Phone numbers across all their agents. */
  numbers: number;
  callsPerDay: number;
  /** How long a call runs on average; what turns calls into minutes. */
  avgCallMin: number;
  waMessagesPerMonth: number;
}

/** The package as a workspace holds it once it is paid for. */
export interface AgentPlan extends AgentPackage {
  minutesPerMonth: number;
  priceUsd: number;
  paidUntilMs: number;
  setAtMs: number;
  setBy: string;
}

export const DAYS = 30;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Merge what is stored over the defaults, field by field. */
export function rateCardFrom(stored: Partial<RateCard> | undefined): RateCard {
  return {
    cost: { ...DEFAULT_RATE_CARD.cost, ...(stored?.cost ?? {}) },
    price: { ...DEFAULT_RATE_CARD.price, ...(stored?.price ?? {}) },
    usdToPkr: stored?.usdToPkr ?? DEFAULT_RATE_CARD.usdToPkr,
  };
}

export interface Quote {
  minutes: number;
  priceUsd: number;
  pricePkr: number;
  costUsd: number;
  marginUsd: number;
  marginPct: number;
  lines: { label: string; priceUsd: number; costUsd: number }[];
}

/** A month of `pkg`, priced and costed. */
export function quote(pkg: AgentPackage, card: RateCard): Quote {
  const minutes = Math.ceil(pkg.callsPerDay * DAYS * pkg.avgCallMin);
  // A guess at the mix: about one conversation in five starts with a template.
  const waCost = pkg.waMessagesPerMonth * (0.2 * card.cost.waTemplate + 0.8 * card.cost.waMessage + card.cost.aiReply);
  const lines = [
    { label: `${pkg.agents} AI agent${pkg.agents === 1 ? '' : 's'}`, priceUsd: pkg.agents * card.price.perAgentMonth, costUsd: 0 },
    {
      label: `${pkg.numbers} phone number${pkg.numbers === 1 ? '' : 's'}`,
      priceUsd: pkg.numbers * card.price.perNumberMonth,
      costUsd: pkg.numbers * card.cost.numberPerMonth,
    },
    {
      label: `${pkg.callsPerDay} calls a day ≈ ${minutes} minutes`,
      priceUsd: minutes * card.price.perMin,
      costUsd: minutes * (card.cost.callPerMin + card.cost.aiVoicePerMin),
    },
    {
      label: `${pkg.waMessagesPerMonth} WhatsApp messages`,
      priceUsd: pkg.waMessagesPerMonth * card.price.perWaMessage,
      costUsd: waCost,
    },
  ].map((l) => ({ ...l, priceUsd: round2(l.priceUsd), costUsd: round2(l.costUsd) }));
  const priceUsd = round2(lines.reduce((s, l) => s + l.priceUsd, 0));
  const costUsd = round2(lines.reduce((s, l) => s + l.costUsd, 0));
  return {
    minutes,
    priceUsd,
    pricePkr: Math.round(priceUsd * card.usdToPkr),
    costUsd,
    marginUsd: round2(priceUsd - costUsd),
    marginPct: priceUsd > 0 ? Math.round(((priceUsd - costUsd) / priceUsd) * 100) : 0,
    lines,
  };
}

/** What one finished call cost us: the line by started minute, the voice by the second. */
export function callCostUsd(seconds: number, card: RateCard): number {
  if (seconds <= 0) return 0;
  return Math.ceil(seconds / 60) * card.cost.callPerMin + (seconds / 60) * card.cost.aiVoicePerMin;
}

/** A month of one workspace's agent usage, as `agentUsage/{month}_{wid}` holds it. */
export interface AgentUsage {
  calls: number;
  answered: number;
  seconds: number;
  /** Line minutes, each call rounded up. */
  lineMin: number;
  waTemplates: number;
  waOut: number;
  waIn: number;
  aiReplies: number;
  costUsd: number;
}

export const EMPTY_USAGE: AgentUsage = {
  calls: 0,
  answered: 0,
  seconds: 0,
  lineMin: 0,
  waTemplates: 0,
  waOut: 0,
  waIn: 0,
  aiReplies: 0,
  costUsd: 0,
};

/**
 * Why a call or a message may not go now, or null when it may. The house has
 * no plan and no caps; a customer's caps are the package they paid for.
 */
export function allowance(
  plan: AgentPlan | null | undefined,
  used: { callsToday: number; month: Pick<AgentUsage, 'lineMin' | 'waOut' | 'waTemplates'> },
  what: 'call' | 'whatsapp',
  nowMs: number,
  house: boolean,
): string | null {
  if (house) return null;
  if (!plan || plan.paidUntilMs <= nowMs) {
    return 'AI calling and WhatsApp need an agent package. Choose one on the Sales page and pay for it on Billing.';
  }
  if (what === 'call') {
    if (used.callsToday >= plan.callsPerDay) return `Today’s ${plan.callsPerDay} calls are used. More tomorrow, or a bigger package.`;
    if (used.month.lineMin >= plan.minutesPerMonth) return `This month’s ${plan.minutesPerMonth} call minutes are used.`;
    return null;
  }
  if (used.month.waOut + used.month.waTemplates >= plan.waMessagesPerMonth) {
    return `This month’s ${plan.waMessagesPerMonth} WhatsApp messages are used — replies now wait for a person.`;
  }
  return null;
}
