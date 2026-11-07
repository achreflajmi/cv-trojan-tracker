import { describe, expect, it } from 'vitest';
import { injectedText, loadBattery, Profile, renderCv } from '@ctt/corpus';
import { loadYaml, sha256 } from '@ctt/shared';
import { extractWithPdfjs, hiddenTextPresent } from './index.ts';

const battery = loadBattery();
const job = battery.jobs.find((j) => j.slug === 'junior-backend-engineer');
if (!job) throw new Error('battery/jobs/junior-backend-engineer.yaml is missing');
const profile = loadYaml('battery/fixtures/stage1-profile.yaml', Profile);
const dataWhite = { condition: 'DATA', hiding: 'WHITE' } as const;

describe('render + pdf.js extraction', () => {
  it('renders a valid, byte-for-byte deterministic PDF', async () => {
    const a = await renderCv(profile, job, { condition: 'CLEAN' }, battery);
    const b = await renderCv(profile, job, { condition: 'CLEAN' }, battery);
    expect(Buffer.from(a.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(sha256(a)).toBe(sha256(b));
  });

  it('CLEAN: visible CV text is extracted and no keywords block is present', async () => {
    const text = await extractWithPdfjs(
      await renderCv(profile, job, { condition: 'CLEAN' }, battery),
    );
    expect(text).toContain(profile.name);
    expect(text).toContain(profile.experience[0]?.title);
    expect(hiddenTextPresent(text, job.key_requirements.join(', '))).toBe(false);
  });

  it('DATA/WHITE: same visible text as CLEAN, plus the hidden keywords', async () => {
    const clean = await extractWithPdfjs(
      await renderCv(profile, job, { condition: 'CLEAN' }, battery),
    );
    const data = await extractWithPdfjs(await renderCv(profile, job, dataWhite, battery));
    const hidden = injectedText(job, dataWhite, battery);
    expect(hidden).not.toBeNull();
    expect(data.startsWith(clean)).toBe(true);
    expect(hiddenTextPresent(data, hidden ?? '')).toBe(true);
  });

  it('refuses a hidden condition without a hiding method', async () => {
    await expect(renderCv(profile, job, { condition: 'DATA' }, battery)).rejects.toThrow(/needs/);
  });
});
