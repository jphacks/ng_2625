/**
 * チームのモデル用のデータを作る（最初に1回だけ実行）。
 *
 *   npm run build-data            … 計算分野の誤概念だけに絞って作る（おすすめ）
 *   npm run build-data -- --all   … 絞り込まずに、2,587 件すべてで作る
 *
 * 1. data/misconception_mapping.csv から誤概念を読む
 * 2. data/train.csv で、各誤概念がどの単元の問題に出てくるかを調べ、
 *    scripts/subjects.mjs の「中学の計算分野＋小学校の計算」に出てくるものだけを残す
 *    （関数・図形・統計や、日本では高校で習う内容の誤概念が候補に紛れ込まないようにする）
 * 3. チームのモデル（メンバーが学習させた misconception_model）でベクトルにして、
 *      public/data/misconceptions.json  … ID・誤概念名・日本の単元名
 *      public/data/mis_emb.bin          … ベクトル（float32、件数 × 384）
 *    を書き出す。ブラウザと同じ public/bert.js・同じ重みで計算するので、数値がそろう。
 *
 * 先に npm run pack-model（モデルを Web 用にまとめる）を実行しておくこと。
 */
import {writeFile, mkdir} from "node:fs/promises";
import {CALC_UNITS} from "./subjects.mjs";
import {readCsv, readMisconceptions, loadTeamModel, embedAll, unitBySubject, MODEL_ID, DTYPE, DIM} from "./lib.mjs";

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const CSV = args.find(a => !a.startsWith("--")) || "data/misconception_mapping.csv";
const TRAIN = "data/train.csv";
const OUT = "public/data";

// ---------- 1. 誤概念を読む ----------
let list = await readMisconceptions(CSV);
console.log(`[data] 誤概念 ${list.length} 件を読み込みました`);

// ---------- 2. 計算分野に絞る ----------
const unitOf = new Map();   // 誤概念 ID → 日本の単元名
if(!ALL){
  const train = await readCsv(TRAIN, "Kaggle の train.csv を data/ に置いてください（絞り込まずに作るなら npm run build-data -- --all）。");
  const iSub = train.head.indexOf("SubjectName");
  const iMis = ["A", "B", "C", "D"].map(c => train.head.indexOf(`Misconception${c}Id`));
  if(iSub < 0 || iMis.some(i => i < 0)){ console.error("train.csv に SubjectName と MisconceptionAId〜DId の列が見つかりません。"); process.exit(1); }
  const unitMap = unitBySubject(CALC_UNITS);
  const unknown = [...unitMap.keys()].filter(s => !train.rows.some(r => r[iSub] === s));
  if(unknown.length) console.warn(`[data] 注意: train.csv に見つからない単元があります: ${unknown.join(", ")}`);
  // 1つの誤概念が複数の単元に出てくるときは、いちばん多く出てくる単元を付ける
  const counts = new Map();
  for(const r of train.rows){
    const unit = unitMap.get(r[iSub]); if(!unit) continue;
    for(const i of iMis){
      const id = r[i] === "" ? NaN : Number(r[i]); if(!Number.isFinite(id)) continue;
      const c = counts.get(id) || new Map(); c.set(unit, (c.get(unit) || 0) + 1); counts.set(id, c);
    }
  }
  for(const [id, c] of counts) unitOf.set(id, [...c].sort((a, b) => b[1] - a[1])[0][0]);
  list = list.filter(m => unitOf.has(m.id));
  console.log(`[data] 計算分野に出てくる誤概念 ${list.length} 件に絞りました`);
  const per = {}; for(const m of list) per[unitOf.get(m.id)] = (per[unitOf.get(m.id)] || 0) + 1;
  for(const unit of Object.keys(CALC_UNITS)) console.log(`         ${unit}: ${per[unit] || 0} 件`);
  if(!list.length){ console.error("絞り込んだ結果が0件です。scripts/subjects.mjs の単元名を確認してください。"); process.exit(1); }
}

// ---------- 3. ベクトルにする ----------
console.log(`[model] チームのモデル（${MODEL_ID}）でベクトルにしています…`);
const model = await loadTeamModel();
const emb = await embedAll(model, list.map(m => m.name), "[model]");

await mkdir(OUT, {recursive: true});
await writeFile(`${OUT}/mis_emb.bin`, Buffer.from(emb.buffer));
await writeFile(`${OUT}/misconceptions.json`, JSON.stringify({
  model: MODEL_ID, dtype: DTYPE, dim: DIM, count: list.length, created: new Date().toISOString(),
  model_created: model.manifest.created,   // 画面で「データとモデルが同じ版か」を確かめるのに使う
  scope: ALL ? "all" : "calc",
  ids: list.map(m => m.id), names: list.map(m => m.name),
  units: list.map(m => unitOf.get(m.id) || null),
}));
console.log(`[data] ${OUT}/misconceptions.json と ${OUT}/mis_emb.bin を書き出しました（${list.length} 件、${(emb.byteLength / 1e6).toFixed(1)} MB）`);
