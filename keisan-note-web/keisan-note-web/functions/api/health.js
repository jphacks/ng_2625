/** 画面が起動時に呼ぶ。サーバー側の設定がそろっているかを返す（キーそのものは返さない）。 */
import {json, modelName} from "../../lib/gemini.js";

export async function onRequestGet({env}){
  return json({
    ok: true,
    ocr_ready: Boolean(env.GEMINI_API_KEY),
    ocr_name: "Gemini",
    ocr_model: modelName(env),
    passcode_required: Boolean(env.APP_PASSCODE),
  });
}
