/**
 * Gemini への指示文と、返してほしい JSON の形。
 * 画面（public/index.html）の Claude 用の指示文と内容をそろえてある。
 */
/* 単元の一覧（読み取りで Gemini に選ばせる）。IN_SCOPE はチームのモデルで誤概念を推定できる単元 */
export const UNITS = [
  "正の数・負の数（中1）", "文字式・式の計算（中1・中2）", "一次方程式（中1）", "連立方程式（中2）",
  "式の展開と因数分解（中3）", "平方根（中3）", "二次方程式（中3）", "小学校の計算（分数・小数・四則）",
  "比・割合・速さ（小6〜中1）", "関数・グラフ（中学）", "図形（中学）", "データの活用・確率（中学）", "高校の内容", "その他",
];

export const READ_SHEET = `これは数学の答案の写真です。計算問題だけでなく、文章を含む問題もあります。
問題ごとに、問題文・式・生徒の途中式と答え・先生の丸つけを書き起こしてください。

厳守すること:
- 生徒が書いたとおりに書き起こす。計算の誤りを直したり、正しい答えを補ったりしない（誤答の分析に使うため）
- 式は半角で書く。分数は 1/2（分子や分母が式なら (x + 1)/(x + 2)）、累乗は x^2、掛け算は ×、割り算は ÷、マイナスは -、等号は =、根号は √、虚数単位は i
- 小問（①②など）も1問ずつ分ける。q_no は上から順に 1, 2, 3 と通し番号を付け、label には答案に書かれた番号を「(3)①」「問2」のように入れる
- question: 印刷された問題文を、文章も含めて書き起こす。「次の式を計算せよ」のような共通の指示は、小問ごとに付ける
- problem: 式を計算する・方程式を解くだけで答えが出る問題なら、その式だけを入れる（例: "3x + 4 = 13"、"(-3)×(-4) - 2^2"）。連立方程式は式を「, 」でつなぐ（例: "2x + y = 7, x - y = 2"）。文章題や、条件から値を求める問題など、式だけでは答えが決まらない問題は空にする
- question_en: 問題文の英訳（数学の英語で。式はそのまま）
- steps: 生徒の途中式を1行ずつ
- answer: 生徒の最終的な答え。解答欄が複数あれば "a = 9, b = 4, c = -2"、"商 x^2 - x - 3, 余り -7" のようにつなぐ。連立方程式は "x = 3, y = 1"、解が2つなら "x = 2, -3"、計算問題は値や式だけ（例: "-16"、"3x - 2"）
- 生徒が答えを書いていない問題は、answer を空にする
- mark: 先生の丸つけ（赤ペン）。答えが ○ で囲まれていれば "correct"、レ点（✓）・斜線・× なら "wrong"、丸つけがなければ "none"
- unit: 次から最も近い単元を1つ選ぶ: ${UNITS.join(" / ")}
- 字がかすれている・二通りに読めるなど、自信がない問題は unclear を true にする
- box_2d は、その問題（問題文から答えまで）を囲む枠を [ymin, xmin, ymax, xmax]（0〜1000 に正規化）で返す
- 生徒の氏名・点数、答えではないメモやコメントは書き起こさない`;

export const READ_CROP = `これは数学の答案の一部を切り抜いた画像です。
書かれている式を、上の行から順に1行ずつ lines に書き起こしてください。

厳守すること:
- 書かれているとおりに書き起こし、計算の誤りを直さない
- 式は半角で書く。分数は 1/2、累乗は x^2、掛け算は ×、割り算は ÷、マイナスは -、根号は √
- 最終的な答えが写っていれば answer に入れる（連立方程式なら "x = 3, y = 1"、解が2つなら "x = 2, -3"）。写っていなければ空にする
- 自信がない文字があれば unclear を true にする`;

export const SCHEMA_SHEET = {
  type: "OBJECT",
  properties: {
    problems: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          q_no: {type: "INTEGER"},
          label: {type: "STRING"},
          question: {type: "STRING"},
          question_en: {type: "STRING"},
          problem: {type: "STRING"},
          steps: {type: "ARRAY", items: {type: "STRING"}},
          answer: {type: "STRING"},
          unclear: {type: "BOOLEAN"},
          mark: {type: "STRING", enum: ["correct", "wrong", "none"]},
          unit: {type: "STRING", enum: UNITS},
          box_2d: {type: "ARRAY", items: {type: "INTEGER"}},
        },
        required: ["q_no", "label", "question", "question_en", "problem", "steps", "answer", "unclear", "mark", "unit"],
      },
    },
  },
  required: ["problems"],
};

export const SCHEMA_CROP = {
  type: "OBJECT",
  properties: {
    lines: {type: "ARRAY", items: {type: "STRING"}},
    answer: {type: "STRING"},
    unclear: {type: "BOOLEAN"},
  },
  required: ["lines", "unclear"],
};

/* ---------- 講師向けレポート（日本語） ---------- */
export function reportPrompt(items){
  const blocks = items.map(i => `### 問${i.q}${i.label ? `（答案の番号: ${i.label}）` : ""}
${i.question ? `問題文: ${i.question}\n` : ""}式: ${i.problem || "（式だけでは解けない問題）"}
単元: ${i.unit || "不明"}${i.out_of_scope ? "（チームのモデルの対象外。誤概念の候補はなし）" : ""}
途中式: ${(i.steps || []).filter(Boolean).join(" / ") || "（なし）"}
生徒の答え: ${i.answer}
正答: ${i.correct || "不明（推測しないこと）"}
途中式の診断（計算で確かめた事実）: ${i.explain ? `${i.explain.title}。${i.explain.detail}` : "特定できず"}
計算で再現できたミス: ${(i.rule_hits || []).map(h => `[${h.id}] ${h.name}`).join(" / ") || "なし"}
チームのモデルが推定した誤概念（Eedi の ID: 英語名、スコア順）:
${(i.candidates || []).map(c => `${c.id}: ${c.name}${c.unit ? `（単元: ${c.unit}）` : ""}`).join("\n") || "（なし）"}`).join("\n\n");

  return `あなたは日本の中学校の数学指導に詳しい教師です。生徒の答案の誤りについて、大学生の塾講師が次の授業で使える日本語の説明を作ってください。

前提:
- 「途中式の診断」は、途中式を1行ずつ計算して確かめた事実です。最も信頼できる根拠として扱い、これと矛盾することを書かない
- 「チームのモデルが推定した誤概念」は、文の似ている度合いで選んだ候補で、外れていることがあります
- 「単元」が対象外の問題（高校の内容など）は、誤概念の候補がありません。生徒の答えと（わかれば）正答から言える範囲で advice を書く。正答が「不明」のときは、正答を自分で決めつけない

やること:
1. 各問題の「チームのモデルが推定した誤概念」と「計算で再現できたミス」を、すべて日本語にする（ID はそのまま。並び順や数を変えない）
   - ja: 講師がひと目でわかる短い日本語（30字以内）
   - concept: 日本の中学校の単元名（候補に「単元」が付いていれば、それを使う）。小学校の内容なら「分数の計算（小学校）」のように書く
   - relevant: その誤概念が、この問題の途中式・答え・途中式の診断と合っていれば true、関係が薄い・矛盾していれば false
     （例: 一次方程式の符号ミスなのに「連立方程式で別の文字の値を答える」「y = x のグラフ」などは false）
2. advice: その問題について、講師が生徒にかける声かけや教え方（日本語、80字以内）。途中式の診断があれば、それに基づいて具体的に書く
3. summary: 答案全体から見た、次の授業で優先して確認したいこと（日本語、120字以内）

日本語の書き方:
- 英語を直訳しない。中学校の先生が生徒に話すときの自然な日本語にする
  悪い例:「移項の際に足し算と引き算の逆演算を混同する」「連立方程式で別の文字の値を答えてしまう」
  良い例:「移項するときに符号を変えていない」「x と y の値を取り違えている」
- 中学校の用語（移項、通分、累乗、正負の数、分配法則、加減法、代入法 など）を使う
- すべて日本語で書く。英語の文をそのまま残さない

${blocks}`;
}

export const SCHEMA_REPORT = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          q: {type: "INTEGER"},
          translations: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {id: {type: "INTEGER"}, ja: {type: "STRING"}, concept: {type: "STRING"}, relevant: {type: "BOOLEAN"}},
              required: ["id", "ja", "concept", "relevant"],
            },
          },
          advice: {type: "STRING"},
        },
        required: ["q", "translations", "advice"],
      },
    },
    summary: {type: "STRING"},
  },
  required: ["items", "summary"],
};

/* ---------- 問題文の英訳（手入力・手直しした文章題を、チームのモデルに渡すため） ---------- */
export const translatePrompt = texts => `次の数学の問題文を、それぞれ英語に訳してください（数学の英語で。式はそのまま）。順番と数を変えないこと。

${texts.map((t, i) => `[${i + 1}] ${t}`).join("\n")}`;
export const SCHEMA_TRANSLATE = {type: "OBJECT", properties: {texts: {type: "ARRAY", items: {type: "STRING"}}}, required: ["texts"]};
