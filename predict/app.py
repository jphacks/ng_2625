import pandas as pd
import numpy as np

from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

# 起動時に1回だけロード
model = SentenceTransformer("./misconception_model")

mapping = pd.read_csv("misconception_mapping.csv")
mapping = mapping.dropna(subset=["MisconceptionName"]).copy()

mis_embeddings = model.encode(
    mapping["MisconceptionName"].tolist(),
    normalize_embeddings=True
)

def predict_misconception(text, correct_answer, answer, top_k=3):

    query = f"""
Question: {text}
Correct answer: {correct_answer}
Student answer: {answer}
""".strip()

    query_embedding = model.encode(
        query,
        normalize_embeddings=True
    )

    scores = mis_embeddings @ query_embedding
    top_indices = np.argsort(scores)[::-1][:top_k]

    results = []

    for i in top_indices:
        results.append({
            "MisconceptionId":
                int(mapping.iloc[i]["MisconceptionId"]),

            "MisconceptionName":
                mapping.iloc[i]["MisconceptionName"],

            "score":
                float(scores[i])
        })

    return results


app = FastAPI()


class AnswerData(BaseModel):
    text: str
    correct_answer: str
    answer: str


@app.get("/")
def root():
    return {"status": "ok"}


@app.post("/predict")
def predict(data: AnswerData):

    return {
        "predictions": predict_misconception(
            data.text,
            data.correct_answer,
            data.answer
        )
    }