/**
 * 合言葉のチェック。
 * /api/（状態確認の /api/health を除く）と /data/（Eedi のデータ）は、
 * 正しい合言葉がないと使えないようにする。Gemini の利用枠と Eedi のデータを守るため。
 */
import {json, passcodeOk} from "../lib/gemini.js";

export async function onRequest(context){
  const path = new URL(context.request.url).pathname;
  const guarded = path.startsWith("/data/") || (path.startsWith("/api/") && path !== "/api/health");
  if(guarded && !passcodeOk(context.request, context.env)){
    return json({error: "合言葉が違います"}, 401);
  }
  return context.next();
}
