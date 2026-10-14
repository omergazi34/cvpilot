// Claude (Anthropic API) integration: CV analysis, job-specific CV rewriting, cover letters,
// job matching and text extraction from scanned CVs.
import Anthropic from '@anthropic-ai/sdk';
import { UserError } from './errors.js';

export const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.AI_EFFORT || 'medium';

// Server-side refusal fallback is only enabled for models that support it.
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);
const USE_FALLBACKS = FALLBACK_MODELS.has(MODEL) && process.env.AI_FALLBACKS !== 'off';

let client;
const getClient = () => (client ??= new Anthropic());

export function isConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

// ---------- JSON schema helpers (structured outputs) ----------
const STR = { type: 'string' };
const INT = { type: 'integer' };
const arr = (items) => ({ type: 'array', items });
const oneOf = (...values) => ({ type: 'string', enum: values });
const obj = (properties) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const JOB_REF = obj({ title: STR, company: STR });

const ANALYSIS_SCHEMA = obj({
  ats_score: INT,
  verdict: STR,
  summary: STR,
  score_breakdown: obj({
    keyword_match: INT,
    formatting: INT,
    structure: INT,
    impact: INT,
    readability: INT,
  }),
  strengths: arr(STR),
  issues: arr(obj({
    severity: oneOf('kritik', 'orta', 'dusuk'),
    category: STR,
    title: STR,
    detail: STR,
    fix: STR,
  })),
  found_keywords: arr(STR),
  missing_keywords: arr(obj({
    keyword: STR,
    importance: oneOf('yuksek', 'orta', 'dusuk'),
    where_to_add: STR,
  })),
  rewrites: arr(obj({ section: STR, original: STR, improved: STR, reason: STR })),
  profile: obj({
    name: STR,
    title: STR,
    seniority: STR,
    years_experience: STR,
    top_skills: arr(STR),
  }),
  job: JOB_REF,
});

const CV_SCHEMA = obj({
  language: oneOf('tr', 'en', 'other'),
  name: STR,
  headline: STR,
  email: STR,
  phone: STR,
  location: STR,
  links: arr(STR),
  summary: STR,
  skills: arr(obj({ group: STR, items: arr(STR) })),
  experience: arr(obj({
    role: STR,
    company: STR,
    location: STR,
    start: STR,
    end: STR,
    bullets: arr(STR),
  })),
  education: arr(obj({
    degree: STR,
    school: STR,
    location: STR,
    start: STR,
    end: STR,
    details: STR,
  })),
  projects: arr(obj({ name: STR, description: STR, tech: arr(STR) })),
  certifications: arr(STR),
  languages: arr(STR),
  extras: arr(obj({ heading: STR, items: arr(STR) })),
});

const OPTIMIZE_SCHEMA = obj({
  cv: CV_SCHEMA,
  changes: arr(obj({ area: STR, description: STR })),
  placeholders: arr(obj({ placeholder: STR, hint: STR })),
  score_before: INT,
  score_after: INT,
  job: JOB_REF,
});

const MATCH_SCHEMA = obj({
  profile_summary: STR,
  suggested_roles: arr(obj({
    title: STR,
    fit_score: INT,
    why: STR,
    search_query: STR,
    keywords: arr(STR),
  })),
  scored_jobs: arr(obj({
    index: INT,
    title: STR,
    company: STR,
    score: INT,
    verdict: oneOf('cok_uygun', 'uygun', 'kismen', 'uygun_degil'),
    reasons: arr(STR),
    gaps: arr(STR),
  })),
});

// ---------- Shared runner ----------
function toUserError(err) {
  if (err instanceof UserError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new UserError('İstek iptal edildi.', 499);
  if (err instanceof Anthropic.AuthenticationError)
    return new UserError('API anahtarı geçersiz. .env dosyasındaki ANTHROPIC_API_KEY değerini kontrol edin.', 401);
  if (err instanceof Anthropic.PermissionDeniedError)
    return new UserError('API anahtarınızın bu modele erişim izni yok. CLAUDE_MODEL ayarını kontrol edin.', 403);
  if (err instanceof Anthropic.NotFoundError)
    return new UserError(`Model bulunamadı: ${MODEL}. CLAUDE_MODEL ayarını kontrol edin.`, 404);
  if (err instanceof Anthropic.RateLimitError)
    return new UserError('Çok fazla istek gönderildi. Birkaç saniye bekleyip tekrar deneyin.', 429);
  if (err instanceof Anthropic.BadRequestError)
    return new UserError(`Yapay zekâ isteği reddetti: ${err.message}`, 400);
  if (err instanceof Anthropic.APIConnectionError)
    return new UserError('Yapay zekâ servisine bağlanılamadı. İnternet bağlantınızı kontrol edin.', 503);
  if (err instanceof Anthropic.APIError)
    return new UserError(`Yapay zekâ servisi geçici olarak yanıt vermiyor (${err.status ?? 'bağlantı'}). Tekrar deneyin.`, 502);
  return err;
}

/**
 * Sends a streaming request to Claude.
 * onText is called with every generated text delta (progress indicator / live typing).
 */
async function run({ system, content, schema, maxTokens = 16000, effort = EFFORT, onText, signal }) {
  if (!isConfigured()) {
    throw new UserError('Yapay zekâ için API anahtarı gerekli. .env dosyasına ANTHROPIC_API_KEY ekleyip sunucuyu yeniden başlatın.', 503);
  }

  const params = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: {
      effort,
      ...(schema && { format: { type: 'json_schema', schema } }),
    },
  };

  const stream = USE_FALLBACKS
    ? getClient().beta.messages.stream(
        { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
        { signal },
      )
    : getClient().messages.stream(params, { signal });

  if (onText) stream.on('text', (delta) => onText(delta));

  let message;
  try {
    message = await stream.finalMessage();
  } catch (err) {
    throw toUserError(err);
  }

  if (message.stop_reason === 'refusal') {
    throw new UserError('Yapay zekâ bu içeriği işleyemedi (güvenlik filtresi). Metni kontrol edip tekrar deneyin.', 422);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new UserError('Yanıt uzunluk sınırına ulaştı. Daha kısa bir metinle tekrar deneyin.', 502);
  }

  // If a fallback model took over, keep only the text produced after the last switch.
  const blocks = message.content;
  const lastSwitch = blocks.findLastIndex((b) => b.type === 'fallback');
  const text = blocks
    .slice(lastSwitch + 1)
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  if (!schema) return text.trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new UserError('Yapay zekâ yanıtı okunamadı. Lütfen tekrar deneyin.', 502);
  }
}

const langInstruction = (language, fallback) => {
  if (language === 'tr') return 'Turkish';
  if (language === 'en') return 'English';
  return fallback;
};

const wrapNotes = (notes) =>
  notes?.length ? `\n<file_notes>\n${notes.map((n) => `- ${n}`).join('\n')}\n</file_notes>\n` : '';

// ---------- 1) ATS analysis ----------
const ANALYZE_SYSTEM = `You are CVPilot, a senior recruiter and ATS (applicant tracking system) expert. You audit CVs the way modern ATS parsers and experienced recruiters read them, and you give candid, specific, actionable feedback.

Write every piece of commentary (verdict, summary, strengths, issues, fixes, reasons, where_to_add, category, profile.seniority) in Turkish. Quote "original" text verbatim from the CV, and write "improved" versions in the CV's own language.

Never invent employers, titles, dates, degrees, skills or numbers. When a stronger sentence needs a metric the CV does not contain, insert a bracketed placeholder such as [%X], [N kişi] or [X TL] for the candidate to fill in.`;

export async function analyzeCv({ cvText, jobText, notes, signal, onText }) {
  const jobBlock = jobText
    ? `<job_posting>\n${jobText}\n</job_posting>`
    : `<job_posting>(none provided)</job_posting>\nNo job posting was provided: infer the candidate's most likely target role from the CV and evaluate against the typical requirements and keywords of that role in today's market.`;

  const content = `<cv>
${cvText}
</cv>
${jobBlock}
${wrapNotes(notes)}
Audit this CV for ATS compatibility${jobText ? ' and fit for the job posting' : ''}.

Scoring guidance (integers 0-100):
- ats_score: overall chance of passing ATS filters and a recruiter's first screen. Calibrate honestly: 85+ only if it is ready to submit as is; 60-84 decent but needs work; below 60 likely to be filtered out.
- score_breakdown.keyword_match: coverage of the posting's (or target role's) hard skills, tools, certifications and title terms, allowing for synonyms and abbreviations.
- score_breakdown.formatting: parseability - single column, standard section headings, no tables/text boxes/graphics/icons, contact details in the body, consistent readable dates. Use the file notes if present.
- score_breakdown.structure: standard sections in a logical order, reverse-chronological experience, consistent formatting of roles.
- score_breakdown.impact: action verbs, ownership and quantified results.
- score_breakdown.readability: concise, appropriate length, clear language, no typos.

Content guidance:
- verdict: one punchy sentence. summary: 2-4 sentences.
- strengths: 3-6 items.
- issues: 4-10 items ordered by severity, each with a concrete fix the candidate can apply.
- found_keywords: up to 25 relevant keywords already present.
- missing_keywords: up to 15 important missing keywords, most important first; where_to_add names the section to add it to (only suggest adding a keyword if the candidate could plausibly have it - mention that it must be true).
- rewrites: the 3-6 weakest sentences or bullets, with improved versions.
- profile: inferred from the CV; use "" when unknown.
- job: title and company from the posting; "" when not available.`;

  return run({ system: ANALYZE_SYSTEM, content, schema: ANALYSIS_SCHEMA, signal, onText });
}

// ---------- 2) Job-specific / general CV rewrite ----------
const OPTIMIZE_SYSTEM = `You are CVPilot, an expert CV writer and ATS specialist. You rewrite CVs so that they parse cleanly in applicant tracking systems and read compellingly to recruiters, tailoring them to a specific job posting when one is given.

Hard rules:
- Keep every fact truthful: employers, job titles, dates, degrees, schools and certifications come only from the original CV. You may reorder, rephrase, condense, merge or drop content, and move content between sections.
- Do not add skills, tools or achievements the CV gives no evidence of. If the posting asks for something the CV does not show, mention it in "changes" as a gap the candidate should address instead of adding it.
- Where the CV supports a keyword, mirror the posting's exact wording (e.g. "JS" -> "JavaScript" if the posting says JavaScript).
- When a bullet would be stronger with a number the CV does not provide, insert a bracketed placeholder like [%X] or [N] and list it in "placeholders".
- Plain text only inside fields: no markdown, no emojis, no decorative symbols.

Write "changes" and "placeholders[].hint" in Turkish.`;

export async function optimizeCv({ cvText, jobText, language, instructions, signal, onText }) {
  const outLang = langInstruction(language, 'the same language as the original CV');
  const content = `<cv>
${cvText}
</cv>
${jobText ? `<job_posting>\n${jobText}\n</job_posting>` : '<job_posting>(none provided - do a general ATS optimization for the candidate\'s apparent target role)</job_posting>'}
${instructions ? `<candidate_instructions>\n${instructions}\n</candidate_instructions>\n` : ''}
Rewrite this CV${jobText ? ' tailored to the job posting' : ' for maximum ATS compatibility'}.

Output requirements:
- Write the CV in ${outLang}; set cv.language accordingly ("tr", "en" or "other").
- summary: 2-4 sentences positioning the candidate for ${jobText ? 'this role' : 'their target role'}.
- skills: grouped into 2-5 groups (e.g. languages, frameworks, tools, methods), most relevant first.
- experience: reverse-chronological; 3-6 bullets for recent roles, 1-3 for older ones; each bullet starts with a strong action verb and shows impact, max ~2 lines.
- Keep dates consistent in one format (e.g. "03/2021" and "Günümüz"/"Present").
- Use empty arrays for sections the candidate does not have and "" for unknown fields.
- changes: 5-12 items explaining what you changed and why (area = the CV section).
- score_before / score_after: your estimated ATS match score (0-100) for the original and the rewritten CV${jobText ? ' against this posting' : ''}.
- job: title and company from the posting ("" if none).`;

  return run({ system: OPTIMIZE_SYSTEM, content, schema: OPTIMIZE_SCHEMA, maxTokens: 20000, signal, onText });
}

// ---------- 3) Cover letter ----------
const TONES = {
  otomatik: "match the tone of the job posting (e.g. warm and energetic for a startup, polished and formal for a corporate or public institution)",
  profesyonel: 'professional, confident and clear',
  samimi: 'warm, friendly and personable while still professional',
  heyecanli: 'enthusiastic and energetic, showing genuine excitement about the role',
  resmi: 'formal and respectful, suitable for corporate or public-sector employers',
  yaratici: 'creative and memorable, with a distinctive opening, still professional',
};
const LENGTHS = { kisa: '150-200', orta: '230-300', uzun: '320-400' };

const LETTER_SYSTEM = `You are CVPilot, an expert career writer who crafts tailored cover letters that get interviews.

Rules:
- Use only facts found in the CV. Never invent achievements, numbers, employers or skills. If a metric is missing, describe the achievement qualitatively - do not use placeholders.
- Connect 2-3 of the candidate's most relevant achievements to the posting's top requirements. Do not just restate the CV.
- Avoid clichés and generic openings (such as "I am writing to apply for..." or "Bu pozisyona başvurmak için yazıyorum").
- Output only the letter itself as plain text: greeting, paragraphs separated by a blank line, closing and the candidate's name. No subject line, no markdown, no commentary before or after.`;

export async function writeCoverLetter({ cvText, jobText, tone, length, language, company, manager, extra, signal, onText }) {
  const outLang = langInstruction(language, 'the same language as the job posting');
  const content = `<cv>
${cvText}
</cv>
<job_posting>
${jobText}
</job_posting>
${company ? `<company>${company}</company>\n` : ''}${manager ? `<hiring_manager>${manager}</hiring_manager>\n` : ''}${extra ? `<candidate_notes>\n${extra}\n</candidate_notes>\n` : ''}
Write a cover letter for this candidate and job.
- Language: ${outLang}.
- Tone: ${TONES[tone] ?? TONES.otomatik}.
- Length: ${LENGTHS[length] ?? LENGTHS.orta} words.
- Greeting: ${manager ? `address ${manager} by name` : 'address the hiring team (e.g. "Sayın İşe Alım Ekibi," or "Dear Hiring Team,")'}.`;

  return run({ system: LETTER_SYSTEM, content, maxTokens: 6000, signal, onText });
}

// ---------- 4) AI job matching ----------
const MATCH_SYSTEM = `You are CVPilot's job-matching engine. You compare a candidate's CV and preferences with job opportunities and score fit the way an experienced recruiter would: required skills and experience level weigh most, then nice-to-haves, domain, location and work-type fit. Be honest - a weak match must get a low score. Write all commentary in Turkish.`;

export async function matchJobs({ cvText, preferences, jobs, signal, onText }) {
  const prefs = Object.entries(preferences || {})
    .filter(([, v]) => (Array.isArray(v) ? v.length : v))
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .join('\n');
  const jobsBlock = jobs.length
    ? jobs.map((j, i) => `<job index="${i + 1}">\n${j}\n</job>`).join('\n')
    : '(no postings provided)';

  const content = `<cv>
${cvText}
</cv>
<preferences>
${prefs || '(none provided)'}
</preferences>
<jobs>
${jobsBlock}
</jobs>

Tasks:
1. profile_summary: 2-3 sentences on the candidate's profile and strongest selling points.
2. suggested_roles: 4-6 job titles the candidate is a strong fit for given the CV and preferences, ordered by fit_score (0-100). search_query is a short job-board search query (a job title plus at most one key skill) in the language most used in the candidate's target location. keywords: 3-6 skills to emphasise for that role.
3. scored_jobs: one entry per provided job, using its index; empty array when no jobs were provided. score 0-100; verdict: cok_uygun (80+), uygun (65-79), kismen (45-64), uygun_degil (<45). reasons: 2-4 matching points; gaps: 0-4 missing requirements. Use "" for unknown title/company.`;

  return run({ system: MATCH_SYSTEM, content, schema: MATCH_SCHEMA, signal, onText });
}

// ---------- 5) Text extraction from scanned PDFs / images ----------
export async function transcribeDocument({ mediaType, data }) {
  const block =
    mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: mediaType, data } }
      : { type: 'image', source: { type: 'base64', media_type: mediaType, data } };

  return run({
    system: 'You transcribe documents accurately.',
    content: [
      block,
      {
        type: 'text',
        text: 'Transcribe all text in this CV exactly as written, in natural reading order. Keep section headings on their own lines and write bullet points as "- ". Output only the transcribed text.',
      },
    ],
    maxTokens: 8000,
    effort: 'low',
  });
}
