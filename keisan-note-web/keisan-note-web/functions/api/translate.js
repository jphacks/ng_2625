/**
 * 問題文（日本語）を英語に訳す。チームのモデルは英語で学習しているため、
 * 講師が手入力・手直しした文章題は、モデルに渡す前にここで英訳する。
 * 入力: {texts: ["..."]}（20件まで）  出力: {texts: ["..."]}
 */
import {callGemini, handle, json, HttpError} from "../../lib/gemini.js";
import {translatePrompt, SCHEMA_TRANSLATE} from "../../lib/prompts.js";

const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function onRequestPost({request, env}){
  return handle(async () => {
    let body;
    try { body = await request.json(); } catch { throw new HttpError(400, "送られたデータを読めませんでした"); }
    const texts = (Array.isArray(body?.texts) ? body.texts : []).slice(0, 20).map(t => str(t, 600));
    if(!texts.length || texts.some(t => !t)) throw new HttpError(400, "訳す文がありません");
    const out = await callGemini(env, [{text: translatePrompt(texts)}], SCHEMA_TRANSLATE);
    const res = (Array.isArray(out?.texts) ? out.texts : []).map(t => str(t, 800));
    if(res.length !== texts.length) throw new HttpError(502, "英訳の数が合いませんでした。もう一度試してください");
    return json({texts: res});
  });
}
