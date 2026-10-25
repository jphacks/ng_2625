/** build-data.mjs と evaluate.mjs で共通に使う部品 */
import {readFile} from "node:fs/promises";
import {TeamModel} from "../public/bert.js";

export const MODEL_ID = "misconception_model";        // メンバーが学習させたチームのモデル
export const DTYPE = "f16";                           // 重みは半精度（元の重みとのずれはコサインで 0.999999 以上）
export const DIM = 384;
export const PACKED = "public/data/models/team";       // npm run pack-model の書き出し先

export function parseCsv(text){
  const rows = []; let row = [], cell = "", q = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(q){ if(ch === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; }
    else if(ch === '"') q = true;
    else if(ch === ","){ row.push(cell); cell = ""; }
    else if(ch === "\n" || ch === "\r"){ if(ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if(cell || row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== "");
}

export async function readCsv(path, hint){
  const text = await readFile(path, "utf8").catch(() => { console.error(`${path} が見つかりません。${hint}`); process.exit(1); });
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const head = rows[0].map(s => s.trim());
  return {head, rows: rows.slice(1), col: name => head.indexOf(name)};
}

// 誤概念の一覧（メンバーの script.py と同じく、名前が空の行は除く）
export async function readMisconceptions(path){
  const map = await readCsv(path, "Kaggle の misconception_mapping.csv を data/ に置いてください。");
  const iId = map.col("MisconceptionId"), iName = map.col("MisconceptionName");
  if(iId < 0 || iName < 0){ console.error("MisconceptionId と MisconceptionName の列が見つかりません。"); process.exit(1); }
  return map.rows.map(r => ({id: Number(r[iId]), name: (r[iName] || "").trim()})).filter(m => Number.isFinite(m.id) && m.name);
}

// 画面（public/index.html）の latexToPlain と同じ規則で、LaTeX を読みやすい形に直す
export function latexToPlain(s){
  s = String(s || "").replace(/\\\(|\\\)|\\\[|\\\]|\$/g, "").replace(/\\left|\\right/g, "");
  for(let i = 0; i < 3; i++) s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
  s = s.replace(/\((-?\w+)\)\/\((-?\w+)\)/g, "$1/$2").replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
       .replace(/\\times|\\cdot/g, "×").replace(/\\div/g, "÷").replace(/\^\{([^{}]*)\}/g, "^$1")
       .replace(/\\text\s*\{([^{}]*)\}/g, "$1").replace(/[{}]/g, "");
  return s.replace(/\s+/g, " ").trim();
}

// チームのモデルを読み込む（npm run pack-model で作ったファイル。ブラウザと同じ public/bert.js で計算する）
export async function loadTeamModel(dir = PACKED){
  const manifest = JSON.parse(await readFile(`${dir}/manifest.json`, "utf8").catch(() => {
    console.error(`${dir}/manifest.json がありません。先に npm run pack-model を実行してください（メンバーの misconception_model を model/ に置いてから）。`);
    process.exit(1);
  }));
  const chunks = await Promise.all(manifest.chunks.map(f => readFile(`${dir}/${f}`)));
  return new TeamModel(manifest, chunks, await readFile(`${dir}/tokenizer.json`, "utf8"));
}

// 文の配列 → ベクトル（件数 × 384）
export async function embedAll(model, texts, label = ""){
  const out = new Float32Array(texts.length * DIM), t0 = Date.now();
  for(let i = 0; i < texts.length; i++){
    out.set(await model.embed(texts[i]), i * DIM);
    if(label && (i % 20 === 19 || i === texts.length - 1)){
      const sec = (Date.now() - t0) / 1000, rest = sec / (i + 1) * (texts.length - i - 1);
      process.stdout.write(`\r${label} ${i + 1} / ${texts.length}（残り約 ${Math.ceil(rest)} 秒）   `);
    }
  }
  if(label) process.stdout.write("\n");
  return out;
}

// 日本の単元 → Eedi の単元 の対応表から、train.csv の各問題の単元を引く表を作る
export function unitBySubject(units){
  return new Map(Object.entries(units).flatMap(([unit, subs]) => subs.map(s => [s, unit])));
}
