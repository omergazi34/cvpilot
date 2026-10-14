import './helpers.js';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import mammoth from 'mammoth';
import { cvToDocx, letterToDocx } from '../lib/docx.js';

const CV = {
  language: 'tr',
  name: 'Ayşe Yılmaz',
  headline: 'Frontend Developer',
  email: 'ayse@example.com',
  phone: '+90 555 123 45 67',
  location: 'İstanbul',
  links: ['linkedin.com/in/ayse'],
  summary: 'React ve TypeScript ile web uygulamaları geliştiren frontend geliştirici.',
  skills: [{ group: 'Diller', items: ['TypeScript', 'JavaScript'] }],
  experience: [{
    role: 'Frontend Developer', company: 'Acme', location: 'İstanbul', start: '03/2021', end: 'Günümüz',
    bullets: ['Sayfa yüklenme süresini [%X] azalttım.', ''],
  }],
  education: [{ degree: 'Lisans', school: 'Örnek Üniversitesi', location: '', start: '2015', end: '2019', details: '' }],
  projects: [{ name: 'Portfolyo', description: 'Kişisel site', tech: ['Next.js'] }],
  certifications: [],
  languages: ['İngilizce (C1)'],
  extras: [{ heading: 'Gönüllülük', items: ['Kodlama atölyeleri'] }],
};

const textOf = async (buffer) => (await mammoth.extractRawText({ buffer })).value;

describe('cvToDocx', () => {
  it('produces a Word file whose text an ATS can read back in order', async () => {
    const buffer = await cvToDocx(CV);
    assert.equal(buffer.subarray(0, 2).toString(), 'PK', 'a .docx is a zip archive');
    const text = await textOf(buffer);
    const order = ['Ayşe Yılmaz', 'PROFESYONEL ÖZET', 'YETKİNLİKLER', 'İŞ DENEYİMİ', 'Sayfa yüklenme', 'EĞİTİM', 'PROJELER', 'YABANCI DİLLER', 'GÖNÜLLÜLÜK'];
    let last = -1;
    for (const marker of order) {
      const at = text.indexOf(marker);
      assert.ok(at > last, `"${marker}" missing or out of order`);
      last = at;
    }
    assert.match(text, /ayse@example\.com {2}\| {2}\+90 555 123 45 67/);
    assert.doesNotMatch(text, /SERTİFİKALAR/, 'empty sections are omitted');
  });

  it('uses English headings for English CVs', async () => {
    const text = await textOf(await cvToDocx({ ...CV, language: 'en' }));
    assert.match(text, /WORK EXPERIENCE/);
    assert.match(text, /PROFESSIONAL SUMMARY/);
  });

  it('survives a minimal CV', async () => {
    const text = await textOf(await cvToDocx({}));
    assert.match(text, /Ad Soyad/);
  });
});

describe('letterToDocx', () => {
  it('keeps paragraphs and line breaks', async () => {
    const buffer = await letterToDocx({ text: 'Sayın Ekip,\r\n\r\nBirinci paragraf.\nİkinci satır.\n\nSaygılarımla,\nAyşe', title: 'Ön Yazı' });
    // Raw-text extraction drops soft line breaks, so check the HTML rendering instead.
    const html = (await mammoth.convertToHtml({ buffer })).value;
    assert.equal(html, '<p>Sayın Ekip,</p><p>Birinci paragraf.<br />İkinci satır.</p><p>Saygılarımla,<br />Ayşe</p>');
  });
});
