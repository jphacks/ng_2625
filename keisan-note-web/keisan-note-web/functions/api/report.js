/**
 * 講師向けレポートを日本語で作る。
 * チームのモデルが推定した誤概念（英語）を日本語にし、声かけとまとめを付ける。
 * 途中式の診断（画面の計算エンジンで確かめた事実）を前提にして書かせ、
 * それと関係の薄いモデルの候補には relevant: false を付けてもらう（画面では表示しない）。
 * モデルの推定結果（ID と順位）は変えない。
 *
 * 入力: {items: [{q, label, question, unit, out_of_scope, problem, steps, answer, correct, explain:{title, detail}, candidates:[{id, name, unit}], rule_hits:[{id, name}]}]}
 * 出力: {items: [{q, translations:[{id, ja, concept, relevant}], advice}], summary}
 */
import {callGemini, handle, json, HttpError} from "../../lib/gemini.js";
import {reportPrompt, SCHEMA_REPORT} from "../../lib/prompts.js";

const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function sanitizeItems(items){
  if(!Array.isArray(items) || !items.length) throw new HttpError(400, "診断する問題がありません");
  if(items.length > 40) throw new HttpError(400, "一度に送れる問題は40問までです");
  const list = arr => (Array.isArray(arr) ? arr : []).slice(0, 8)
    .map(c => ({id: Number(c?.id), name: str(c?.name, 300), unit: str(c?.unit, 40)})).filter(c => Number.isInteger(c.id));
  return items.map(i => ({
    q: Number(i?.q) || 0,
    label: str(i?.label, 20),
    question: str(i?.question, 600),
    unit: str(i?.unit, 40),
    out_of_scope: Boolean(i?.out_of_scope),
    problem: str(i?.problem, 300),
    steps: (Array.isArray(i?.steps) ? i.steps : []).slice(0, 20).map(s => str(s, 200)),
    answer: str(i?.answer, 200),
    correct: str(i?.correct, 200),
    explain: i?.explain && str(i.explain.title, 80) ? {title: str(i.explain.title, 80), detail: str(i.explain.detail, 400)} : null,
    candidates: list(i?.candidates),
    rule_hits: list(i?.rule_hits),
  }));
}

export async function onRequestPost({request, env}){
  return handle(async () => {
    let body;
    try { body = await request.json(); } catch { throw new HttpError(400, "送られたデータを読めませんでした"); }
    const items = sanitizeItems(body?.items);
    const out = await callGemini(env, [{text: reportPrompt(items)}], SCHEMA_REPORT);
    const res = (Array.isArray(out?.items) ? out.items : []).map(r => ({
      q: Number(r?.q) || 0,
      translations: (Array.isArray(r?.translations) ? r.translations : [])
        .map(t => ({id: Number(t?.id), ja: str(t?.ja, 80), concept: str(t?.concept, 30), relevant: t?.relevant !== false}))
        .filter(t => Number.isInteger(t.id) && t.ja),
      advice: str(r?.advice, 300),
    }));
    return json({items: res, summary: str(out?.summary, 400)});
  });
}
