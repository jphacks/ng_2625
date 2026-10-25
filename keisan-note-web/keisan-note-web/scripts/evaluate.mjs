/**
 * チームのモデルの精度を、train.csv の計算分野の問題で測る。
 *
 *   npm run evaluate
 *
 * 比べるもの
 *   A. 絞り込みなし … 誤概念 2,587 件すべてを候補にする
 *   B. 絞り込みあり … 計算分野（scripts/subjects.mjs）に出てくる誤概念だけを候補にする（npm run build-data と同じ方式）
 *   C. 優先する     … 2,587 件すべてを候補に残し、計算分野の誤概念のスコアにだけ少し加点する
 *                     （B は、計算分野の問題に1回も出てこない誤概念を取りこぼす。C はそれを避けつつ計算分野を優先する）
 *
 * 公平に比べるための工夫（5分割交差検証）
 *   絞り込みの候補を、評価に使う問題と同じ train.csv から作ると、正解が必ず候補に入るため B が有利に見えてしまう。
 *   そこで問題を QuestionId で5つのグループに分け、4グループで候補を作り、残り1グループで測る。これを5回くり返す。
 *   評価する問題の正解が候補から漏れていれば、その問題は不正解として数える。
 *
 * 評価に使うもの
 *   計算分野の問題の、誤答の選択肢のうち、誤概念のラベルが付いているもの。
 *   問い合わせ文はメンバーの app.py と同じ（問題文・正答・生徒の答え）。
 *
 * オプション
 *   --format plain  … 問題文などを LaTeX から普通の書き方に直して渡す（画面と同じ。初期値）
 *   --format latex  … train.csv の LaTeX のまま渡す（メンバーがモデルを学習させたときと同じ）
 *   --limit 300     … 一部だけで手早く測る（全件は数分〜十数分かかる）
 *
 * 注意（データの重なり）
 *   チームのモデル（misconception_model）は train.csv の誤答 4,370 件すべてで学習している。
 *   そのため、この評価は「学習に使った問題」で測ることになり、初めて見る問題での精度より高く出る。
 *   公平な数字を出すには、メンバーに一部の問題（例: QuestionId % 5 == 0）を学習から外して学習し直してもらい、
 *   外した問題だけで測る（--holdout-fold 0）。
 *
 * 指標
 *   Top-1  … 1位が正解だった割合
 *   Top-5  … 5位以内に正解が入った割合（画面には上位を表示している）
 *   MAP@25 … Kaggle のコンペと同じ指標。正解の順位が r 位なら 1/r 点（25位より下は0点）の平均
 *
 * 結果は eval/results.json と eval/report.md に書き出す。
 */
import {writeFile, mkdir} from "node:fs/promises";
import {CALC_UNITS} from "./subjects.mjs";
import {readCsv, readMisconceptions, latexToPlain, loadTeamModel, embedAll, unitBySubject, DIM, MODEL_ID, DTYPE} from "./lib.mjs";

const argv = process.argv.slice(2), opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const FORMAT = opt("--format") === "latex" ? "latex" : "plain";
const LIMIT = Number(opt("--limit")) || 0;
const HOLDOUT = opt("--holdout-fold") == null ? null : Number(opt("--holdout-fold"));

const FOLDS = 5;
const LETTERS = ["A", "B", "C", "D"];

// ---------- 指標 ----------
export function rankOf(scores, label, allowed){
  // allowed: 候補にする誤概念の位置（null ならすべて）。正解が候補にないときは Infinity
  if(allowed && !allowed.has(label)) return Infinity;
  const s = scores[label]; let r = 1;
  if(allowed){ for(const j of allowed) if(j !== label && scores[j] > s) r++; }
  else for(let j = 0; j < scores.length; j++) if(j !== label && scores[j] > s) r++;
  return r;
}
// C. 計算分野の誤概念に bonus を足してから順位を付ける（候補は全件）
export function rankWithBonus(scores, label, allowed, bonus){
  const adj = j => scores[j] + (allowed.has(j) ? bonus : 0), s = adj(label); let r = 1;
  for(let j = 0; j < scores.length; j++) if(j !== label && adj(j) > s) r++;
  return r;
}
export const BONUSES = [0.02, 0.05, 0.1];
export function summarize(ranks){
  const n = ranks.length || 1;
  return {
    n: ranks.length,
    top1: ranks.filter(r => r <= 1).length / n,
    top5: ranks.filter(r => r <= 5).length / n,
    map25: ranks.reduce((a, r) => a + (r <= 25 ? 1 / r : 0), 0) / n,
  };
}

async function main(){
  const model = await loadTeamModel();
  const fmt = s => FORMAT === "latex" ? String(s ?? "").trim() : latexToPlain(s);
  // ---------- データ ----------
  const mis = await readMisconceptions("data/misconception_mapping.csv");
  const posOf = new Map(mis.map((m, i) => [m.id, i]));
  const train = await readCsv("data/train.csv", "Kaggle の train.csv を data/ に置いてください。");
  const c = name => { const i = train.col(name); if(i < 0){ console.error(`train.csv に ${name} の列がありません。`); process.exit(1); } return i; };
  const iQ = c("QuestionId"), iSub = c("SubjectName"), iText = c("QuestionText"), iCorrect = c("CorrectAnswer");
  const iAns = Object.fromEntries(LETTERS.map(L => [L, c(`Answer${L}Text`)]));
  const iMis = Object.fromEntries(LETTERS.map(L => [L, c(`Misconception${L}Id`)]));
  const unitOf = unitBySubject(CALC_UNITS);

  // 評価に使う組（計算分野の問題 × 誤概念のラベルが付いた誤答）
  const cases = [];
  for(const r of train.rows){
    const unit = unitOf.get(r[iSub]); if(!unit) continue;
    const correctText = r[iAns[r[iCorrect]]];
    if(correctText == null) continue;
    for(const L of LETTERS){
      if(L === r[iCorrect] || r[iMis[L]] === "" || r[iMis[L]] == null) continue;
      const id = Number(r[iMis[L]]); if(!posOf.has(id)) continue;
      cases.push({qid: Number(r[iQ]), unit, label: posOf.get(id),
        query: model.query(fmt(r[iText]), fmt(correctText), fmt(r[iAns[L]]))});
    }
  }
  const fold = qid => ((qid % FOLDS) + FOLDS) % FOLDS;
  // 学習から外した問題だけで測る（メンバーが学習し直したモデル用）
  if(HOLDOUT != null){ const keep = cases.filter(x => fold(x.qid) === HOLDOUT); cases.length = 0; cases.push(...keep); }
  // 一部だけで手早く測る（等間隔に選ぶので、毎回同じ問題になる）
  if(LIMIT && cases.length > LIMIT){ const step = cases.length / LIMIT, keep = Array.from({length: LIMIT}, (_, k) => cases[Math.floor(k * step)]); cases.length = 0; cases.push(...keep); }
  if(!cases.length){ console.error("評価に使える問題がありません。scripts/subjects.mjs の単元名を確認してください。"); process.exit(1); }
  console.log(`[eval] 問い合わせ文の形: ${FORMAT === "latex" ? "LaTeX のまま" : "普通の書き方（画面と同じ）"}${HOLDOUT != null ? `、学習から外したグループ ${HOLDOUT} だけ` : ""}${LIMIT ? `、${LIMIT} 件だけ` : ""}`);
  if(HOLDOUT == null) console.log("[eval] 注意: チームのモデルは train.csv で学習しているため、この評価は実際より高く出ます（--holdout-fold の説明を参照）");
  console.log(`[eval] 計算分野の問題 ${new Set(cases.map(x => x.qid)).size} 問、評価する誤答 ${cases.length} 件（${FOLDS}分割交差検証）`);

  // ---------- ベクトル ----------
  const misEmb = await embedAll(model, mis.map(m => m.name), "[model] 誤概念");
  const qEmb = await embedAll(model, cases.map(x => x.query), "[model] 問い合わせ");

  // ---------- 候補（交差検証のグループごと） ----------
  // そのグループ以外の、計算分野の問題に出てくる誤概念
  const allowedFor = [];
  for(let f = 0; f < FOLDS; f++){
    const s = new Set();
    for(const x of cases) if(fold(x.qid) !== f) s.add(x.label);
    // ラベルが付いていない誤答も含め、計算分野の問題に出てくる誤概念をすべて集める（build-data と同じ）
    for(const r of train.rows){
      if(!unitOf.get(r[iSub]) || fold(Number(r[iQ])) === f) continue;
      for(const L of LETTERS){ const id = r[iMis[L]] === "" ? NaN : Number(r[iMis[L]]); if(posOf.has(id)) s.add(posOf.get(id)); }
    }
    allowedFor.push(s);
  }

  // ---------- 順位 ----------
  const rankAll = [], rankCalc = [], rankBonus = BONUSES.map(() => []), byUnit = {};
  const scores = new Float32Array(mis.length);
  cases.forEach((x, k) => {
    const q = qEmb.subarray(k * DIM, (k + 1) * DIM);
    for(let j = 0; j < mis.length; j++){ let s = 0; const o = j * DIM; for(let d = 0; d < DIM; d++) s += misEmb[o + d] * q[d]; scores[j] = s; }
    const a = rankOf(scores, x.label, null), b = rankOf(scores, x.label, allowedFor[fold(x.qid)]);
    rankAll.push(a); rankCalc.push(b);
    BONUSES.forEach((bo, i) => rankBonus[i].push(rankWithBonus(scores, x.label, allowedFor[fold(x.qid)], bo)));
    (byUnit[x.unit] ||= {all: [], calc: []}); byUnit[x.unit].all.push(a); byUnit[x.unit].calc.push(b);
  });

  const A = summarize(rankAll), B = summarize(rankCalc), C = rankBonus.map(summarize);
  const coverage = rankCalc.filter(r => r !== Infinity).length / rankCalc.length;
  const avgCands = allowedFor.reduce((s, x) => s + x.size, 0) / FOLDS;
  const pct = v => `${(v * 100).toFixed(1)}%`, num = v => v.toFixed(3);

  console.log("\n                     候補の数   Top-1    Top-5    MAP@25");
  console.log(`A. 絞り込みなし      ${String(mis.length).padStart(6)}   ${pct(A.top1).padStart(6)}   ${pct(A.top5).padStart(6)}   ${num(A.map25)}`);
  console.log(`B. 計算分野に絞り込み ${String(Math.round(avgCands)).padStart(5)}   ${pct(B.top1).padStart(6)}   ${pct(B.top5).padStart(6)}   ${num(B.map25)}`);
  BONUSES.forEach((bo, i) => console.log(`C. 優先する（+${bo}）    ${String(mis.length).padStart(5)}   ${pct(C[i].top1).padStart(6)}   ${pct(C[i].top5).padStart(6)}   ${num(C[i].map25)}`));
  console.log(`\n正解が候補に残っていた割合（B）: ${pct(coverage)}`);
  const rows = [["A", A], ["B", B], ...BONUSES.map((bo, i) => [`C+${bo}`, C[i]])];
  const best = rows.reduce((x, y) => y[1].map25 > x[1].map25 ? y : x);
  console.log(`MAP@25 がいちばん高いのは ${best[0]}（${num(best[1].map25)}）`);
  console.log("\n単元ごと（Top-5、A → B）");
  const units = Object.keys(CALC_UNITS).filter(u => byUnit[u]).map(u => {
    const a = summarize(byUnit[u].all), b = summarize(byUnit[u].calc);
    console.log(`  ${u}: ${pct(a.top5)} → ${pct(b.top5)}（${a.n} 件）`);
    return {unit: u, n: a.n, all: a, calc: b};
  });

  // ---------- 書き出し ----------
  await mkdir("eval", {recursive: true});
  const result = {
    created: new Date().toISOString(), model: MODEL_ID, dtype: DTYPE, folds: FOLDS, format: FORMAT, limit: LIMIT || null, holdout: HOLDOUT,
    leakage: HOLDOUT == null,
    questions: new Set(cases.map(x => x.qid)).size, cases: cases.length,
    all: {candidates: mis.length, ...A}, calc: {candidates: Math.round(avgCands), coverage, ...B},
    prefer: BONUSES.map((bonus, i) => ({bonus, candidates: mis.length, ...C[i]})), best: best[0], units,
  };
  await writeFile("eval/results.json", JSON.stringify(result, null, 2));
  await writeFile("eval/report.md", `# チームのモデルの精度（計算分野）

- モデル: チームのモデル（${MODEL_ID}、${DTYPE}）。問い合わせ文はメンバーの app.py と同じ（${FORMAT === "latex" ? "LaTeX のまま" : "普通の書き方"}）
${HOLDOUT == null ? "- **注意: チームのモデルは train.csv で学習しているため、この数字は学習に使った問題での精度です。初めて見る問題ではこれより低くなります。**" : `- 学習から外した問題（QuestionId % ${FOLDS} == ${HOLDOUT}）だけで測った精度です`}
- 評価データ: train.csv の計算分野の問題 ${result.questions} 問、誤概念のラベルが付いた誤答 ${result.cases} 件
- 方法: QuestionId で${FOLDS}分割した交差検証。絞り込みの候補は、評価する問題を除いた問題から作る

| | 候補の数 | Top-1 | Top-5 | MAP@25 |
|---|---|---|---|---|
| A. 絞り込みなし | ${mis.length} | ${pct(A.top1)} | ${pct(A.top5)} | ${num(A.map25)} |
| B. 計算分野に絞り込み | 約${Math.round(avgCands)} | ${pct(B.top1)} | ${pct(B.top5)} | ${num(B.map25)} |
${BONUSES.map((bo, i) => `| C. 計算分野を優先（+${bo}） | ${mis.length} | ${pct(C[i].top1)} | ${pct(C[i].top5)} | ${num(C[i].map25)} |`).join("\n")}

MAP@25 がいちばん高いのは **${best[0]}** でした。

正解が候補に残っていた割合（B）: ${pct(coverage)}。残っていなかった誤答は不正解として数えています。
B は候補を減らせる代わりに、計算分野の問題に1回も出てこない誤概念を取りこぼします。C は全件を残したまま、計算分野の誤概念のスコアに加点します。

## 単元ごとの Top-5

| 単元 | 件数 | A. 絞り込みなし | B. 絞り込みあり |
|---|---|---|---|
${units.map(u => `| ${u.unit} | ${u.n} | ${pct(u.all.top5)} | ${pct(u.calc.top5)} |`).join("\n")}

## 指標の意味

- Top-1: 1位が正解だった割合
- Top-5: 5位以内に正解が入った割合
- MAP@25: Kaggle のコンペと同じ指標。正解が r 位なら 1/r 点（25位より下は0点）の平均
`);
  console.log("\n[eval] eval/results.json と eval/report.md に書き出しました");
}

if(import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("evaluate.mjs")) await main();
