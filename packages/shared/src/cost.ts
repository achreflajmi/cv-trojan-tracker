import type { PricesConfig } from './config.ts';

export class MissingPriceError extends Error {}

function priceFor(prices: PricesConfig, modelId: string) {
  const price = prices.models[modelId];
  if (!price) {
    throw new MissingPriceError(
      `config/prices.yaml has no price for "${modelId}". The owner must add it (dated, with source).`,
    );
  }
  const free = price.input_usd_per_mtok === 0 && price.output_usd_per_mtok === 0;
  if (free) return { ...price, rate: 0 };
  if (!prices.usd_to_eur) {
    throw new MissingPriceError('config/prices.yaml has no usd_to_eur rate.');
  }
  return { ...price, rate: prices.usd_to_eur.rate };
}

export function costEur(
  prices: PricesConfig,
  modelId: string,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const p = priceFor(prices, modelId);
  if (p.max_prompt_tokens !== undefined && usage.inputTokens > p.max_prompt_tokens) {
    throw new MissingPriceError(
      `"${modelId}" is priced only up to ${p.max_prompt_tokens} prompt tokens; got ${usage.inputTokens}.`,
    );
  }
  const usd =
    (usage.inputTokens * p.input_usd_per_mtok + usage.outputTokens * p.output_usd_per_mtok) / 1e6;
  return usd * p.rate;
}

/**
 * Upper bound before a call. Input tokens are bounded by the UTF-8 byte length of the
 * prompt (a token is never shorter than one byte). Output is bounded by max_tokens,
 * which also caps thinking tokens.
 */
export function worstCaseCostEur(
  prices: PricesConfig,
  modelId: string,
  promptBytes: number,
  maxTokens: number,
): number {
  return costEur(prices, modelId, { inputTokens: promptBytes, outputTokens: maxTokens });
}
