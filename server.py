"""
ケアレスノート バックエンド (FastAPI)

役割:
  1. Mathpix の app_key をサーバーだけに置き、アプリには短命の app_token を渡す
  2. OCR 結果の正答を計算する (sympy)
  3. 誤概念モデル (Eedi データセットで学習) の呼び出し口 ← 後でメンバーのモデルを差し込む
  4. 英語の誤概念名を講師向け日本語レポートに整形

起動:
  pip install fastapi uvicorn httpx sympy
  export MATHPIX_APP_ID=... MATHPIX_APP_KEY=...
  uvicorn server:app --reload
"""
import os
import re
import httpx
import sympy as sp
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="keisan-note backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

MATHPIX_APP_ID = os.getenv("MATHPIX_APP_ID", "")
MATHPIX_APP_KEY = os.getenv("MATHPIX_APP_KEY", "")


# ---------- 1. Mathpix: 短命トークンの発行 ----------
@app.post("/mathpix/token")
async def mathpix_token():
    """アプリは この token で api.mathpix.com/v3/text を直接呼ぶ。app_key は外に出さない。"""
    if not MATHPIX_APP_KEY:
        raise HTTPException(500, "MATHPIX_APP_KEY が設定されていません")
    async with httpx.AsyncClient() as c:
        r = await c.post(
            "https://api.mathpix.com/v3/app-tokens",
            headers={"app_key": MATHPIX_APP_KEY},
            json={"expires": 300},  # 5分
        )
    r.raise_for_status()
    return r.json()  # {"app_token": "...", "app_token_expires_at": ...}


# ---------- 2. 正答の計算 ----------
class SolveReq(BaseModel):
    problem_latex: str


def latex_to_sympy(s: str) -> str:
    s = s.replace("\\left", "").replace("\\right", "")
    s = re.sub(r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r"((\1)/(\2))", s)
    s = s.replace("\\times", "*").replace("\\div", "/").replace("\\cdot", "*")
    s = s.replace("^", "**").replace("{", "(").replace("}", ")")
    s = s.replace("×", "*").replace("÷", "/")
    s = re.sub(r"(\d)\s*([a-z(])", r"\1*\2", s)  # 3x -> 3*x
    return s


@app.post("/solve")
def solve(req: SolveReq):
    """計算問題・一次方程式の正答を返す。解けない形は null を返し、講師に手入力してもらう。"""
    try:
        expr = latex_to_sympy(req.problem_latex)
        if "=" in expr:
            lhs, rhs = expr.split("=", 1)
            eq = sp.sympify(lhs) - sp.sympify(rhs)
            sym = sorted(eq.free_symbols, key=str)
            sol = sp.solve(eq, sym[0]) if sym else []
            return {"correct_answer": str(sol[0]) if sol else None}
        return {"correct_answer": str(sp.nsimplify(sp.sympify(expr)))}
    except Exception:
        return {"correct_answer": None}


# ---------- 3. 誤概念モデル (ここを差し替える) ----------
class DiagnoseReq(BaseModel):
    question_text: str          # LaTeX (Eedi の QuestionText と同じ書き方)
    correct_answer: str
    student_answer: str         # Eedi では選択肢の誤答 (distractor) に相当
    student_steps: list[str] = []
    construct_name: str | None = None
    top_k: int = 5


@app.post("/diagnose")
def diagnose(req: DiagnoseReq):
    """
    入出力の約束 (モデル担当メンバーと合わせる):
      出力 = misconception_mapping.csv の ID と名前を、スコア順に top_k 件
    TODO: model.predict(req) に置き換える
    """
    return {
        "misconceptions": [
            {"misconception_id": -1, "misconception_name": "DUMMY: model not connected", "score": 0.0}
        ]
    }


# ---------- 4. 講師向けレポート ----------
class ReportReq(BaseModel):
    items: list[dict]  # [{q_no, problem, student_answer, correct_answer, misconceptions:[...]}]


@app.post("/report")
def report(req: ReportReq):
    """
    推奨: misconception_mapping.csv (約2,600件) を一度だけ日本語訳しておき、
    ID → 日本語名 の辞書で引く。毎回 LLM で訳すより速く、表記もぶれない。
    指導のヒント文だけ LLM で生成する。
    TODO: 翻訳辞書の読み込みと LLM 呼び出し
    """
    return {"items": req.items}
