import type { ModelAdapter, Provider } from '@ctt/shared';
import { AnthropicAdapter } from './anthropic.ts';
import { FakeAdapter } from './fake.ts';

export { AnthropicAdapter } from './anthropic.ts';
export { FakeAdapter, type Script } from './fake.ts';

export function createAdapter(provider: Provider): ModelAdapter {
  switch (provider) {
    case 'fake':
      return new FakeAdapter();
    case 'anthropic':
      return new AnthropicAdapter();
    case 'openai':
    case 'google':
    case 'openrouter':
      throw new Error(`The ${provider} adapter is built in Stage 4`);
  }
}
