import { describe, expect, it } from 'vitest';
import { injectedText, Job, Profile, renderCv } from '@ctt/corpus';
import { loadYaml, sha256 } from '@ctt/shared';
import { extractWithPdfjs, hiddenTextPresent } from './index.ts';

const job = loadYaml('battery/jobs/junior-backend-engineer.yaml', Job);
const profile = loadYaml('battery/fixtures/stage1-profile.yaml', Profile);
const dataWhite = { condition: 'DATA', hiding: 'WHITE' } as const;

describe('render + pdf.js extraction', () => {
  it('renders a valid, byte-for-byte deterministic PDF', async () => {
    const a = await renderCv(profile, job, { condition: 'CLEAN' });
    const b = await renderCv(profile, job, { condition: 'CLEAN' });
    expect(Buffer.from(a.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(sha256(a)).toBe(sha256(b));
  });

  it('CLEAN: visible CV text is extracted and no keywords block is present', async () => {
    const text = await extractWithPdfjs(await renderCv(profile, job, { condition: 'CLEAN' }));
    expect(text).toContain(profile.name);
    expect(text).toContain(profile.experience[0]?.title);
    expect(hiddenTextPresent(text, job.key_requirements.join(', '))).toBe(false);
  });

  it('DATA/WHITE: same visible text as CLEAN, plus the hidden keywords', async () => {
    const clean = await extractWithPdfjs(await renderCv(profile, job, { condition: 'CLEAN' }));
    const data = await extractWithPdfjs(await renderCv(profile, job, dataWhite));
    const hidden = injectedText(job, dataWhite);
    expect(hidden).not.toBeNull();
    expect(data.startsWith(clean)).toBe(true);
    expect(hiddenTextPresent(data, hidden ?? '')).toBe(true);
  });

  it('refuses methods that are not built yet instead of silently rendering CLEAN', async () => {
    await expect(renderCv(profile, job, { condition: 'DATA', hiding: 'TINY' })).rejects.toThrow(
      /Stage 2/,
    );
  });
});
