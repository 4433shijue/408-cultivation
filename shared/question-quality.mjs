export const subjects = {
  data_structures: "数据结构",
  computer_organization: "计算机组成原理",
  operating_systems: "操作系统",
  computer_networks: "计算机网络",
};
export function validateCandidate(q) {
  if (!q || typeof q !== "object" || Array.isArray(q))
    throw Error("题目不是对象");
  const keys = [
    "subject",
    "topic_id",
    "difficulty",
    "type",
    "stem",
    "options",
    "answer",
    "explanation",
    "knowledge_point",
    "source_note",
  ];
  if (
    Object.keys(q).some((k) => !keys.includes(k)) ||
    keys.some((k) => !(k in q))
  )
    throw Error("字段缺失或包含额外字段");
  if (
    !subjects[q.subject] ||
    !["basic", "intermediate", "advanced"].includes(q.difficulty) ||
    q.type !== "single_choice"
  )
    throw Error("学科、难度或题型无效");
  for (const k of ["stem", "explanation", "knowledge_point", "topic_id"])
    if (
      typeof q[k] !== "string" ||
      !q[k].trim() ||
      q[k].length > (k === "explanation" ? 2500 : 1200)
    )
      throw Error("文本字段无效");
  if (typeof q.source_note !== "string" || q.source_note.length > 1200)
    throw Error("来源无效");
  if (
    !Array.isArray(q.options) ||
    q.options.length !== 4 ||
    !q.options.every(
      (o, i) =>
        o &&
        Object.keys(o).sort().join(",") === "id,text" &&
        o.id === "ABCD"[i] &&
        typeof o.text === "string" &&
        o.text.trim() &&
        o.text.length <= 800,
    ) ||
    new Set(q.options.map((o) => normalize(o.text))).size !== 4 ||
    !"ABCD".includes(q.answer) ||
    q.answer.length !== 1
  )
    throw Error("必须为四个互异选项和一个有效答案");
  if (/如图|下图|见图|上述材料|ignore previous|system prompt/i.test(q.stem))
    throw Error("依赖缺失材料或异常文本");
  return q;
}
export const normalize = (s) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{Z}\s]/gu, "");
export const fingerprint = (q) =>
  normalize(q.stem) +
  "|" +
  q.options
    .map((o) => normalize(typeof o === "string" ? o : o.text))
    .sort()
    .join("|");
const shape = (s) => normalize(s).replace(/[0-9]+/g, "#");
function grams(s) {
  return new Set(
    Array.from({ length: Math.max(0, s.length - 1) }, (_, i) =>
      s.slice(i, i + 2),
    ),
  );
}
export function similar(a, b) {
  if (fingerprint(a) === fingerprint(b) || shape(a.stem) === shape(b.stem))
    return true;
  const x = grams(shape(a.stem)),
    y = grams(shape(b.stem));
  let overlap = 0;
  for (const v of x) if (y.has(v)) overlap++;
  return overlap / Math.max(1, x.size + y.size - overlap) > 0.65;
}
export function publicQuestion(q, id) {
  return {
    id,
    version: 1,
    subject: subjects[q.subject],
    topic_id: q.topic_id,
    stem: q.stem,
    options: q.options.map((o) => o.text),
    answer: "ABCD".indexOf(q.answer),
    explanation: q.explanation,
    knowledge_point: q.knowledge_point,
  };
}
