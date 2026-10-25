/**
 * Gemini API の呼び出しと、合言葉のチェック（Cloudflare Pages Functions から使う）。
 * キーはサーバー側の環境変数 GEMINI_API_KEY にだけ置き、ブラウザには出さない。
 */
export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export class HttpError extends Error {
  constructor(status, message){ super(message); this.status = status; }
}

export function json(data, status = 200){
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type": "application/json; charset=utf-8", "cache-control": "no-store"},
  });
}

// 合言葉（APP_PASSCODE）が設定されていれば、ヘッダー x-app-passcode と照合する
export function passcodeOk(request, env){
  const want = env.APP_PASSCODE || "";
  if(!want) return true;
  const got = request.headers.get("x-app-passcode") || "";
  if(got.length !== want.length) return false;
  let diff = 0;
  for(let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export function splitDataUrl(dataUrl){
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(dataUrl || "");
  if(!m) throw new HttpError(400, "画像の形式が正しくありません（JPEG か PNG を送ってください）");
  return {mimeType: m[1], data: m[2]};
}

export function modelName(env){ return env.GEMINI_MODEL || DEFAULT_MODEL; }

export function parseGeminiJson(resp){
  const cands = resp?.candidates || [];
  if(!cands.length){
    const reason = (resp?.promptFeedback || resp?.prompt_feedback || {}).blockReason;
    throw new HttpError(502, `Gemini が処理しませんでした（${reason || "応答なし"}）`);
  }
  const parts = cands[0]?.content?.parts || [];
  const text = parts.filter(p => !p.thought).map(p => p.text || "").join("").trim()
    .replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  try { return JSON.parse(text); }
  catch { throw new HttpError(502, "Gemini の応答を読み取れませんでした。もう一度試してください"); }
}

/**
 * Gemini に JSON で答えさせる。
 * parts: [{text}, {inline_data:{mime_type, data}}] の配列
 */
export async function callGemini(env, parts, schema, fetchImpl = fetch){
  if(!env.GEMINI_API_KEY) throw new HttpError(500, "GEMINI_API_KEY が設定されていません（Cloudflare の環境変数に追加してください）");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName(env)}:generateContent`;
  let r;
  try {
    r = await fetchImpl(url, {
      method: "POST",
      headers: {"x-goog-api-key": env.GEMINI_API_KEY, "content-type": "application/json"},
      body: JSON.stringify({
        contents: [{parts}],
        generation_config: {response_mime_type: "application/json", response_schema: schema, temperature: 0},
      }),
    });
  } catch {
    throw new HttpError(502, "Gemini に接続できませんでした。もう一度試してください");
  }
  if(r.status === 429) throw new HttpError(429, "Gemini の利用上限に達しました。1分ほど待ってからやり直すか、Google AI Studio で上限を確認してください");
  if(r.status === 401 || r.status === 403) throw new HttpError(500, "GEMINI_API_KEY が正しくありません。Google AI Studio でキーを確認してください");
  if(r.status === 404) throw new HttpError(500, `Gemini のモデル「${modelName(env)}」が見つかりません。環境変数 GEMINI_MODEL を確認してください`);
  if(!r.ok){
    let msg = "";
    try { msg = (await r.json())?.error?.message || ""; } catch {}
    throw new HttpError(502, `Gemini がエラーを返しました（${r.status}）${msg}`);
  }
  return parseGeminiJson(await r.json());
}

export async function handle(fn){
  try { return await fn(); }
  catch(e){
    if(e instanceof HttpError) return json({error: e.message}, e.status);
    return json({error: "サーバーで予期しないエラーが起きました"}, 500);
  }
}
