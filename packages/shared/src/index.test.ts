import { describe, expect, it } from 'vitest';
import { PROJECT_NAME } from './index.js';

describe('scaffold', () => {
  it('runs a test', () => {
    expect(PROJECT_NAME).toBe('cv-trojan-tracker');
  });
});
