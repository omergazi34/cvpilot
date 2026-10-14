import './helpers.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quickAtsCheck } from '../lib/heuristic.js';
import { SAMPLE_CV, SAMPLE_JOB } from './helpers.js';

const AI_KEYS = [
  'ats_score', 'verdict', 'summary', 'score_breakdown', 'strengths', 'issues', 'found_keywords',
  'missing_keywords', 'rewrites', 'profile', 'job',
];

describe('quickAtsCheck (demo mode)', () => {
  it('returns the same shape as the AI analysis, so the UI renders both', () => {
    const result = quickAtsCheck({ cvText: SAMPLE_CV });
    assert.equal(result.mode, 'demo');
    for (const key of AI_KEYS) assert.ok(key in result, `missing ${key}`);
    assert.deepEqual(Object.keys(result.score_breakdown).sort(), ['formatting', 'impact', 'keyword_match', 'readability', 'structure']);
    for (const score of [result.ats_score, ...Object.values(result.score_breakdown)]) {
      assert.ok(Number.isInteger(score) && score >= 0 && score <= 100, `score out of range: ${score}`);
    }
  });

  it('scores a well-structured CV well and recognises its sections and contacts', () => {
    const result = quickAtsCheck({ cvText: SAMPLE_CV });
    assert.ok(result.ats_score >= 70, `expected a good score, got ${result.ats_score}`);
    assert.equal(result.profile.name, 'Ayşe Yılmaz');
    assert.ok(result.strengths.some((s) => s.includes('İletişim bilgileri')));
    assert.ok(!result.issues.some((i) => i.title.includes('bölümü bulunamadı')));
  });

  it('matches job-posting keywords, including Turkish capital İ handling', () => {
    const result = quickAtsCheck({ cvText: SAMPLE_CV, jobText: SAMPLE_JOB });
    const missing = result.missing_keywords.map((k) => k.keyword.toLowerCase());
    assert.ok(result.found_keywords.map((k) => k.toLowerCase()).includes('react'));
    assert.ok(missing.includes('graphql'));
    assert.ok(missing.includes('cypress'));
    assert.ok(!missing.includes('typescript'));
  });

  it('flags missing contact details, weak phrasing and file-format problems', () => {
    const cvText = SAMPLE_CV.replace(/ayse\.yilmaz@example\.com \| /, '');
    const result = quickAtsCheck({
      cvText,
      notes: [{ level: 'kritik', text: 'CV bir görsel dosyası.' }],
    });
    const titles = result.issues.map((i) => i.title);
    assert.ok(titles.includes('E-posta adresi bulunamadı'));
    assert.ok(titles.includes('Pasif ifadeler kullanılmış'));
    assert.ok(titles.includes('Dosya biçimi uyarısı'));
    assert.equal(result.issues[0].severity, 'kritik', 'issues are ordered by severity');
    const clean = quickAtsCheck({ cvText: SAMPLE_CV });
    assert.ok(result.score_breakdown.formatting < clean.score_breakdown.formatting);
  });

  it('treats a very short CV as weak', () => {
    const result = quickAtsCheck({ cvText: 'Ali Veli\nYazılımcı\nBirkaç projede çalıştım.' });
    assert.ok(result.ats_score < 50);
    assert.ok(result.issues.some((i) => i.title === 'CV çok kısa'));
  });
});
