/** 合言葉の確認用。_middleware.js を通過できれば合言葉は正しい。 */
import {json} from "../../lib/gemini.js";

export async function onRequestGet(){
  return json({ok: true});
}
