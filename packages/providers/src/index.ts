import type { ModelAdapter, Provider, ProvidersConfig } from '@ctt/shared';
import { AnthropicAdapter } from './anthropic.ts';
import { FakeAdapter } from './fake.ts';
import { GoogleAdapter } from './google.ts';
import { withPolicy } from './limiter.ts';
import { OpenAIAdapter } from './openai.ts';
import { OpenRouterAdapter } from './openrouter.ts';

export { AnthropicAdapter } from './anthropic.ts';
export { FakeAdapter, type Script } from './fake.ts';
export { GoogleAdapter } from './google.ts';
export { OpenAIAdapter } from './openai.ts';
export { OpenRouterAdapter } from './openrouter.ts';
export { ProviderHttpError } from './errors.ts';
export { Limiter, withPolicy } from './limiter.ts';
export { isRetryable, withRetry, type RetryDeps, type RetryPolicy } from './retry.ts';

/** The bare adapter: no retries, no concurrency limit. Keys are read from env here. */
export function createAdapter(provider: Provider): ModelAdapter {
  switch (provider) {
    case 'fake':
      return new FakeAdapter();
    case 'anthropic':
      return new AnthropicAdapter();
    case 'openai':
      return new OpenAIAdapter();
    case 'google':
      return new GoogleAdapter();
    case 'openrouter':
      return new OpenRouterAdapter();
  }
}

/**
 * The adapter wrapped with its provider's retry and concurrency policy from
 * config/providers.yaml. Real providers must have a policy; the fake one may not.
 */
export function createPolicyAdapter(provider: Provider, config: ProvidersConfig): ModelAdapter {
  const adapter = createAdapter(provider);
  const policy = config.providers[provider];
  if (policy) return withPolicy(adapter, policy);
  if (provider === 'fake') return adapter;
  throw new Error(`config/providers.yaml has no policy for "${provider}"`);
}
