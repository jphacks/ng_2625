/**
 * 答案の写真を Gemini で読み取る。
 * 入力: {image: "data:image/jpeg;base64,...", crop: false}
 * 出力: 答案全体 → {problems: [{q_no, label, question, question_en, problem, steps, answer, unclear, mark, unit, box_2d}]}
 *       （question は文章を含む問題文、problem は式だけで解ける問題の式。文章題では空）
 *       切り抜き → {lines: [...], answer, unclear}
 */
import {callGemini, handle, json, splitDataUrl, HttpError} from "../../lib/gemini.js";
import {READ_SHEET, READ_CROP, SCHEMA_SHEET, SCHEMA_CROP, UNITS} from "../../lib/prompts.js";

const str = v => String(v ?? "").replace(/\s+/g, " ").trim();

export function normalizeSheet(obj){
  const problems = (Array.isArray(obj?.problems) ? obj.problems : []).map(p => ({
    q_no: Number.isInteger(p?.q_no) ? p.q_no : 0,
    label: str(p?.label).slice(0, 20),
    question: str(p?.question).slice(0, 600),
    question_en: str(p?.question_en).slice(0, 800),
    problem: str(p?.problem),
    steps: (Array.isArray(p?.steps) ? p.steps : []).map(str).filter(Boolean),
    answer: str(p?.answer),
    unclear: Boolean(p?.unclear),
    mark: ["correct", "wrong"].includes(p?.mark) ? p.mark : "none",
    unit: UNITS.includes(p?.unit) ? p.unit : "その他",
    box_2d: Array.isArray(p?.box_2d) && p.box_2d.length === 4 && p.box_2d.every(Number.isFinite) ? p.box_2d : null,
  })).filter(p => p.problem || p.question);
  return {problems};
}

export function normalizeCrop(obj){
  return {
    lines: (Array.isArray(obj?.lines) ? obj.lines : []).map(str).filter(Boolean),
    answer: str(obj?.answer),
    unclear: Boolean(obj?.unclear),
  };
}

export async function onRequestPost({request, env}){
  return handle(async () => {
    let body;
    try { body = await request.json(); } catch { throw new HttpError(400, "送られたデータを読めませんでした"); }
    const {mimeType, data} = splitDataUrl(body?.image);
    const crop = Boolean(body?.crop);
    const parts = [{text: crop ? READ_CROP : READ_SHEET}, {inline_data: {mime_type: mimeType, data}}];
    const out = await callGemini(env, parts, crop ? SCHEMA_CROP : SCHEMA_SHEET);
    return json(crop ? normalizeCrop(out) : normalizeSheet(out));
  });
}
