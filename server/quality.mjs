import { createHash } from "node:crypto";
import { fingerprint as canonical } from "../shared/question-quality.mjs";
export {
  subjects,
  normalize,
  validateCandidate,
  similar,
  publicQuestion,
} from "../shared/question-quality.mjs";
export const fingerprint = (q) =>
  createHash("sha256").update(canonical(q)).digest("hex");
