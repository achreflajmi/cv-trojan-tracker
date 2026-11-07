import { readFileSync } from 'node:fs';

export interface Prompt {
  version: string;
  system: string;
  userTemplate: string;
}

/** A prompt file has a `<!-- system -->` part followed by a `<!-- user -->` part. */
export function loadPrompt(path: string, version: string): Prompt {
  const text = readFileSync(path, 'utf8');
  const match = /<!-- system -->([\s\S]*?)<!-- user -->([\s\S]*)$/.exec(text);
  if (!match?.[1] || !match[2]) throw new Error(`${path}: missing system/user markers`);
  return { version, system: match[1].trim(), userTemplate: match[2].trim() };
}

export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`Template variable {{${name}}} has no value`);
    return value;
  });
}
