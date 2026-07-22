#!/usr/bin/env node
/**
 * Скрипт для построения таймлайна публикаций Пелевина
 * из fb2-файлов.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { TextDecoder } from "node:util";

const BOOKS_DIR = "/Users/cavin/Documents/pelevin/books";

/**
 * Читает fb2-файл, определяя кодировку из XML-декларации,
 * и возвращает строку в UTF-8.
 */
function readFB2WithEncoding(filePath) {
  const raw = readFileSync(filePath);
  // Ищем encoding="..." в первых 200 байтах
  const head = raw.slice(0, 200).toString("ascii");
  const m = head.match(/encoding="([^"]+)"/i);
  let encoding = "utf-8";
  if (m) {
    const enc = m[1].toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (enc && enc !== "utf-8" && enc !== "utf8") {
      encoding = enc;
    }
  }
  return new TextDecoder(encoding).decode(raw);
}

/**
 * Парсит FB2 вручную (без зависимости от parseFB2),
 * чтобы работать с нужной кодировкой.
 */
import { XMLParser } from "fast-xml-parser";

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

function parseFB2Local(filePath) {
  const raw = readFB2WithEncoding(filePath);
  const doc = xmlParser.parse(raw);
  const root = doc["FictionBook"] || doc;

  const desc = root["description"] || {};
  const titleInfo = desc["title-info"] || {};

  const authorRaw = titleInfo["author"] || {};
  const author = {
    firstName: authorRaw["first-name"] || "",
    lastName: authorRaw["last-name"] || "",
    middleName: authorRaw["middle-name"] || "",
  };

  const genreRaw = titleInfo["genre"];
  let genres;
  if (Array.isArray(genreRaw)) {
    genres = genreRaw.map(g => typeof g === "string" ? g : extractText(g));
  } else if (genreRaw) {
    genres = [typeof genreRaw === "string" ? genreRaw : extractText(genreRaw)];
  } else {
    genres = [];
  }

  const meta = {
    title: extractText(titleInfo["book-title"]),
    author: [author.lastName, author.firstName, author.middleName]
      .filter(Boolean)
      .join(" "),
    genre: genres,
    date: extractText(titleInfo["date"]),
    lang: titleInfo["lang"] || "",
    keywords: titleInfo["keywords"] || "",
  };

  return { meta };
}

function getAllFB2(dir) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllFB2(fullPath));
    } else if (entry.name.endsWith(".fb2")) {
      files.push(fullPath);
    }
  }
  return files;
}

// Категории по папкам
const CATEGORY_MAP = {
  "Романы": "Роман",
  "Повести": "Повесть",
  "Рассказы": "Рассказ",
  "Эссе": "Эссе",
  "Статьи": "Статья",
  "Сборники": "Сборник",
};

function detectCategory(filePath) {
  const rel = filePath.replace(BOOKS_DIR + "/", "");
  const topDir = rel.split("/")[0];
  return CATEGORY_MAP[topDir] || "Произведение";
}

// Извлекаем год из имени файла
function extractYear(filename) {
  const m = filename.match(/^(\d{4})\s/);
  return m ? parseInt(m[1]) : null;
}

// Ключевые особенности (определяем по названию)
function getKeyFeatures(title, text) {
  const features = [];
  const t = title.toLowerCase();
  const excerpt = text ? text.slice(0, 5000).toLowerCase() : "";

  // Темы
  if (t.includes("омон") || t.includes("ра")) features.push("космическая программа, сталинизм");
  if (t.includes("чапаев")) features.push("Чапаев, Пустота, иллюзорность реальности");
  if (t.includes("жизнь насекомых")) features.push("корпоративная культура, метаморфоза");
  if (t.includes("generation") || t.includes("гeneration")) features.push("PR, телевидение, массовая культура");
  if (t.includes("числа")) features.push("математика, абстракция, язык");
  if (t.includes("священная книга оборотня")) features.push("оборотни, язык, вампиризм");
  if (t.includes("шиф")) features.push("империя, язык, трансгуманизм");
  if (t.includes("empire")) features.push("империя, вампиризм, язык");
  if (t.includes("ампир")) features.push("империя, вампиризм, язык");
  if (t.includes("т.б.") || t === "t.fb2" || t === "t") features.push("искусственный интеллект, постчеловек");
  if (t.includes("снфф") || t.includes("snuff")) features.push("дистопия, медиа, война");
  if (t.includes("бэтман") || t.includes("аполло")) features.push("постапокалипсис, мифология, реклама");
  if (t.includes("lampа") || t.includes("мафусаил")) features.push("чекисты, масоны, конспирология");
  if (t.includes("смотритель")) features.push("орден, Тибет, даосизм");
  if (t.includes("iphuck") || t.includes("айфан")) features.push("ИИ, проституция, язык");
  if (t.includes("тайные виды")) features.push("Япония, гора Фудзи, медитация");
  if (t.includes("трансгуманизм") || t.includes("transhuman")) features.push("трансгуманизм, постчеловек");
  if (t.includes("непобедимое солнце")) features.push("Наполеон, солнцепоклонничество");
  if (t.includes("любовь к трем")) features.push("циукербрины, виртуальная реальность");
  if (t.includes("шлем ужаса")) features.push("Тесей, Минотавр, креатифф");
  if (t.includes("кгбт")) features.push("КГБ, трансгуманизм, Россия");
  if (t.includes("затворник")) features.push("шаманизм, шаман");
  if (t.includes("принц")) features.push("Госплан, социализм, миф");
  if (t.includes("желтая стрела")) features.push("поезд, метафора, конец истории");
  if (t.includes("синий фонарь")) features.push("кайф, наркотики, советская культура");
  if (t.includes("колдун")) features.push("первое произведение, фольклор");
  if (t.includes("реконструктор")) features.push("реконструкция, память");
  if (t.includes("оружие возмездия")) features.push("месть, абсурд");
  if (t.includes("ухряб")) features.push("абсурд, бюрократия");
  if (t.includes("девятый сон")) features.push("сон, Чернышевский");
  if (t.includes("хрустальный мир")) features.push("хрустальный мир, фантастика");
  if (t.includes("мардонги")) features.push("абсурд, язык");
  if (t.includes("онтология детства")) features.push("детство, воспоминание");
  if (t.includes("музыка со столба")) features.push("музыка, советская жизнь");
  if (t.includes("спи")) features.push("сон, бессонница");
  if (t.includes("вести из непала")) features.push("Непал, буддизм, шаманизм");
  if (t.includes("миттельшпиль")) features.push("шахматы, стратегия");
  if (t.includes("день бульдозериста")) features.push("бульдозерист, рабочий класс");
  if (t.includes("жизнь и приключения сарая")) features.push("сараи, архитектура");
  if (t.includes("луноход")) features.push("луноход, космос,ERRU");
  if (t.includes("зигмунд")) features.push("Зигмунд, кафе, психоанализ");
  if (t.includes("происхождение видов")) features.push("Дарвин, эволюция");
  if (t.includes("бубен")) features.push("шаманизм, бубен, верхний/нижний мир");
  if (t.includes("иван кублаханов")) features.push("абсурд, фамилия");
  if (t.includes("тарзанка")) features.push("Тарзан, джунгли");
  if (t.includes("папахи на башнях")) features.push("папахи, башни, Кавказ");
  if (t.includes("нижняя тундра")) features.push("тундра, природа");
  if (t.includes("греческий вариант")) features.push("Греция, мифология");
  if (t.includes("водонапорная башня")) features.push("башня, вода");
  if (t.includes("святочный киберпанк")) features.push("киберпанк, Рождество");
  if (t.includes("краткая история пэйнтбола")) features.push("пэйнтбол, Москва");
  if (t.includes("реконструктор")) features.push("реконструкция, история");
  if (t.includes("ника")) features.push("Ника, богиня");
  if (t.includes("time out") || t.includes("тайм-аут")) features.push("Москва, вечер, время");
  if (t.includes("встроенный напоминатель")) features.push("память, технология");
  if (t.includes("македонская критика")) features.push("Македонский, критика");
  if (t.includes("акико")) features.push("Япония, женщина");
  if (t.includes("запись о поиске ветра")) features.push("ветер, поиск");
  if (t.includes("свет горизонта")) features.push("горизонт, насекомые, дополнение");
  if (t.includes("who by fire")) features.push("огонь, выбор");
  if (t.includes("пространство фридмана")) features.push("физика, пространство");
  if (t.includes("кормление крокодила")) features.push("Хуфу, Египет");
  if (t.includes("тхаги")) features.push("абсурд");
  if (t.includes("sssр") || t.includes("тайшоу")) features.push("китайская сказка");
  if (t.includes("гкчп")) features.push("ГКЧП, Тетраграмматон, политика");
  if (t.includes("икстлан")) features.push("Кортес, Петушки, Колумбия");
  if (t.includes("джон фаулз")) features.push("Фаулз, либерализм");
  if (t.includes("имена олигархов")) features.push("олигархи, карта");
  if (t.includes("последняя шутка воина")) features.push("воин, шутка");
  if (t.includes("мой мескалитовый")) features.push("мескалин, трип");
  if (t.includes("мост")) features.push("мост, переход");
  if (t.includes("код мира")) features.push("код, мир, информация");
  if (t.includes("подземное небо")) features.push("подземное небо");
  if (t.includes("зомбификация")) features.push("зомби, советский человек");
  if (t.includes("рунах") || t.includes("рунический")) features.push("руны, оракул");
  if (t.includes("ultima тулеев")) features.push("Тулеев, выборы, дао");
  if (t.includes("ролик")) features.push("PR");
  if (t.includes("реликвии") || t.includes("relics")) features.push("раннее, неизданное");
  if (t.includes("ананасная вода")) features.push("сборник, ранние произведения");
  if (t.includes("искусство легких")) features.push("касания, сборник");
  if (t.includes("диалектика переходного")) features.push("ДПП, ниоткуда в никуда");

  return features.length > 0 ? features.join("; ") : "—";
}

const allFiles = getAllFB2(BOOKS_DIR);

const works = [];

for (const filePath of allFiles) {
  const fn = basename(filePath);
  try {
    const { meta } = parseFB2Local(filePath);
    const year = extractYear(fn) || (meta.date ? parseInt(meta.date) : null);
    const category = detectCategory(filePath);
    works.push({
      year,
      title: meta.title || fn.replace(/\.fb2$/, ""),
      category,
      date: meta.date || "",
      genre: (meta.genre || []).join(", "),
      features: getKeyFeatures(meta.title || fn, ""),
      fn,
    });
  } catch (e) {
    console.error(`Ошибка чтения ${fn}: ${e.message}`);
  }
}

// Сортируем по году
works.sort((a, b) => {
  if (a.year !== b.year) return (a.year || 9999) - (b.year || 9999);
  return a.title.localeCompare(b.title);
});

// Группируем по годам
const byYear = {};
for (const w of works) {
  const y = w.year || "Неизвестно";
  if (!byYear[y]) byYear[y] = [];
  byYear[y].push(w);
}

// Генерируем markdown
let md = `# Таймлайн публикаций Виктора Пелевина

> Автоматически сгенерировано из fb2-файлов коллекции.
> Всего произведений: ${works.length}

---

`;

const years = Object.keys(byYear).sort((a, b) => {
  if (a === "Неизвестно") return 1;
  if (b === "Неизвестно") return -1;
  return parseInt(a) - parseInt(b);
});

let prevYear = null;
for (const year of years) {
  if (prevYear && parseInt(year) - parseInt(prevYear) > 1 && year !== "Неизвестно") {
    // Пропущенные годы
    const skipped = [];
    for (let y = parseInt(prevYear) + 1; y < parseInt(year); y++) {
      skipped.push(y);
    }
    if (skipped.length > 0 && skipped.length <= 3) {
      md += `### (нет публикаций: ${skipped.join(", ")})\n\n`;
    } else if (skipped.length > 3) {
      md += `### (нет публикаций: ${skipped[0]}–${skipped[skipped.length - 1]})\n\n`;
    }
  }

  md += `## ${year}\n\n`;

  for (const w of byYear[year]) {
    md += `### «${w.title}»\n`;
    md += `- **Тип:** ${w.category}\n`;
    if (w.genre) md += `- **Жанр:** ${w.genre}\n`;
    if (w.date && w.date !== String(w.year)) md += `- **Дата в FB2:** ${w.date}\n`;
    md += `- **Особенности:** ${w.features}\n`;
    md += `- **Файл:** \`${w.fn}\`\n`;
    md += `\n`;
  }

  prevYear = year;
}

// Статистика
md += `---\n\n## Статистика\n\n`;

const catCount = {};
for (const w of works) {
  catCount[w.category] = (catCount[w.category] || 0) + 1;
}
md += `### По типам\n\n`;
md += `| Тип | Количество |\n|---|---|\n`;
for (const [cat, count] of Object.entries(catCount).sort((a, b) => b[1] - a[1])) {
  md += `| ${cat} | ${count} |\n`;
}

md += `\n### По десятилетиям\n\n`;
const decadeCount = {};
for (const w of works) {
  if (w.year) {
    const decade = Math.floor(w.year / 10) * 10;
    decadeCount[decade] = (decadeCount[decade] || 0) + 1;
  }
}
md += `| Десятилетие | Количество |\n|---|---|\n`;
for (const [dec, count] of Object.entries(decadeCount).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  md += `| ${dec}–е | ${count} |\n`;
}

console.log(md);

// Записываем файл
writeFileSync("/Users/cavin/Documents/pelevin/wiki/meta/timeline.md", md, "utf-8");
console.log("\n✅ Файл создан: wiki/meta/timeline.md");
