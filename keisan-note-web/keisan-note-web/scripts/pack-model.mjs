/**
 * メンバーが学習させたモデル（misconception_model）を、Web で配れる形にまとめる。
 *
 *   npm run pack-model            … model/misconception_model を読む
 *   npm run pack-model -- <フォルダ>  … 別の場所にあるモデルを読む
 *
 * 書き出すもの（public/data/models/team/）
 *   manifest.json   … モデルの設定・重みの場所・問い合わせ文の形
 *   weights-0.bin … … 重み（半精度 fp16。Cloudflare Pages の 1ファイル 25MB の制限に収まるよう分割）
 *   tokenizer.json  … トークナイザー
 *
 * public/data/ の下に置くので、合言葉（APP_PASSCODE）がないと読めない。
 */
import {readFile, writeFile, mkdir, rm} from "node:fs/promises";
import {parseSafetensors, encodeF16} from "../public/bert.js";

const SRC = process.argv.slice(2).find(a => !a.startsWith("--")) || "model/misconception_model";
const OUT = "public/data/models/team";
const CHUNK_BYTES = 24 * 1000 * 1000;   // 25MB の制限より少し小さく
// メンバーの app.py と同じ問い合わせ文（.strip() で前後の改行を除いた形）
const QUERY_TEMPLATE = "Question: {text}\nCorrect answer: {correct}\nStudent answer: {answer}";

const read = (f, enc) => readFile(`${SRC}/${f}`, enc).catch(() => {
  console.error(`${SRC}/${f} が見つかりません。メンバーの misconception_model フォルダを model/ に置いてください。`);
  process.exit(1);
});

const config = JSON.parse(await read("config.json", "utf8"));
const tokenizer = await read("tokenizer.json", "utf8");
const pooling = JSON.parse(await readFile(`${SRC}/1_Pooling/config.json`, "utf8").catch(() => "{}"));
if(config.model_type !== "bert") { console.error(`モデルの種類が ${config.model_type} です（bert のみ対応）`); process.exit(1); }
if(pooling.pooling_mode && pooling.pooling_mode !== "mean"){ console.error(`プーリングが ${pooling.pooling_mode} です（mean のみ対応）`); process.exit(1); }

console.log(`[pack] ${SRC}/model.safetensors を読み込んでいます…`);
const tensors = parseSafetensors(await read("model.safetensors"));
const names = [...tensors.keys()].filter(n => !n.startsWith("pooler."));   // 文のベクトルには使わない部分は除く

await rm(OUT, {recursive: true, force: true});
await mkdir(OUT, {recursive: true});
const chunks = [[]], list = []; let size = 0, offset = 0;
for(const name of names){
  const {shape, data} = tensors.get(name), h = encodeF16(data);
  if(size + h.byteLength > CHUNK_BYTES && chunks[chunks.length - 1].length){ chunks.push([]); size = 0; offset = 0; }
  chunks[chunks.length - 1].push(h);
  list.push({name, shape, chunk: chunks.length - 1, offset, length: h.length});
  size += h.byteLength; offset += h.length;
}
const files = [];
for(let i = 0; i < chunks.length; i++){
  const total = chunks[i].reduce((s, a) => s + a.length, 0), buf = new Uint16Array(total);
  let o = 0; for(const a of chunks[i]){ buf.set(a, o); o += a.length; }
  const file = `weights-${i}.bin`;
  await writeFile(`${OUT}/${file}`, Buffer.from(buf.buffer));
  files.push({file, bytes: buf.byteLength});
}
await writeFile(`${OUT}/tokenizer.json`, tokenizer);
await writeFile(`${OUT}/manifest.json`, JSON.stringify({
  format: "keisan-note-bert-v1", dtype: "f16", created: new Date().toISOString(),
  source: "misconception_model（メンバーが all-MiniLM-L6-v2 を Eedi の train.csv で学習させたもの）",
  config: {hidden_size: config.hidden_size, num_attention_heads: config.num_attention_heads, num_hidden_layers: config.num_hidden_layers,
    intermediate_size: config.intermediate_size, layer_norm_eps: config.layer_norm_eps, max_position_embeddings: config.max_position_embeddings,
    hidden_act: config.hidden_act, vocab_size: config.vocab_size},
  pooling: "mean", normalize: true, query_template: QUERY_TEMPLATE,
  chunks: files.map(f => f.file), tensors: list,
}, null, 1));
console.log(`[pack] ${OUT} に書き出しました: ${files.map(f => `${f.file}（${(f.bytes / 1e6).toFixed(1)} MB）`).join("、")}`);
