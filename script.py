!pip install -q sentence-transformers

import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer

# =========================
# 1. データ読み込み
# =========================

BASE_PATH = "/content/drive/MyDrive/Colab Notebooks/files"
mapping = pd.read_csv(f"{BASE_PATH}/misconception_mapping.csv")

mapping = mapping.dropna(subset=["MisconceptionName"])

# =========================
# 2. モデル読み込み
# =========================

model = SentenceTransformer("all-MiniLM-L6-v2")

# 誤概念をあらかじめベクトル化
mis_embeddings = model.encode(
    mapping["MisconceptionName"].tolist(),
    normalize_embeddings=True
)

# =========================
# 3. 誤概念を予測
# =========================

def predict_misconception(text, correct_answer, answer, top_k=3):

    query = f"""
Question: {text}
Correct answer: {correct_answer}
Student answer: {answer}
"""

    query_embedding = model.encode(
        query,
        normalize_embeddings=True
    )

    scores = mis_embeddings @ query_embedding

    top_indices = np.argsort(scores)[::-1][:top_k]

    result = mapping.iloc[top_indices][
        ["MisconceptionId", "MisconceptionName"]
    ].copy()

    result["score"] = scores[top_indices]

    return result


# =========================
# 4. 使用例
# =========================

result = predict_misconception(
    text="1/2 + 1/3",
    correct_answer="5/6",
    answer="2/5"
)

print(result)