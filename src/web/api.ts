import { companionApi } from "./companion";
import { questionApi, questionConfig } from "./questions";
export async function webApi(path: string, body?: unknown) {
  return path.startsWith("companion/")
    ? companionApi("/" + path.slice(10), body, questionConfig)
    : questionApi(path, body);
}
