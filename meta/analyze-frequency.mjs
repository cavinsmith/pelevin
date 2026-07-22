/**
 * Частотный анализ ключевых слов в романах Пелевина.
 * Запуск: node wiki/meta/analyze-frequency.mjs
 *
 * Обрабатывает FB2-файлы в разных кодировках (UTF-8 и windows-1251).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

// ---- Custom parseFB2 with encoding support ----

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  ignoreNameSpaces: true,
  textNodeName: "#text",
});

function extractText(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node["#text"] != null) {
    const inner = extractTextChildren(node);
    return (node["#text"] + inner).trim();
  }
  return extractTextChildren(node);
}

function extractTextChildren(node) {
  if (typeof node !== "object" || node == null) return "";
  let result = "";
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith("@_")) continue;
    if (key === "#text") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        result += " " + extractText(item);
      }
    } else {
      result += " " + extractText(value);
    }
  }
  return result.trim();
}

function extractSections(body) {
  if (!body) return [];
  const sections = [];
  const rawSections = Array.isArray(body.section) ? body.section : body.section ? [body.section] : [];

  for (const section of rawSections) {
    const sectionObj = {};
    if (section.title) sectionObj.title = extractText(section.title);

    const paragraphs = [];
    const rawParagraphs = Array.isArray(section.p) ? section.p : section.p ? [section.p] : [];
    for (const p of rawParagraphs) {
      const text = extractText(p);
      if (text) paragraphs.push(text);
    }

    const epigraphs = [];
    const rawEpigraphs = Array.isArray(section.epigraph) ? section.epigraph : section.epigraph ? [section.epigraph] : [];
    for (const ep of rawEpigraphs) epigraphs.push(extractText(ep));

    const poems = [];
    const rawPoems = Array.isArray(section.poem) ? section.poem : section.poem ? [section.poem] : [];
    for (const poem of rawPoems) poems.push(extractText(poem));

    sectionObj.paragraphs = paragraphs;
    sectionObj.epigraphs = epigraphs;
    sectionObj.poems = poems;

    const nested = extractSections(section);
    if (nested.length > 0) sectionObj.children = nested;
    sections.push(sectionObj);
  }
  return sections;
}

function flattenSections(sections) {
  const lines = [];
  for (const section of sections) {
    if (section.title) { lines.push(""); lines.push(`## ${section.title}`); lines.push(""); }
    for (const ep of section.epigraphs || []) { lines.push(`*${ep}`); lines.push(""); }
    for (const p of section.paragraphs || []) { lines.push(p); lines.push(""); }
    for (const poem of section.poems || []) { lines.push(poem); lines.push(""); }
    if (section.children) lines.push(...flattenSections(section.children));
  }
  return lines;
}

function parseFB2Auto(filePath) {
  const buf = readFileSync(filePath);

  // Detect encoding from XML declaration
  const headSlice = buf.slice(0, 300).toString('ascii');
  const encMatch = headSlice.match(/encoding="([^"]+)"/i);
  const encoding = encMatch ? encMatch[1].toLowerCase() : 'utf-8';

  // Decode with correct encoding
  const decoder = new TextDecoder(encoding);
  const raw = decoder.decode(buf);

  const doc = xmlParser.parse(raw);
  const root = doc["FictionBook"] || doc;

  const desc = root["description"] || {};
  const titleInfo = desc["title-info"] || {};
  const authorRaw = titleInfo["author"] || {};
  const meta = {
    title: extractText(titleInfo["book-title"]),
    author: [authorRaw["last-name"] || "", authorRaw["first-name"] || "", authorRaw["middle-name"] || ""].filter(Boolean).join(" "),
  };

  const rawBodies = Array.isArray(root["body"]) ? root["body"] : root["body"] ? [root["body"]] : [];
  const allSections = [];
  for (const body of rawBodies) allSections.push(...extractSections(body));
  const text = flattenSections(allSections).join("\n").trim();

  return { meta, text, encoding };
}

// ---- Analysis ----

const BOOKS = [
  { short: 'Омон Ра',         file: 'books/Романы/1992 Омон Ра.fb2', year: 1992 },
  { short: 'Чапаев',          file: 'books/Романы/1996 Чапаев и Пустота.fb2', year: 1996 },
  { short: 'Generation П',    file: 'books/Романы/1999 Generation П .fb2', year: 1999 },
  { short: 'Empire V',        file: 'books/Романы/2006 Empire V (Ампир В).fb2', year: 2006 },
  { short: 't',               file: 'books/Романы/2009 t.fb2', year: 2009 },
  { short: 'iPhuck',          file: 'books/Романы/2017 iPhuck 10.fb2', year: 2017 },
  { short: 'КГБТ+',           file: 'books/Романы/2022 КГБТ+.fb2', year: 2022 },
];

const KEYWORDS = [
  'пустота', 'сознание', 'реальность', 'свобода', 'смерть',
  'бог', 'истина', 'язык', 'власть',
];

// Extended stop words
const STOP_WORDS = new Set([
  'и', 'в', 'не', 'на', 'я', 'что', 'с', 'он', 'а', 'то', 'все', 'она',
  'так', 'его', 'но', 'да', 'ты', 'к', 'у', 'же', 'вы', 'за', 'бы',
  'по', 'от', 'меня', 'ещё', 'нет', 'о', 'из', 'ему', 'теперь',
  'когда', 'даже', 'ну', 'вот', 'нибудь', 'или', 'ни', 'быть',
  'был', 'него', 'до', 'вас', 'опять', 'уж', 'вам',
  'ведь', 'там', 'потом', 'себя', 'ничего', 'ей', 'может', 'они',
  'тут', 'где', 'есть', 'надо', 'ней', 'для', 'мы', 'тебя', 'их',
  'чем', 'была', 'чтоб', 'без', 'будто', 'чего', 'раз',
  'тоже', 'себе', 'под', 'будет', 'ж', 'тогда', 'кто', 'этот',
  'того', 'потому', 'этого', 'совсем', 'ним', 'здесь',
  'этом', 'один', 'почти', 'тем', 'чтобы', 'нее', 'сейчас',
  'были', 'куда', 'зачем', 'всех', 'никогда', 'можно', 'при',
  'наконец', 'два', 'об', 'другой', 'хоть', 'после', 'над', 'больше',
  'тот', 'через', 'эти', 'нас', 'про', 'всего', 'них',
  'много', 'разве', 'три', 'эту', 'моя', 'впрочем', 'хорошо',
  'свою', 'этой', 'перед', 'иногда', 'лучше', 'чуть', 'том',
  'нельзя', 'им', 'более', 'всегда', 'уже', 'конечно',
  'всю', 'между', 'это', 'день', 'еще', 'тебе',
  'всё', 'той', 'этим', 'ее',
  'нём', 'мне', 'было', 'стоит', 'ваша', 'ваш',
  'которые', 'который', 'которая', 'которое',
  'такие', 'которых', 'которому', 'которой', 'которого',
  'моей', 'моего', 'мои', 'моих', 'мою',
  'твой', 'твоей', 'твоего', 'твои', 'твоих', 'твою',
  'вашей', 'вашего', 'ваши', 'ваших', 'вашу',
  'наш', 'нашей', 'нашего', 'наши', 'наших', 'нашу',
  'свой', 'своей', 'своего', 'свои', 'своих',
  'чьи', 'чьё', 'чьего', 'чьей', 'чьих', 'чьим',
  'вся', 'всем', 'всеми', 'всему',
  'каждый', 'каждая', 'каждое', 'каждого', 'каждой', 'каждому',
  'ваше', 'наше', 'свое',
  'какая', 'какое', 'какого', 'какому',
  'такая', 'такое', 'такого', 'такому',
  'какие', 'каких', 'каким', 'какими',
  'таких', 'таким', 'такими',
  'чей', 'чья',
  'сам', 'сама', 'само', 'самого', 'самой', 'самому',
  'сами', 'самих', 'самим', 'самими',
  'каков', 'какова', 'каково', 'каковы',
  'таков', 'такова', 'таково', 'таковы',
  'некого', 'нечего', 'некому', 'нечему', 'некем', 'нечем',
  'этим', 'этой', 'этого', 'этих', 'этому', 'этим',
]);

function normalizeWord(word) {
  return word.toLowerCase().replace(/[^а-яёa-z0-9]/g, '');
}

function extractWords(text) {
  return text.split(/[\s\n\r\t,;.!?—–\-«»""'()\[\]{}:\/\\…\d]+/)
    .map(w => normalizeWord(w))
    .filter(w => w.length >= 2);
}

function countWords(words) {
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  return freq;
}

function getTopWords(freq, n, stopWords) {
  return [...freq.entries()]
    .filter(([w]) => !stopWords.has(w) && w.length >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function keywordFreq(freq, keyword, totalWords) {
  const count = freq.get(keyword) || 0;
  return { count, per10k: (count / totalWords * 10000).toFixed(1) };
}

// ---- MAIN ----

console.log('Начинаю анализ...\n');

const results = [];

for (const book of BOOKS) {
  console.log(`Читаю: ${book.short} (${book.year})...`);
  const { meta, text, encoding } = parseFB2Auto(join('/Users/cavin/Documents/pelevin', book.file));
  console.log(`  Кодировка: ${encoding}, текст: ${text.length} символов`);
  const words = extractWords(text);
  const totalWords = words.length;
  const freq = countWords(words);
  const top100 = getTopWords(freq, 100, STOP_WORDS);

  const kwFreqs = {};
  for (const kw of KEYWORDS) {
    kwFreqs[kw] = keywordFreq(freq, kw, totalWords);
  }

  results.push({
    short: book.short,
    year: book.year,
    title: meta.title,
    totalWords,
    totalUnique: freq.size,
    top100,
    kwFreqs,
  });

  console.log(`  Всего слов: ${totalWords.toLocaleString()}, уникальных: ${freq.size.toLocaleString()}`);
}

// ---- BUILD MARKDOWN ----

let md = '';
md += `# Частотный анализ ключевых слов в романах Виктора Пелевина\n\n`;
md += `> Дата анализа: ${new Date().toISOString().slice(0, 10)}\n\n`;

// Summary table
md += `## Общая статистика\n\n`;
md += `| Роман | Год | Всего слов | Уникальных |\n`;
md += `|-------|-----|-----------|------------|\n`;
for (const r of results) {
  md += `| ${r.short} | ${r.year} | ${r.totalWords.toLocaleString()} | ${r.totalUnique.toLocaleString()} |\n`;
}

md += `\n---\n\n`;

// ---- KEYWORD FREQUENCY TABLE (per 10k words) ----
md += `## Частота ключевых слов (на 10 000 слов)\n\n`;
md += `> Формат: \`абсолютое_число (частота_на_10к)\`\n\n`;
const shortNames = results.map(r => r.short);
md += `| Слово | ${shortNames.join(' | ')} |\n`;
md += `|-------|${shortNames.map(() => '-------').join('|')}|\n`;

for (const kw of KEYWORDS) {
  const vals = results.map(r => {
    const f = r.kwFreqs[kw];
    return `${f.count} (${f.per10k})`;
  });
  md += `| **${kw}** | ${vals.join(' | ')} |\n`;
}

md += `\n---\n\n`;

// ---- ABSOLUTE KEYWORD COUNTS ----
md += `## Абсолютное количество употреблений ключевых слов\n\n`;
md += `| Слово | ${shortNames.join(' | ')} |\n`;
md += `|-------|${shortNames.map(() => '-------').join('|')}|\n`;

for (const kw of KEYWORDS) {
  const vals = results.map(r => String(r.kwFreqs[kw].count));
  md += `| **${kw}** | ${vals.join(' | ')} |\n`;
}

md += `\n---\n\n`;

// ---- TOP 30 for each book ----
md += `## Топ-30 слов по частоте (без стоп-слов)\n\n`;

for (const r of results) {
  md += `### ${r.short} (${r.year})\n\n`;
  md += `| # | Слово | Кол-во | На 10 000 слов |\n`;
  md += `|---|-------|--------|----------------|\n`;
  for (let i = 0; i < Math.min(30, r.top100.length); i++) {
    const [word, count] = r.top100[i];
    const per10k = (count / r.totalWords * 10000).toFixed(1);
    md += `| ${i + 1} | ${word} | ${count.toLocaleString()} | ${per10k} |\n`;
  }
  md += `\n`;
}

md += `---\n\n`;

// ---- EVOLUTION ANALYSIS ----
md += `## Эволюция частоты ключевых слов\n\n`;

for (const kw of KEYWORDS) {
  md += `### «${kw}»\n\n`;
  md += `| Год | Роман | Кол-во | На 10 000 слов |\n`;
  md += `|-----|-------|--------|----------------|\n`;
  for (const r of results) {
    const f = r.kwFreqs[kw];
    md += `| ${r.year} | ${r.short} | ${f.count} | ${f.per10k} |\n`;
  }
  md += `\n`;
}

md += `---\n\n`;

// ---- TREND NOTES ----
md += `## Наблюдения по тенденциям\n\n`;

for (const kw of KEYWORDS) {
  let maxBook = '', maxVal = 0, minBook = '', minVal = Infinity;
  for (const r of results) {
    const v = parseFloat(r.kwFreqs[kw].per10k);
    if (v > maxVal) { maxVal = v; maxBook = `${r.short} (${r.year})`; }
    if (v < minVal && v > 0) { minVal = v; minBook = `${r.short} (${r.year})`; }
  }
  if (minVal === Infinity) minVal = 0;
  md += `- **«${kw}»**: пик — ${maxBook} (${maxVal} на 10 000 слов), минимум — ${minBook} (${minVal})\n`;
}

md += `\n---\n\n`;
md += `*Анализ проведён автоматически с помощью Node.js, \`fast-xml-parser\` и библиотеки \`parseFB2\`.*\n`;

// Write output
const outPath = join('/Users/cavin/Documents/pelevin', 'wiki/meta/word-frequency.md');
writeFileSync(outPath, md, 'utf-8');
console.log(`\nГотово! Результат записан в: ${outPath}`);
console.log(`Размер файла: ${(Buffer.byteLength(md) / 1024).toFixed(1)} КБ`);
