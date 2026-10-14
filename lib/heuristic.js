// Demo mode: a rule-based ATS check used when no API key is configured. It returns the same
// shape as the AI analysis, so the UI renders both modes with the same code.

// Map Turkish "İ" to "i", then lowercase normally. The tr-TR locale is deliberately not used:
// it would turn English terms like "LINUX" into "lınux".
const lower = (s) => s.replace(/İ/g, 'i').toLowerCase();

const STOPWORDS = new Set(lower(`
ve veya ile için gibi da de ki bir bu şu o olan olarak olmak olması olup en çok daha her tüm
ayrıca ise ama fakat ancak kadar sonra önce üzere göre bize biz siz sizin bizim onların
olan olarak yer alan sahip tercihen tercih edilir aranan aranıyor arıyoruz arıyor
iyi derecede konusunda konularında alanında alanda bilgi bilgisi bilgili deneyimli deneyim deneyimi tecrübe tecrübeli
yıl yıllık en az minimum tam zamanlı pozisyon pozisyonu ilan aday adaylar ekip ekibimize ekibe
şirket şirketimiz firmamız firmamıza çalışacak çalışma çalışmak görev görevler sorumluluklar nitelikler genel
the a an and or of to in on for with as at by from is are be been being this that these those it its
we you our your their they will can may should must have has had do does not but if into about over
experience years year strong knowledge skills ability good excellent work working team role position
candidate candidates required requirements preferred plus including etc using use within across
responsibilities qualifications job looking seeking join us new more least minimum
senior junior kıdemli uzman nitelikler tercihen sebebidir sebebi alışkanlığı hakimiyet güçlü
`).split(/\s+/).filter(Boolean));

const TECH_TERMS = [
  'javascript', 'typescript', 'python', 'java', 'c#', 'c++', 'go', 'golang', 'rust', 'php', 'ruby', 'kotlin', 'swift',
  'react', 'react native', 'vue', 'angular', 'next.js', 'node.js', 'express', 'nestjs', 'django', 'flask', 'fastapi',
  'spring', 'spring boot', '.net', 'asp.net', 'laravel', 'flutter', 'html', 'css', 'sass', 'tailwind',
  'sql', 'mysql', 'postgresql', 'mongodb', 'redis', 'elasticsearch', 'oracle', 'firebase',
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'jenkins', 'ci/cd', 'git', 'github', 'gitlab', 'linux',
  'rest', 'graphql', 'microservices', 'mikroservis', 'kafka', 'rabbitmq',
  'machine learning', 'makine öğrenmesi', 'deep learning', 'yapay zeka', 'nlp', 'tensorflow', 'pytorch', 'pandas', 'numpy',
  'power bi', 'tableau', 'excel', 'sap', 'erp', 'crm', 'salesforce', 'jira', 'confluence', 'figma', 'photoshop',
  'agile', 'scrum', 'kanban', 'seo', 'sem', 'google analytics', 'google ads', 'unit test', 'tdd', 'selenium',
  'jest', 'react testing library', 'cypress', 'playwright', 'webpack', 'vite', 'redux', 'erişilebilirlik', 'accessibility',
  'proje yönetimi', 'project management', 'veri analizi', 'data analysis', 'b2b', 'b2c', 'kpi', 'pmp',
];

const ACTION_STEMS = [
  'geliştir', 'yönet', 'tasarla', 'liderlik', 'artır', 'azalt', 'oluştur', 'kurdu', 'kurul', 'optimize', 'uygula',
  'koordine', 'başlat', 'hayata geçir', 'analiz', 'iyileştir', 'gerçekleştir', 'eğit', 'planla', 'otomatize',
  'entegre', 'dönüştür', 'hızlandır', 'kazandır', 'sağladı', 'sağladım',
  'led', 'managed', 'developed', 'designed', 'built', 'created', 'increased', 'reduced', 'improved', 'launched',
  'implemented', 'delivered', 'optimized', 'automated', 'achieved', 'coordinated', 'drove', 'spearheaded',
  'streamlined', 'mentored', 'established', 'negotiated', 'grew', 'owned',
];
const WEAK_PHRASES = [
  'sorumluydum', 'sorumlu', 'görev aldım', 'yardımcı oldum', 'yardımcı olmak', 'katkıda bulundum', 'çalıştım',
  'responsible for', 'helped', 'worked on', 'duties included', 'assisted',
];

const SECTIONS = {
  summary: { label: 'Özet / Profil', re: /^(özet|profil|hakkımda|kariyer hedefi|profesyonel özet|summary|profile|about( me)?|objective|professional summary)\b/i, weight: 15 },
  experience: { label: 'İş Deneyimi', re: /^(iş deneyimi|deneyim|deneyimler|tecrübe|iş tecrübesi|work experience|experience|employment|professional experience|work history)\b/i, weight: 30 },
  education: { label: 'Eğitim', re: /^(eğitim|eğitim bilgileri|öğrenim|education|academic)\b/i, weight: 20 },
  skills: { label: 'Yetenekler', re: /^(yetenekler|beceriler|yetkinlikler|teknik (bilgi|beceriler|yetkinlikler)|skills|technical skills|core competencies|competencies)\b/i, weight: 20 },
  languages: { label: 'Yabancı Diller', re: /^(yabancı dil(ler)?|diller|languages)\b/i, weight: 5 },
  certifications: { label: 'Sertifikalar', re: /^(sertifikalar|sertifika|kurslar|certifications|certificates|courses)\b/i, weight: 5 },
  projects: { label: 'Projeler', re: /^(projeler|proje|projects)\b/i, weight: 5 },
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(n)));

function tokenize(text) {
  return lower(text)
    .split(/[^a-zçğıöşü0-9+#./'-]+/i)
    .map((t) => t.split("'")[0].replace(/^[./-]+|[./-]+$/g, ''))
    .filter((t) => t.length > 1 && !/^\d+$/.test(t));
}

function containsTerm(haystack, term) {
  if (/[^a-zçğıöşü0-9 ]/i.test(term) || term.length <= 3) {
    return new RegExp(`(^|[^a-zçğıöşü0-9])${escapeRe(term)}(?![a-zçğıöşü0-9+#])`, 'i').test(haystack);
  }
  // Stem matching for Turkish suffixes: "deneyimli" ~ "deneyim"
  const stem = term.length >= 7 ? term.slice(0, term.length - 2) : term;
  return new RegExp(`(^|[^a-zçğıöşü0-9])${escapeRe(stem)}`, 'i').test(haystack);
}

function extractJobKeywords(jobText) {
  const text = lower(jobText);
  const found = new Map();
  for (const term of TECH_TERMS) {
    if (containsTerm(text, term)) found.set(term, 10);
  }
  const counts = new Map();
  for (const tok of tokenize(jobText)) {
    if (STOPWORDS.has(tok) || tok.length < 3) continue;
    counts.set(tok, (counts.get(tok) || 0) + 1);
  }
  // The first line is usually "Position - Company"; don't count the company as a keyword.
  const companyPart = jobText.trim().split('\n')[0].split(/\s[-–|@]\s/).slice(1).join(' ');
  for (const tok of tokenize(companyPart)) counts.delete(tok);
  // Capitalised terms inside a sentence (e.g. "SAP", "Excel") are likely skills; words at the
  // start of a line or sentence are capitalised anyway, so they don't count.
  const capitalized = new Set(
    (jobText.match(/(?<=[a-zçğıöşü0-9,;] |[(/])[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü0-9+#.]{1,}/g) || []).map(lower),
  );
  for (const [tok, c] of counts) {
    const score = c * 2 + (capitalized.has(tok) ? 2 : 0);
    if (c >= 2 || capitalized.has(tok)) found.set(tok, Math.max(found.get(tok) || 0, score));
  }
  // Drop single-word terms that are part of an already matched multi-word term.
  const multi = [...found.keys()].filter((k) => k.includes(' '));
  for (const k of [...found.keys()]) {
    if (!k.includes(' ') && multi.some((m) => m.split(' ').includes(k))) found.delete(k);
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, s]) => ({ keyword: k, weight: s }));
}

function detectSections(lines) {
  const present = {};
  for (const raw of lines) {
    // Search in lowercase: a capital "İ" (as in "İş Deneyimi") does not match case-insensitive regexes.
    const line = lower(raw.trim().replace(/[:•\-–|]+$/g, '').trim());
    if (!line || line.length > 42) continue;
    for (const [key, def] of Object.entries(SECTIONS)) {
      if (def.re.test(line)) present[key] = true;
    }
  }
  return present;
}

export function quickAtsCheck({ cvText, jobText = '', notes = [] }) {
  const text = cvText;
  const lc = lower(text);
  const lines = text.split('\n');
  const words = (text.match(/\S+/g) || []).length;

  const email = /[\w.+-]+@[\w-]+\.[\w.-]+/.test(text);
  const phone = /(\+?\d[\d\s().-]{8,}\d)/.test(text);
  const linkedin = /linkedin\.com\//i.test(text);
  const sections = detectSections(lines);

  const bulletLines = lines.filter((l) => /^\s*([-•*▪●◦–]|\d+[.)])\s+/.test(l));
  const actionCount = ACTION_STEMS.reduce((n, stem) => n + (lc.match(new RegExp(escapeRe(stem), 'g')) || []).length, 0);
  const weakCount = WEAK_PHRASES.reduce((n, p) => n + (lc.match(new RegExp(escapeRe(p), 'g')) || []).length, 0);
  const metricCount = (text.match(/(%\s?\d+|\d+\s?%|\d+[.,]?\d*\s?(k|bin|milyon|million|m|tl|₺|\$|€|kişi|people|users|kullanıcı|müşteri|customers|x)\b|\d+\+)/gi) || []).length;
  const longLines = lines.filter((l) => l.length > 220).length;

  // --- Keyword match ---
  let found = [];
  const missing = [];
  let keywordScore;
  if (jobText.trim()) {
    const jobKeywords = extractJobKeywords(jobText);
    for (const k of jobKeywords) (containsTerm(lc, k.keyword) ? found : missing).push(k);
    const total = jobKeywords.reduce((n, k) => n + k.weight, 0) || 1;
    keywordScore = clamp((found.reduce((n, k) => n + k.weight, 0) / total) * 100);
  } else {
    found = TECH_TERMS.filter((t) => containsTerm(lc, t)).map((keyword) => ({ keyword, weight: 1 }));
    keywordScore = clamp(40 + found.length * 4 + (sections.skills ? 15 : 0), 0, 85);
  }

  // --- Sub-scores ---
  let formatting = 100;
  if (!email) formatting -= 25;
  if (!phone) formatting -= 10;
  if (longLines > 3) formatting -= 10;
  for (const n of notes) formatting -= n.level === 'kritik' ? 45 : n.level === 'orta' ? 12 : 6;
  formatting = clamp(formatting);

  const structure = clamp(
    Object.entries(SECTIONS).reduce((n, [key, def]) => n + (sections[key] ? def.weight : 0), 0) + (email ? 10 : 0),
  );
  const impact = clamp(25 + Math.min(actionCount, 10) * 5 + Math.min(metricCount, 8) * 6 - weakCount * 5);
  let readability = words >= 300 && words <= 900 ? 90 : words >= 200 && words <= 1200 ? 72 : 50;
  if (bulletLines.length < 3) readability -= 12;
  readability = clamp(readability - longLines * 3);

  const weights = jobText.trim()
    ? { keyword_match: 0.35, formatting: 0.2, structure: 0.2, impact: 0.15, readability: 0.1 }
    : { keyword_match: 0.2, formatting: 0.25, structure: 0.25, impact: 0.18, readability: 0.12 };
  const breakdown = { keyword_match: keywordScore, formatting, structure, impact, readability };
  const ats = clamp(Object.entries(weights).reduce((n, [k, w]) => n + breakdown[k] * w, 0));

  // --- Findings ---
  const issues = [];
  const strengths = [];
  const issue = (severity, category, title, detail, fix) => issues.push({ severity, category, title, detail, fix });

  for (const n of notes) issue(n.level, 'Biçim', 'Dosya biçimi uyarısı', n.text, 'Tek sütunlu, metin tabanlı bir DOCX veya PDF kullanın.');
  if (!email) issue('kritik', 'İletişim', 'E-posta adresi bulunamadı', 'ATS adayla iletişim için e-posta alanını arar.', 'E-posta adresinizi CV gövdesinin en üstüne düz metin olarak ekleyin.');
  if (!phone) issue('orta', 'İletişim', 'Telefon numarası bulunamadı', 'İşe alımcılar hızlı ulaşım için telefon bekler.', 'Telefonunuzu ülke koduyla (+90 ...) ekleyin.');
  for (const [key, def] of Object.entries(SECTIONS)) {
    if (!sections[key] && def.weight >= 15) {
      issue(def.weight >= 20 ? 'kritik' : 'orta', 'Yapı', `"${def.label}" bölümü bulunamadı`, 'ATS içerikleri standart bölüm başlıklarına göre ayrıştırır.', `"${def.label}" başlıklı ayrı bir bölüm ekleyin; yaratıcı başlıklar yerine standart ifadeler kullanın.`);
    }
  }
  if (missing.length) {
    issue(missing.length > 6 ? 'kritik' : 'orta', 'Anahtar Kelime', `İlanda geçen ${missing.length} anahtar kelime CV'de yok`, `Eksikler: ${missing.slice(0, 8).map((k) => k.keyword).join(', ')}`, 'Gerçekten sahip olduğunuz yetkinlikleri ilandaki ifadelerle aynı şekilde Yetenekler ve Deneyim bölümlerine ekleyin.');
  }
  if (metricCount < 3) issue('orta', 'Etki', 'Ölçülebilir sonuç az', `CV'de yalnızca ${metricCount} sayısal sonuç bulundu.`, 'Her deneyime en az bir somut sonuç ekleyin: "%20 artış", "15 kişilik ekip", "2 hafta erken teslim" gibi.');
  if (weakCount > 1) issue('dusuk', 'Etki', 'Pasif ifadeler kullanılmış', `"Sorumluydum", "yardımcı oldum" gibi ${weakCount} zayıf ifade var.`, '"Geliştirdim", "yönettim", "artırdım" gibi güçlü eylem fiilleriyle başlayın.');
  if (words < 200) issue('orta', 'Okunabilirlik', 'CV çok kısa', `${words} kelime; deneyimleriniz yeterince anlatılmıyor olabilir.`, 'Her rol için 3-5 madde ile sorumluluk ve başarıları ekleyin.');
  if (words > 1200) issue('orta', 'Okunabilirlik', 'CV çok uzun', `${words} kelime; işe alımcılar ilk taramada ortalama birkaç saniye ayırır.`, 'Eski ve ilgisiz deneyimleri kısaltın; 1-2 sayfayı hedefleyin.');
  if (bulletLines.length < 3) issue('dusuk', 'Okunabilirlik', 'Madde işaretleri az kullanılmış', 'Uzun paragraflar hem ATS hem işe alımcı için zor okunur.', 'Deneyimleri kısa madde işaretleriyle yazın.');

  if (email && phone) strengths.push('İletişim bilgileri (e-posta ve telefon) okunabilir durumda.');
  if (linkedin) strengths.push('LinkedIn profil bağlantısı eklenmiş.');
  if (sections.experience && sections.education) strengths.push('Temel bölümler (Deneyim, Eğitim) standart başlıklarla yer alıyor.');
  if (sections.skills) strengths.push('Ayrı bir Yetenekler bölümü var; ATS anahtar kelime taramasında avantaj sağlar.');
  if (metricCount >= 3) strengths.push(`${metricCount} ölçülebilir sonuç kullanılmış.`);
  if (actionCount >= 5) strengths.push('Güçlü eylem fiilleri kullanılmış.');
  if (found.length >= 5) strengths.push(`${found.length} ilgili anahtar kelime tespit edildi.`);
  if (!strengths.length) strengths.push('CV metni başarıyla okunabiliyor.');

  const order = { kritik: 0, orta: 1, dusuk: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  const firstLines = lines.map((l) => l.trim()).filter(Boolean);
  const nameGuess = firstLines[0] && firstLines[0].length <= 40 && firstLines[0].split(/\s+/).length <= 4 ? firstLines[0] : '';

  return {
    mode: 'demo',
    ats_score: ats,
    verdict: ats >= 80 ? 'CV\'niz ATS açısından güçlü görünüyor.' : ats >= 60 ? 'CV\'niz iyi bir temel üzerinde ama geliştirilmeli.' : 'CV\'niz ATS filtrelerine takılma riski taşıyor.',
    summary: `Demo modu: Bu sonuç kural tabanlı hızlı bir kontroldür (${words} kelime, ${bulletLines.length} madde, ${metricCount} sayısal sonuç). Yapay zekâ ile derinlemesine analiz, cümle bazında yeniden yazım önerileri ve ilana özel CV oluşturmak için .env dosyasına API anahtarı ekleyin.`,
    score_breakdown: breakdown,
    strengths,
    issues: issues.slice(0, 10),
    found_keywords: found.map((k) => k.keyword).slice(0, 25),
    missing_keywords: missing.slice(0, 15).map((k, i) => ({
      keyword: k.keyword,
      importance: i < 4 ? 'yuksek' : i < 9 ? 'orta' : 'dusuk',
      where_to_add: 'Yetenekler veya ilgili deneyim maddeleri',
    })),
    rewrites: [],
    profile: { name: nameGuess, title: '', seniority: '', years_experience: '', top_skills: found.slice(0, 6).map((k) => k.keyword) },
    job: { title: '', company: '' },
  };
}
