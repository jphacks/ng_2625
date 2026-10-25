/**
 * 日本の単元 → Eedi の単元（train.csv の SubjectName）の対応表。
 * npm run build-data は、ここに載っている単元の問題に出てくる誤概念だけを候補に残す。
 * 単元を増やしたり減らしたりしたいときは、この表を直して npm run build-data をやり直す。
 */
export const CALC_UNITS = {
  "正の数・負の数（中1）": [
    "Adding and Subtracting Negative Numbers", "Multiplying and Dividing Negative Numbers",
    "Ordering Negative Numbers", "BIDMAS", "Squares, Cubes, etc",
  ],
  "文字式・式の計算（中1・中2）": [
    "Writing Expressions", "Substitution into Formula", "Simplifying Expressions by Collecting Like Terms",
    "Expanding Single Brackets", "Multiplying Terms", "Writing Formula", "Rearranging Formula and Equations",
    "Laws of Indices",
  ],
  "一次方程式（中1）": ["Linear Equations"],
  "連立方程式（中2）": ["Simultaneous Equations", "Graphical Solution of Simultaneous Equations"],
  "式の展開と因数分解（中3）": [
    "Expanding Double Brackets", "Factorising into a Double Bracket", "Factorising into a Single Bracket",
    "Difference of Two Squares",
  ],
  "平方根（中3）": ["Square Roots, Cube Roots, etc", "Simplifying Surds", "Operations with Surds"],
  "二次方程式（中3）": ["Quadratic Equations", "Completing the Square"],
  // 文章題（割合・比・速さ）で使う。中1の「方程式の利用」は一次方程式・文字式の単元に入っている
  "比・割合・速さ（小6〜中1）": [
    "Writing Ratios", "Sharing in a Ratio", "Percentages of an Amount", "Percentage Increase and Decrease",
    "Converting between Fractions and Percentages", "Converting between Decimals and Percentages",
    "Speed, Distance, Time", "Direct Proportion", "Indirect (Inverse) Proportion",
  ],
  "小学校の計算（分数・小数・四則）": [
    "Adding and Subtracting Fractions", "Multiplying Fractions", "Dividing Fractions",
    "Multiplying and Dividing with Decimals", "Adding and Subtracting with Decimals",
    "Mental Multiplication and Division", "Mental Addition and Subtraction",
    "Written Division", "Written Multiplication", "Written Subtraction", "Written Addition",
    "Place Value", "Equivalent Fractions", "Simplifying Fractions", "Ordering Fractions",
    "Converting Mixed Number and Improper Fractions", "Fractions of an Amount",
    "Factors and Highest Common Factor", "Multiples and Lowest Common Multiple", "Ordering Decimals",
    "Converting between Fractions and Decimals", "Combining Operations",
  ],
};
