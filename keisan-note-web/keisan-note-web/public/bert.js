/**
 * チームのモデル（メンバーが学習させた misconception_model）を、ブラウザと Node.js で動かすための計算部品。
 *
 * - モデルの構造: BERT（6層・384次元・12ヘッド）→ 平均プーリング → 正規化（sentence-transformers と同じ）
 * - トークナイザー: BERT の WordPiece（小文字化・アクセント除去・句読点で分割）
 * - 重み: メンバーの model.safetensors を scripts/pack-model.mjs で半精度（fp16）にまとめたもの
 *
 * 外部のライブラリを使わず、この1ファイルで計算する。
 * ブラウザ（public/index.html）とデータ作成（scripts/build-data.mjs）が同じこのファイルを使うので、計算結果が必ず一致する。
 */

/* ---------- トークナイザー（Hugging Face tokenizers の BertNormalizer + BertPreTokenizer + WordPiece と同じ規則） ---------- */
const CJK = [[0x4E00, 0x9FFF], [0x3400, 0x4DBF], [0x20000, 0x2A6DF], [0x2A700, 0x2B73F], [0x2B740, 0x2B81F], [0x2B820, 0x2CEAF], [0xF900, 0xFAFF], [0x2F800, 0x2FA1F]];
const isCJK = cp => CJK.some(([a, b]) => cp >= a && cp <= b);
const RE_CONTROL = /\p{C}/u, RE_SPACE = /[\t\n\r\p{Zs}]/u, RE_MARK = /\p{Mn}/u, RE_PUNCT = /\p{P}/u;
const isPunct = ch => { const c = ch.codePointAt(0); return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126) || RE_PUNCT.test(ch); };

export class BertTokenizer {
  constructor(tokenizerJson){
    const t = typeof tokenizerJson === "string" ? JSON.parse(tokenizerJson) : tokenizerJson;
    const m = t.model;
    if(m?.type !== "WordPiece") throw new Error("WordPiece のトークナイザーではありません");
    this.vocab = new Map(Object.entries(m.vocab));
    this.unk = this.vocab.get(m.unk_token || "[UNK]");
    this.prefix = m.continuing_subword_prefix ?? "##";
    this.maxChars = m.max_input_chars_per_word ?? 100;
    const n = t.normalizer || {};
    this.lowercase = n.lowercase !== false;
    this.stripAccents = n.strip_accents ?? this.lowercase;
    this.maxLen = t.truncation?.max_length || 256;
    this.cls = this.vocab.get("[CLS]"); this.sep = this.vocab.get("[SEP]");
  }
  normalize(text){
    let out = "";
    for(const ch of String(text)){
      const cp = ch.codePointAt(0);
      if(cp === 0 || cp === 0xFFFD) continue;
      if(RE_SPACE.test(ch)){ out += " "; continue; }
      if(RE_CONTROL.test(ch)) continue;
      out += isCJK(cp) ? ` ${ch} ` : ch;
    }
    if(this.stripAccents) out = [...out.normalize("NFD")].filter(ch => !RE_MARK.test(ch)).join("");
    if(this.lowercase) out = out.toLowerCase();
    return out;
  }
  words(text){
    const words = [];
    for(const chunk of this.normalize(text).split(/\s+/u)){
      let cur = "";
      for(const ch of chunk){
        if(isPunct(ch)){ if(cur) words.push(cur); words.push(ch); cur = ""; }
        else cur += ch;
      }
      if(cur) words.push(cur);
    }
    return words;
  }
  wordPiece(word){
    const chars = [...word];
    if(chars.length > this.maxChars) return [this.unk];
    const ids = [];
    for(let start = 0; start < chars.length;){
      let end = chars.length, id;
      while(start < end){
        const piece = (start > 0 ? this.prefix : "") + chars.slice(start, end).join("");
        if(this.vocab.has(piece)){ id = this.vocab.get(piece); break; }
        end--;
      }
      if(id === undefined) return [this.unk];
      ids.push(id); start = end;
    }
    return ids;
  }
  encode(text){
    const ids = this.words(text).flatMap(w => this.wordPiece(w)).slice(0, this.maxLen - 2);
    return [this.cls, ...ids, this.sep];
  }
}

/* ---------- 半精度（fp16）→ 単精度 ---------- */
let F16 = null;
export function decodeF16(u16){
  if(!F16){
    F16 = new Float32Array(65536);
    for(let h = 0; h < 65536; h++){
      const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1F, f = h & 0x3FF;
      F16[h] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15);
    }
  }
  const out = new Float32Array(u16.length);
  for(let i = 0; i < u16.length; i++) out[i] = F16[u16[i]];
  return out;
}
// 単精度 → 半精度（四捨五入は偶数への丸め）。pack-model.mjs が使う
export function encodeF16(f32){
  const out = new Uint16Array(f32.length), fb = new Float32Array(1), ib = new Uint32Array(fb.buffer);
  for(let i = 0; i < f32.length; i++){
    fb[0] = f32[i]; const x = ib[0];
    const sign = (x >>> 16) & 0x8000, exp = (x >>> 23) & 0xFF, mant = x & 0x7FFFFF;
    let h;
    if(exp === 0xFF) h = sign | 0x7C00 | (mant ? 0x200 : 0);
    else {
      const e = exp - 127 + 15;
      if(e >= 0x1F) h = sign | 0x7C00;
      else if(e <= 0){
        if(e < -10) h = sign;
        else { const m = mant | 0x800000, shift = 14 - e; let v = m >> shift; const rem = m & ((1 << shift) - 1), half = 1 << (shift - 1);
          if(rem > half || (rem === half && (v & 1))) v++; h = sign | v; }
      } else {
        let v = (e << 10) | (mant >> 13); const rem = mant & 0x1FFF;
        if(rem > 0x1000 || (rem === 0x1000 && (v & 1))) v++;
        h = sign | v;
      }
    }
    out[i] = h;
  }
  return out;
}

/* ---------- safetensors の読み込み ---------- */
export function parseSafetensors(buf){
  const bytes = new Uint8Array(buf), dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Number(dv.getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + n)));
  const base = 8 + n, tensors = new Map();
  for(const [name, t] of Object.entries(header)){
    if(name === "__metadata__") continue;
    if(t.dtype !== "F32") throw new Error(`${name} の型 ${t.dtype} には対応していません（F32 のみ）`);
    const [s, e] = t.data_offsets, start = bytes.byteOffset + base + s;
    const arr = start % 4 === 0 ? new Float32Array(bytes.buffer, start, (e - s) / 4) : new Float32Array(bytes.slice(base + s, base + e).buffer);
    tensors.set(name, {shape: t.shape, data: arr});
  }
  return tensors;
}

/* ---------- BERT 本体 ---------- */
function erf(x){   // Abramowitz-Stegun 7.1.26（誤差 1.5e-7 以下）
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
const gelu = x => 0.5 * x * (1 + erf(x / Math.SQRT2));
// y[t][o] = b[o] + Σ W[o][i] x[t][i]（W は PyTorch と同じ [出力, 入力] の並び）
// 重みの1行を読んだら、すべてのトークンに使い回す（重みの読み込みが1回で済むので速い）
function linear(x, T, inDim, W, b, outDim){
  const y = new Float32Array(T * outDim), n4 = inDim - (inDim % 4);
  for(let o = 0; o < outDim; o++){
    const wo = o * inDim, bo = b[o];
    for(let t = 0; t < T; t++){
      const xo = t * inDim;
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0, i = 0;
      for(; i < n4; i += 4){
        s0 += W[wo + i] * x[xo + i]; s1 += W[wo + i + 1] * x[xo + i + 1];
        s2 += W[wo + i + 2] * x[xo + i + 2]; s3 += W[wo + i + 3] * x[xo + i + 3];
      }
      for(; i < inDim; i++) s0 += W[wo + i] * x[xo + i];
      y[t * outDim + o] = bo + ((s0 + s1) + (s2 + s3));
    }
  }
  return y;
}
function layerNorm(x, T, D, g, b, eps){
  for(let t = 0; t < T; t++){
    const o = t * D; let mean = 0, v = 0;
    for(let i = 0; i < D; i++) mean += x[o + i];
    mean /= D;
    for(let i = 0; i < D; i++){ const d = x[o + i] - mean; v += d * d; }
    const inv = 1 / Math.sqrt(v / D + eps);
    for(let i = 0; i < D; i++) x[o + i] = (x[o + i] - mean) * inv * g[i] + b[i];
  }
  return x;
}

export class BertEncoder {
  /** config: Hugging Face の config.json。get(name): 重み（Float32Array）を返す関数 */
  constructor(config, get){
    this.D = config.hidden_size; this.H = config.num_attention_heads; this.L = config.num_hidden_layers;
    this.F = config.intermediate_size; this.eps = config.layer_norm_eps ?? 1e-12; this.maxPos = config.max_position_embeddings;
    if(config.hidden_act && config.hidden_act !== "gelu") throw new Error(`活性化関数 ${config.hidden_act} には対応していません`);
    const w = n => { const t = get(n); if(!t) throw new Error(`重み ${n} が見つかりません`); return t; };
    this.emb = {word: w("embeddings.word_embeddings.weight"), pos: w("embeddings.position_embeddings.weight"), type: w("embeddings.token_type_embeddings.weight"),
      g: w("embeddings.LayerNorm.weight"), b: w("embeddings.LayerNorm.bias")};
    this.layers = Array.from({length: this.L}, (_, l) => {
      const p = `encoder.layer.${l}.`;
      return {
        qW: w(p + "attention.self.query.weight"), qB: w(p + "attention.self.query.bias"),
        kW: w(p + "attention.self.key.weight"), kB: w(p + "attention.self.key.bias"),
        vW: w(p + "attention.self.value.weight"), vB: w(p + "attention.self.value.bias"),
        oW: w(p + "attention.output.dense.weight"), oB: w(p + "attention.output.dense.bias"),
        ln1g: w(p + "attention.output.LayerNorm.weight"), ln1b: w(p + "attention.output.LayerNorm.bias"),
        iW: w(p + "intermediate.dense.weight"), iB: w(p + "intermediate.dense.bias"),
        fW: w(p + "output.dense.weight"), fB: w(p + "output.dense.bias"),
        ln2g: w(p + "output.LayerNorm.weight"), ln2b: w(p + "output.LayerNorm.bias"),
      };
    });
  }
  /** トークン ID の列 → 文のベクトル（平均プーリング + 正規化）。pause があれば層ごとに呼ぶ（画面を固まらせないため） */
  async embedIds(ids, pause){
    const {D, H, F} = this, T = Math.min(ids.length, this.maxPos), hd = D / H, scale = 1 / Math.sqrt(hd);
    let x = new Float32Array(T * D);
    for(let t = 0; t < T; t++) for(let i = 0; i < D; i++)
      x[t * D + i] = this.emb.word[ids[t] * D + i] + this.emb.pos[t * D + i] + this.emb.type[i];
    layerNorm(x, T, D, this.emb.g, this.emb.b, this.eps);
    const sc = new Float32Array(T);
    for(const L of this.layers){
      const q = linear(x, T, D, L.qW, L.qB, D), k = linear(x, T, D, L.kW, L.kB, D), v = linear(x, T, D, L.vW, L.vB, D);
      const ctx = new Float32Array(T * D);
      for(let h = 0; h < H; h++){
        const ho = h * hd;
        for(let i = 0; i < T; i++){
          let mx = -Infinity;
          for(let j = 0; j < T; j++){ let s = 0; for(let d = 0; d < hd; d++) s += q[i * D + ho + d] * k[j * D + ho + d]; s *= scale; sc[j] = s; if(s > mx) mx = s; }
          let sum = 0; for(let j = 0; j < T; j++){ sc[j] = Math.exp(sc[j] - mx); sum += sc[j]; }
          for(let j = 0; j < T; j++){ const p = sc[j] / sum; for(let d = 0; d < hd; d++) ctx[i * D + ho + d] += p * v[j * D + ho + d]; }
        }
      }
      const a = linear(ctx, T, D, L.oW, L.oB, D);
      for(let i = 0; i < a.length; i++) a[i] += x[i];
      x = layerNorm(a, T, D, L.ln1g, L.ln1b, this.eps);
      const mid = linear(x, T, D, L.iW, L.iB, F);
      for(let i = 0; i < mid.length; i++) mid[i] = gelu(mid[i]);
      const o = linear(mid, T, F, L.fW, L.fB, D);
      for(let i = 0; i < o.length; i++) o[i] += x[i];
      x = layerNorm(o, T, D, L.ln2g, L.ln2b, this.eps);
      if(pause) await pause();
    }
    const out = new Float32Array(D);
    for(let t = 0; t < T; t++) for(let i = 0; i < D; i++) out[i] += x[t * D + i];
    let n = 0; for(let i = 0; i < D; i++){ out[i] /= T; n += out[i] * out[i]; }
    n = Math.sqrt(n) || 1; for(let i = 0; i < D; i++) out[i] /= n;
    return out;
  }
}

/** チームのモデル（トークナイザー + BERT）。pack-model.mjs で作ったファイルから組み立てる */
export class TeamModel {
  constructor(manifest, chunks, tokenizerJson){
    this.manifest = manifest;
    this.tokenizer = new BertTokenizer(tokenizerJson);
    const views = chunks.map(c => c instanceof Uint16Array ? c : new Uint16Array(c.buffer ? c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) : c));
    const index = new Map(manifest.tensors.map(t => [t.name, t])), cache = new Map();
    this.encoder = new BertEncoder(manifest.config, name => {
      if(cache.has(name)) return cache.get(name);
      const t = index.get(name); if(!t) return null;
      const arr = decodeF16(views[t.chunk].subarray(t.offset, t.offset + t.length));
      cache.set(name, arr); return arr;
    });
  }
  /** メンバーの app.py と同じ問い合わせ文（{text}・{correct}・{answer} を埋める） */
  query(text, correct, answer){
    return (this.manifest.query_template || "Question: {text}\nCorrect answer: {correct}\nStudent answer: {answer}")
      .replace("{text}", () => text).replace("{correct}", () => correct).replace("{answer}", () => answer);   // 関数で渡す（$& などを特別扱いさせない）
  }
  async embed(text, pause){ return this.encoder.embedIds(this.tokenizer.encode(text), pause); }
}
